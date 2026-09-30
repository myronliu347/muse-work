import { logger } from "../utils/globalLogger.js";
import {
  Plugin,
  PluginConfig,
  PluginLoadFailure,
  PluginReloadResult,
} from "../types/index.js";
import { PluginLoader } from "../services/pluginLoader.js";
import * as path from "path";
import { existsSync, readdirSync } from "fs";
import { getBuiltinPluginsDir } from "../utils/configPaths.js";
import { SkillManager } from "./skillManager.js";
import { HookManager } from "./hookManager.js";
import { LspManager } from "./lspManager.js";
import { McpManager } from "./mcpManager.js";
import { SlashCommandManager } from "./slashCommandManager.js";
import { SubagentManager } from "./subagentManager.js";
import { ConfigurationService } from "../services/configurationService.js";
import { Container } from "../utils/container.js";
import { PermissionManager } from "./permissionManager.js";
import { DEFAULT_PLUGIN_VERSION } from "../constants/plugins.js";

export interface PluginManagerOptions {
  workdir: string;
  enabledPlugins?: Record<string, boolean>;
}

export class PluginManager {
  /**
   * Read-only helper scripts shipped by builtin plugins that the agent runs via
   * Bash. When such a plugin is enabled, its rules are registered as instance
   * level allow rules (in-memory only, never persisted) so the scripts run
   * without a permission prompt. Wildcards keep the rules valid across install
   * locations; each rule anchors on the script filename.
   */
  private static readonly BUILTIN_PLUGIN_ALLOW_RULES: Record<string, string[]> =
    {};

  private plugins = new Map<string, Plugin>();
  private workdir: string;
  private enabledPlugins: Record<string, boolean>;
  /** Explicit configs from the last load, replayed by reloadAllPlugins(). */
  private lastLoadConfigs: PluginConfig[] = [];
  /** Failures collected by the current loadPlugins() run. */
  private loadFailures: PluginLoadFailure[] = [];
  /**
   * Serializes plugin (re)loads. A managed-settings sync (or an early
   * `/reload-plugins`) can ask for a reload while the startup load is still
   * running; interleaving them would leave half-unloaded capability registries.
   */
  private loadChain: Promise<unknown> = Promise.resolve();

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.loadChain.then(task, task);
    // Keep the chain alive after a failure so later reloads still run.
    this.loadChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  constructor(
    private container: Container,
    options: PluginManagerOptions,
  ) {
    this.workdir = options.workdir;
    this.enabledPlugins = options.enabledPlugins || {};
  }

  private get permissionManager(): PermissionManager | undefined {
    return this.container.get<PermissionManager>("PermissionManager");
  }

  private get skillManager(): SkillManager | undefined {
    return this.container.get<SkillManager>("SkillManager");
  }

  private get hookManager(): HookManager | undefined {
    return this.container.get<HookManager>("HookManager");
  }

  private get lspManager(): LspManager | undefined {
    return this.container.get<LspManager>("LspManager");
  }

  private get mcpManager(): McpManager | undefined {
    return this.container.get<McpManager>("McpManager");
  }

  private get slashCommandManager(): SlashCommandManager | undefined {
    return this.container.get<SlashCommandManager>("SlashCommandManager");
  }

  private get configurationService(): ConfigurationService | undefined {
    return this.container.get<ConfigurationService>("ConfigurationService");
  }

  private get subagentManager(): SubagentManager | undefined {
    return this.container.get<SubagentManager>("SubagentManager");
  }

  /**
   * Update enabled plugins configuration
   */
  updateEnabledPlugins(enabledPlugins: Record<string, boolean>): void {
    this.enabledPlugins = enabledPlugins;
  }

