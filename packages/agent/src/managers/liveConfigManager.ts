/**
 * Live Configuration Manager
 *
 * Orchestrates live configuration reload functionality including:
 * - Hook configuration watching and reloading
 * - Configuration file watching for settings.json files
 * - Coordination between file watchers and configuration updates
 */

import {
  acquireLiveConfig,
  requestLiveConfigReload,
  type LiveConfigHandle,
  type LiveConfigPayload,
} from "../shared/sharedLiveConfig.js";
import type { HookManager } from "./hookManager.js";
import type { PermissionManager } from "./permissionManager.js";
import type { MemoryService } from "../services/memory.js";
import { USER_MEMORY_FILE } from "../utils/constants.js";
import { isValidHookEvent } from "../types/hooks.js";
import { ConfigurationService } from "../services/configurationService.js";
import type { TurnConfigurationSnapshot } from "../services/configurationService.js";
import { Container } from "../utils/container.js";

import type { MuseConfiguration } from "../types/configuration.js";

import { logger } from "../utils/globalLogger.js";

export interface LiveConfigManagerOptions {
  workdir: string;
  onReload?: (config: MuseConfiguration) => void | Promise<void>;
}

export class LiveConfigManager {
  private readonly workdir: string;
  private isInitialized: boolean = false;

  // Configuration state
  private currentConfiguration: MuseConfiguration | null = null;
  private lastValidConfiguration: MuseConfiguration | null = null;

  // Turn-scoped snapshot of the settings.json-derived configuration the running
  // turn reads from. Captured at turn start, dropped at turn end, so a live
  // reload landing mid-turn takes effect at the next turn instead of shifting
  // values under the running one (core/agent-config.md scenario 5). Nested turns
  // (a subagent turn inside its parent's) share the outer snapshot.
  private turnSnapshot: TurnConfigurationSnapshot | null = null;
  private turnDepth: number = 0;

  private configHandle: LiveConfigHandle | null = null;
  private isWatching: boolean = false;
  private reloadInProgress: boolean = false;

  constructor(
    private container: Container,
    private options: LiveConfigManagerOptions,
  ) {
    this.workdir = options.workdir;
  }

  private get hookManager(): HookManager | undefined {
    return this.container.get<HookManager>("HookManager");
  }

  private get permissionManager(): PermissionManager | undefined {
    return this.container.get<PermissionManager>("PermissionManager");
  }

  private get configurationService(): ConfigurationService {
    return this.container.get<ConfigurationService>("ConfigurationService")!;
  }

  private get memoryService(): MemoryService | undefined {
    return this.container.get<MemoryService>("MemoryService");
  }

  /**
   * Keep the auto-memory system safe zone in sync with the live auto-memory
   * toggle (core/agent-config.md scenario 6). Turning auto-memory off must
   * revoke the privilege its directory got at construction time, and turning it
   * back on must restore it — both without rebuilding the session. Idempotent:
   * the underlying add/remove are dedup'ed by path.
   */
  private syncAutoMemorySafeZone(): void {
    const permissionManager = this.permissionManager;
    const memoryService = this.memoryService;
    if (!permissionManager || !memoryService) {
      return;
    }

    const directories = [
      memoryService.getAutoMemoryDirectory(this.workdir),
      USER_MEMORY_FILE,
    ];
    const enabled = this.configurationService.resolveAutoMemoryEnabledNow();

    for (const directory of directories) {
      if (enabled) {
        permissionManager.addSystemAdditionalDirectory(directory);
      } else {
        permissionManager.removeSystemAdditionalDirectory(directory);
      }
    }
  }

  /**
   * Get current configuration
   */
  getCurrentConfiguration(): MuseConfiguration | null {
    return this.currentConfiguration ? { ...this.currentConfiguration } : null;
  }

  /**
   * Initialize configuration management with file watching
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.configHandle = await acquireLiveConfig(
        this.workdir,
        async (payload) => {
          await this.applySharedPayload(payload);
        },
      );
      this.isWatching = true;
      this.isInitialized = true;
    } catch (error) {
      logger?.error(`Failed to initialize: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Shutdown configuration management and cleanup resources
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      this.isWatching = false;

      this.configHandle?.unsubscribe();
      this.configHandle = null;

      // Clean up state
      this.currentConfiguration = null;
      this.lastValidConfiguration = null;

      this.isInitialized = false;
    } catch (error) {
      logger?.error(`Error during shutdown: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Turn boundary: pin the settings.json-derived configuration for the duration
   * of a turn (called by AIManager). A live reload may land mid-turn and the
   * turn must not see it (core/agent-config.md scenario 5) — the change is
   * picked up by the snapshot taken when the next turn starts. Permission rules,
   * hooks and env stay live: those are enforcement state and follow the file
   * immediately.
   */
  onTurnStart(): void {
    if (this.turnDepth === 0) {
      const configuration = this.getCurrentConfiguration();
      this.turnSnapshot = {
        configuration: configuration ? structuredClone(configuration) : null,
        // `env` on the merged configuration is exactly what was published as the
        // session env snapshot when it was loaded (both come from the same
        // merge), so the snapshot carries both without querying the service.
        env: { ...(configuration?.env ?? {}) },
      };
    }
    this.turnDepth++;
  }

