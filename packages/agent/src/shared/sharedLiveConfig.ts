import { existsSync } from "fs";
import { dirname } from "path";
import type { MuseConfiguration } from "../types/configuration.js";
import {
  loadMergedMuseConfig,
  validateConfigurationObject,
} from "../services/configurationService.js";
import { getProjectConfigPaths, getUserConfigPaths } from "../utils/configPaths.js";
import { projectDirEnv } from "../utils/museEnv.js";
import { FileWatcherService, type FileWatchEvent } from "../services/fileWatcher.js";
import { resolveWorkdirKey } from "./pathKey.js";
import { logger } from "../utils/globalLogger.js";

export type LiveConfigPayload = {
  configuration: MuseConfiguration | null;
  lastValid: MuseConfiguration | null;
  loadSuccess: boolean;
  warnings: string[];
  error?: string;
};

export type LiveConfigListener = (
  payload: LiveConfigPayload,
) => void | Promise<void>;

export type LiveConfigHandle = {
  getPayload(): LiveConfigPayload;
  unsubscribe(): void;
  whenIdle(): Promise<void>;
};

type ConfigEntry = {
  workdir: string;
  refCount: number;
  payload: LiveConfigPayload;
  fileWatcher: FileWatcherService | null;
  listeners: Set<LiveConfigListener>;
  reloadInProgress: boolean;
  initPromise: Promise<void> | null;
  idleWaiters: Array<() => void>;
};

const configs = new Map<string, ConfigEntry>();

function resolveWatchTarget(configPath: string): string {
  let candidate = configPath;
  while (!existsSync(dirname(candidate))) {
    const parent = dirname(candidate);
    if (parent === candidate) {
      return configPath;
    }
    candidate = parent;
  }
  return candidate;
}

function emptyPayload(): LiveConfigPayload {
  return {
    configuration: null,
    lastValid: null,
    loadSuccess: true,
    warnings: [],
  };
}

async function loadPayload(
  workdir: string,
  previous: LiveConfigPayload,
): Promise<LiveConfigPayload> {
  try {
    const mergedConfig = loadMergedMuseConfig(workdir);
    if (!mergedConfig) {
      const env = projectDirEnv(workdir);
      const configuration: MuseConfiguration = { env };
      return {
        configuration,
        lastValid: configuration,
        loadSuccess: true,
        warnings: [
          "No configuration files found in user or project directories",
        ],
      };
    }

    const validation = validateConfigurationObject(mergedConfig);
    if (!validation.isValid) {
      return {
        configuration: previous.lastValid,
        lastValid: previous.lastValid,
        loadSuccess: false,
        warnings: validation.warnings,
        error: validation.errors.join(", "),
      };
    }

    const env = {
      ...(mergedConfig.env || {}),
      ...projectDirEnv(workdir),
    };
    const configuration: MuseConfiguration = { ...mergedConfig, env };
    const lastValid =
      configuration.hooks || configuration.env
        ? { ...configuration }
        : previous.lastValid;

    return {
      configuration,
      lastValid,
      loadSuccess: true,
      warnings: validation.warnings,
    };
  } catch (error) {
    return {
      configuration: previous.lastValid,
      lastValid: previous.lastValid,
      loadSuccess: false,
      warnings: [],
      error: (error as Error).message,
    };
  }
}

async function notifyListeners(entry: ConfigEntry): Promise<void> {
  for (const listener of entry.listeners) {
    try {
      await listener(entry.payload);
    } catch (error) {
      logger?.error(
        `SharedLiveConfig listener error: ${(error as Error).message}`,
      );
    }
  }
}

function resolveIdle(entry: ConfigEntry): void {
  if (!entry.reloadInProgress) {
    for (const resolve of entry.idleWaiters) {
      resolve();
    }
    entry.idleWaiters = [];
  }
}

async function runReload(entry: ConfigEntry): Promise<void> {
  if (entry.reloadInProgress) {
    return new Promise((resolve) => {
      entry.idleWaiters.push(resolve);
    });
  }
  entry.reloadInProgress = true;
  try {
    entry.payload = await loadPayload(entry.workdir, entry.payload);
    await notifyListeners(entry);
  } finally {
    entry.reloadInProgress = false;
    resolveIdle(entry);
  }
}

async function ensureInitialized(entry: ConfigEntry): Promise<void> {
  if (entry.initPromise) {
    return entry.initPromise;
  }
  entry.initPromise = (async () => {
    await runReload(entry);
    if (!entry.fileWatcher) {
      entry.fileWatcher = new FileWatcherService(logger);
      entry.fileWatcher.on("watcherError", (error: Error) => {
        logger?.error(`SharedLiveConfig watcher error: ${error.message}`);
      });
      const userPaths = getUserConfigPaths();
      const projectPaths = getProjectConfigPaths(entry.workdir);
      for (const userPath of userPaths) {
        await entry.fileWatcher.watchFile(
          resolveWatchTarget(userPath),
          (event) => void handleFileEvent(entry, event),
        );
      }
      for (const projectPath of projectPaths) {
        await entry.fileWatcher.watchFile(
          resolveWatchTarget(projectPath),
          (event) => void handleFileEvent(entry, event),
        );
      }
    }
  })();
  return entry.initPromise;
}

async function handleFileEvent(
  entry: ConfigEntry,
  event: FileWatchEvent,
): Promise<void> {
  try {
    if (event.type === "delete") {
      await runReload(entry);
      return;
    }
    if (event.type === "change" || event.type === "create") {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await runReload(entry);
    }
  } catch (error) {
    logger?.error(
      `SharedLiveConfig file change error: ${(error as Error).message}`,
    );
  }
}

export async function acquireLiveConfig(
  workdir: string,
  listener: LiveConfigListener,
): Promise<LiveConfigHandle> {
  const key = resolveWorkdirKey(workdir);
  let entry = configs.get(key);
  if (!entry) {
    entry = {
      workdir,
      refCount: 0,
      payload: emptyPayload(),
      fileWatcher: null,
      listeners: new Set(),
      reloadInProgress: false,
      initPromise: null,
      idleWaiters: [],
    };
    configs.set(key, entry);
  }

  entry.refCount++;
  entry.listeners.add(listener);
  const alreadyInitialized = entry.initPromise !== null;
  await ensureInitialized(entry);
  if (alreadyInitialized) {
    await listener(entry.payload);
  }

  return {
    getPayload: () => entry!.payload,
    unsubscribe: () => {
      const current = configs.get(key);
      if (!current) return;
      current.listeners.delete(listener);
      current.refCount--;
      if (current.refCount <= 0) {
        void current.fileWatcher?.cleanup();
        configs.delete(key);
      }
    },
    whenIdle: () => {
      if (!entry!.reloadInProgress) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        entry!.idleWaiters.push(resolve);
      });
    },
  };
}

export function requestLiveConfigReload(workdir: string): Promise<void> {
  const key = resolveWorkdirKey(workdir);
  const entry = configs.get(key);
  if (!entry) {
    return Promise.resolve();
  }
  return runReload(entry);
}

export async function resetSharedLiveConfigForTests(): Promise<void> {
  for (const entry of configs.values()) {
    await entry.fileWatcher?.cleanup();
  }
  configs.clear();
}
