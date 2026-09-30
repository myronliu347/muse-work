import { logger } from "../utils/globalLogger.js";
import {
  Plugin,
  PluginConfig,
  PluginLoadFailure,
  PluginReloadResult,
} from "../types/index.js";
import { PluginLoader } from "../services/pluginLoader.js";
import * as path from "path";
import { SkillManager } from "./skillManager.js";
import { HookManager } from "./hookManager.js";
import { LspManager } from "./lspManager.js";
import { McpManager } from "./mcpManager.js";
import { SlashCommandManager } from "./slashCommandManager.js";
import { SubagentManager } from "./subagentManager.js";
import { Container } from "../utils/container.js";
import { DEFAULT_PLUGIN_VERSION } from "../constants/plugins.js";

export interface PluginManagerOptions {
  workdir: string;
}

export class PluginManager {
  private plugins = new Map<string, Plugin>();
  private workdir: string;
  /** Explicit configs from the last load, replayed by reloadAllPlugins(). */
  private lastLoadConfigs: PluginConfig[] = [];
  /** Failures collected by the current loadPlugins() run. */
  private loadFailures: PluginLoadFailure[] = [];
  /**
   * Serializes plugin (re)loads. A reload while startup is still running
   * would otherwise leave half-unloaded capability registries.
   */
  private loadChain: Promise<unknown> = Promise.resolve();

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.loadChain.then(task, task);
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

  private get subagentManager(): SubagentManager | undefined {
    return this.container.get<SubagentManager>("SubagentManager");
  }

  /**
   * Load a single plugin from an absolute path
   */
  private async loadSinglePlugin(absolutePath: string): Promise<void> {
    try {
      const manifest = await PluginLoader.loadManifest(absolutePath);

      if (this.plugins.has(manifest.name)) {
        logger?.warn(`Plugin with name '${manifest.name}' is already loaded`);
        return;
      }

      const plugin: Plugin = {
        ...manifest,
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

    return [...this.loadFailures];
  }

  /**
   * Unload a single plugin: drop everything it contributed from the capability
   * registries, then forget it.
   * @returns true if the plugin was loaded
   */
  async unloadPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return false;
    }

    this.slashCommandManager?.unregisterPluginCommands(plugin.name);
    this.skillManager?.unregisterPluginSkills(plugin.name);
    this.subagentManager?.unregisterPluginAgents(plugin.name);
    this.hookManager?.unregisterPluginHooks(plugin.path);
    await this.lspManager?.unregisterServersForPlugin(plugin.path);
    this.mcpManager?.removeServersForPlugin(plugin.path);

    this.plugins.delete(name);
    logger?.debug(`Unloaded plugin: ${name}`);
    return true;
  }

  /**
   * Re-read every plugin in place — the `/reload-plugins` command.
   */
  async reloadAllPlugins(): Promise<PluginReloadResult> {
    return this.serialize(async () => {
      for (const name of Array.from(this.plugins.keys())) {
        await this.unloadPlugin(name);
      }

      const failures = await this.doLoadPlugins(this.lastLoadConfigs);

      return {
        plugins: Array.from(this.plugins.keys()),
        failures,
      };
    });
  }

  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }
}