  /** Turn boundary: drop the snapshot so the next turn reads live values. */
  onTurnEnd(): void {
    if (this.turnDepth === 0) {
      return;
    }
    this.turnDepth--;
    if (this.turnDepth === 0) {
      this.turnSnapshot = null;
    }
  }

  /** Configuration snapshot of the running turn, or null outside a turn. */
  getTurnSnapshot(): TurnConfigurationSnapshot | null {
    return this.turnDepth > 0 ? this.turnSnapshot : null;
  }

  private async applySharedPayload(payload: LiveConfigPayload): Promise<void> {
    this.reloadInProgress = true;
    try {
      if (payload.warnings.length > 0) {
        logger?.warn(
          `Live Config: Configuration warnings: ${payload.warnings.join("; ")}`,
        );
      }

      if (!payload.loadSuccess) {
        const errorMessage =
          payload.error || "Configuration loading failed with unknown error";
        logger?.error(
          `Live Config: Configuration loading failed: ${errorMessage}`,
        );
        if (payload.lastValid) {
          this.lastValidConfiguration = payload.lastValid;
          this.currentConfiguration = payload.lastValid;
        } else {
          logger?.warn(
            "Live Config: No previous valid configuration available, using empty config",
          );
          this.currentConfiguration = {};
        }
        await this.applySessionConfiguration(this.currentConfiguration);
        return;
      }

      const newConfig = payload.configuration;
      this.detectChanges(this.currentConfiguration, newConfig);
      this.currentConfiguration = newConfig ? { ...newConfig } : {};
      if (payload.lastValid) {
        this.lastValidConfiguration = { ...payload.lastValid };
      }

      await this.applySessionConfiguration(this.currentConfiguration);
      await this.options.onReload?.(this.currentConfiguration);
    } finally {
      this.reloadInProgress = false;
    }
  }

  private async applySessionConfiguration(
    configuration: MuseConfiguration | null,
  ): Promise<void> {
    const config = configuration ?? {};
    if (config.env) {
      this.configurationService.setEnvironmentVars(config.env);
    }

    if (this.hookManager) {
      this.hookManager.loadConfigurationFromMuseConfig(config);
    }

    if (this.permissionManager) {
      this.permissionManager.updateConfiguredPermissionMode(
        config.permissions?.defaultMode,
      );
      this.permissionManager.updateAllowedRules(
        config.permissions?.allow || [],
      );
      this.permissionManager.updateDeniedRules(
        config.permissions?.deny || [],
      );
      this.permissionManager.updateAdditionalDirectories(
        config.permissions?.additionalDirectories || [],
      );
      this.syncAutoMemorySafeZone();
    }
  }

  /**
   * Reload configuration from files (public method)
   */
  async reload(): Promise<MuseConfiguration> {
    await requestLiveConfigReload(this.workdir);
    if (this.configHandle) {
      await this.configHandle.whenIdle();
    }
    return this.currentConfiguration || {};
  }

  /**
   * Check if watching is active
   */
  isWatchingActive(): boolean {
    return this.isWatching;
  }

  /**
   * Get watcher status for monitoring
   */
  getWatcherStatus() {
    return {
      isActive: this.isWatching,
      configurationLoaded: this.currentConfiguration !== null,
      hasValidConfiguration: this.lastValidConfiguration !== null,
      reloadInProgress: this.reloadInProgress,
      watchedFiles: [],
    };
  }

  private detectChanges(
    oldConfig: MuseConfiguration | null,
    newConfig: MuseConfiguration | null,
  ): {
    added: string[];
    modified: string[];
    removed: string[];
  } {
    const added: string[] = [];
    const modified: string[] = [];
    const removed: string[] = [];

    // Handle environment variables changes
    const oldEnv = oldConfig?.env || {};
    const newEnv = newConfig?.env || {};

    for (const key of Object.keys(newEnv)) {
      if (!(key in oldEnv)) {
        added.push(`env.${key}`);
      } else if (oldEnv[key] !== newEnv[key]) {
        modified.push(`env.${key}`);
      }
    }

    for (const key of Object.keys(oldEnv)) {
      if (!(key in newEnv)) {
        removed.push(`env.${key}`);
      }
    }

    // Handle hooks changes (simplified)
    const oldHooks = oldConfig?.hooks || {};
    const newHooks = newConfig?.hooks || {};

    for (const event of Object.keys(newHooks)) {
      if (isValidHookEvent(event)) {
        if (!(event in oldHooks)) {
          added.push(`hooks.${event}`);
        } else if (
          JSON.stringify(oldHooks[event]) !== JSON.stringify(newHooks[event])
        ) {
          modified.push(`hooks.${event}`);
        }
      }
    }

    for (const event of Object.keys(oldHooks)) {
      if (isValidHookEvent(event) && !(event in newHooks)) {
        removed.push(`hooks.${event}`);
      }
    }

    return { added, modified, removed };
  }

}