  /**
   * Load a single plugin from an absolute path
   */
  private async loadSinglePlugin(absolutePath: string): Promise<void> {
    try {
      const manifest = await PluginLoader.loadManifest(absolutePath);

      if (this.plugins.has(manifest.name)) {
        // If already loaded (e.g. via explicit config), skip
        logger?.warn(`Plugin with name '${manifest.name}' is already loaded`);
        return;
      }

      const plugin: Plugin = {
        ...manifest,
        // A manifest without `version` is legal (spec plugin A-022); the default
        // matches what the install path files under `installed_plugins.json`.
        version: manifest.version || DEFAULT_PLUGIN_VERSION,
        path: absolutePath,
        commands: PluginLoader.loadCommands(absolutePath),
        skills: await PluginLoader.loadSkills(absolutePath),
        agents: await PluginLoader.loadAgents(absolutePath),
        lspConfig: await PluginLoader.loadLspConfig(absolutePath),
        mcpConfig: await PluginLoader.loadMcpConfig(
          absolutePath,
          manifest.mcpServers,
        ),
        hooksConfig: await PluginLoader.loadHooksConfig(absolutePath),
      };

      // Register components with managers
      if (this.slashCommandManager && plugin.commands.length > 0) {
        this.slashCommandManager.registerPluginCommands(
          plugin.name,
          plugin.commands,
        );
      }

      if (this.skillManager && plugin.skills.length > 0) {
        this.skillManager.registerPluginSkills(plugin.name, plugin.skills);
      }

      if (this.lspManager && plugin.lspConfig) {
        for (const [language, config] of Object.entries(plugin.lspConfig)) {
          const configWithPluginRoot = { ...config, pluginRoot: plugin.path };
          this.lspManager.registerServer(language, configWithPluginRoot);
        }
      }

      if (this.mcpManager && plugin.mcpConfig) {
        for (const [name, config] of Object.entries(
          plugin.mcpConfig.mcpServers,
        )) {
          // One unusable server declaration must not take the rest of the plugin
          // down with it (spec plugin A-023).
          try {
            const configWithPluginRoot = { ...config, pluginRoot: plugin.path };
            this.mcpManager.addServer(name, configWithPluginRoot);
          } catch (error) {
            logger?.warn(
              `Failed to register MCP server '${name}' from plugin ${plugin.name}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }

      if (this.hookManager && plugin.hooksConfig) {
        this.hookManager.registerPluginHooks(plugin.path, plugin.hooksConfig);
      }

      if (this.subagentManager && plugin.agents.length > 0) {
        this.subagentManager.registerPluginAgents(plugin.name, plugin.agents);
      }

      this.plugins.set(manifest.name, plugin);
      logger?.debug(`Loaded plugin: ${manifest.name} v${plugin.version}`);
    } catch (error) {
      this.loadFailures.push({
        path: absolutePath,
        error: error instanceof Error ? error.message : String(error),
      });
      logger?.error(`Failed to load plugin from ${absolutePath}`, error);
    }
  }

  /**
   * Load plugins from configuration
   * @param configs Array of plugin configurations
   * @returns the plugins that failed to load
   */
  async loadPlugins(configs: PluginConfig[]): Promise<PluginLoadFailure[]> {
    return this.serialize(() => this.doLoadPlugins(configs));
  }

  /**
   * The actual load. Reached through [loadPlugins] (which serializes concurrent
   * requests) and directly from [reloadAllPlugins], which already holds the slot.
   */
  private async doLoadPlugins(
    configs: PluginConfig[],
  ): Promise<PluginLoadFailure[]> {
    this.lastLoadConfigs = configs;
    this.loadFailures = [];

    // Load plugins from configuration (e.g. --plugin-dir) first to give them higher priority
    for (const config of configs) {
      if (config.type !== "local") {
        logger?.warn(`Unsupported plugin type: ${config.type}`);
        continue;
      }

      const absolutePath = path.isAbsolute(config.path)
        ? config.path
        : path.resolve(this.workdir, config.path);

      await this.loadSinglePlugin(absolutePath);
    }

    if (this.configurationService) {
      this.enabledPlugins = this.configurationService.getMergedEnabledPlugins(
        this.workdir,
      );
    }

    // Load built-in plugins bundled with the SDK (lowest priority)
    await this.loadBuiltinPlugins();

    return [...this.loadFailures];
  }

  /**
   * Unload a single plugin: drop everything it contributed from the six
   * capability registries, then forget it. Other plugins and the running
   * session are untouched.
   * @returns true if the plugin was loaded
   */
  async unloadPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return false;
    }

    // Managers key their entries off the plugin name (commands/skills/agents)
    // or the plugin root path (hooks/LSP/MCP), so each needs its own removal.
    this.slashCommandManager?.unregisterPluginCommands(plugin.name);
    this.skillManager?.unregisterPluginSkills(plugin.name);
    this.subagentManager?.unregisterPluginAgents(plugin.name);
    this.hookManager?.unregisterPluginHooks(plugin.path);
    await this.lspManager?.unregisterServersForPlugin(plugin.path);
    this.mcpManager?.removeServersForPlugin(plugin.path);

    // Revoke the builtin helper-script grants this plugin added, so disabling
    // it does not leave a standing permission behind.
    for (const rule of PluginManager.BUILTIN_PLUGIN_ALLOW_RULES[plugin.name] ||
      []) {
      this.permissionManager?.removeInstanceAllowedRule(rule);
    }

    this.plugins.delete(name);
    logger?.debug(`Unloaded plugin: ${name}`);
    return true;
  }

  /**
   * Re-read every plugin in place — the `/reload-plugins` command.
   *
   * Unloads everything currently loaded, re-reads `enabledPlugins` from the
   * configuration chain (so a settings edit is honored), then replays the
   * original load order (explicit local configs → builtin). The session,
   * transcript and sessionId are untouched; only the capability registries are
   * swapped, which is what makes this an in-place reload instead of a rebuild.
   *
   * Unload must happen before any caller-side mutation of the plugin cache dir:
   * hooks, MCP, LSP, skills and agents all bake absolute plugin paths at
   * registration time, so an entry left pointing at a deleted directory is
   * worse than a merely stale one.
   */
  async reloadAllPlugins(): Promise<PluginReloadResult> {
    return this.serialize(async () => {
      for (const name of Array.from(this.plugins.keys())) {
        await this.unloadPlugin(name);
      }

      this.enabledPlugins = this.refreshEnabledPlugins();
      const failures = await this.doLoadPlugins(this.lastLoadConfigs);

      return {
        plugins: Array.from(this.plugins.keys()),
        failures,
      };
    });
  }

  /**
   * Re-read enabled plugins from the merged configuration chain, falling back
   * to the last known value when the service is unavailable.
   */
  private refreshEnabledPlugins(): Record<string, boolean> {
    const merged = this.configurationService?.getMergedEnabledPlugins(
      this.workdir,
    );
    return merged ?? this.enabledPlugins;
  }

  /**
   * Load built-in plugins bundled with the SDK.
   * Opt-in via `enabledPlugins`, keyed `<name>@builtin` (default off).
   * Lowest priority: explicit local plugin dirs win on name conflicts.
   */
  private async loadBuiltinPlugins(): Promise<void> {
    try {
      const builtinDir = getBuiltinPluginsDir();
      if (!existsSync(builtinDir)) return;

      // The builtin plugin directory name is the plugin name by convention.
      for (const entry of readdirSync(builtinDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (this.enabledPlugins[`${entry.name}@builtin`] !== true) continue;
        await this.loadSinglePlugin(path.join(builtinDir, entry.name));
        // Register allow rules only after the plugin actually loaded, so a
        // failed load never leaves permission grants behind.
        if (this.plugins.has(entry.name)) {
          for (const rule of PluginManager.BUILTIN_PLUGIN_ALLOW_RULES[
            entry.name
          ] || []) {
            this.permissionManager?.addInstanceAllowedRule(rule);
          }
        }
      }
    } catch (error) {
      logger?.error("Failed to load built-in plugins:", error);
    }
  }

  /**
   * Get all loaded plugins
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a plugin by name
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }
}
