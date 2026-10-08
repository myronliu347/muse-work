import { join } from "path";
import { homedir } from "os";
import {
  discoverDiskSkills,
  type DiskSkillDiscoveryOptions,
  type DiskSkillSnapshot,
} from "./diskSkillDiscovery.js";
import { resolveWorkdirKey } from "./pathKey.js";
import { FileWatcherService } from "../services/fileWatcher.js";
import { logger } from "../utils/globalLogger.js";
import { CONFIG_DIR_NAME } from "../utils/constants.js";

export type SkillCatalogListener = (
  snapshot: DiskSkillSnapshot,
) => void | Promise<void>;

export type SkillCatalogHandle = {
  getSnapshot(): DiskSkillSnapshot;
  unsubscribe(): void;
};

type CatalogAcquireOptions = {
  watch: boolean;
  discovery?: Omit<DiskSkillDiscoveryOptions, "workdir">;
};

type CatalogEntry = {
  workdir: string;
  discovery: Omit<DiskSkillDiscoveryOptions, "workdir">;
  refCount: number;
  snapshot: DiskSkillSnapshot;
  fileWatcher: FileWatcherService | null;
  listeners: Set<SkillCatalogListener>;
  refreshChain: Promise<void>;
  initPromise: Promise<void> | null;
  closed: boolean;
};

const catalogs = new Map<string, CatalogEntry>();

function emptySnapshot(): DiskSkillSnapshot {
  return {
    metadata: new Map(),
    content: new Map(),
    errors: [],
  };
}

function skillWatchPaths(
  workdir: string,
  discovery: Omit<DiskSkillDiscoveryOptions, "workdir">,
): string[] {
  return [
    discovery.personalSkillsPath ?? join(homedir(), CONFIG_DIR_NAME, "skills"),
    discovery.personalClaudeSkillsPath ??
      join(homedir(), ".claude", "skills"),
    discovery.personalAgentsSkillsPath ??
      join(homedir(), ".agents", "skills"),
    join(workdir, CONFIG_DIR_NAME, "skills"),
    join(workdir, ".claude", "skills"),
    join(workdir, ".agents", "skills"),
  ];
}

async function teardownCatalogEntry(entry: CatalogEntry): Promise<void> {
  entry.closed = true;
  entry.listeners.clear();
  const watcher = entry.fileWatcher;
  entry.fileWatcher = null;
  await watcher?.cleanup();
}

async function runRefresh(entry: CatalogEntry): Promise<void> {
  const run = entry.refreshChain.then(async () => {
    if (entry.closed) return;
    entry.snapshot = await discoverDiskSkills({
      workdir: entry.workdir,
      ...entry.discovery,
    });
    for (const listener of entry.listeners) {
      try {
        await listener(entry.snapshot);
      } catch (error) {
        logger?.error(
          `SharedSkillCatalog listener error: ${(error as Error).message}`,
        );
      }
    }
  });
  entry.refreshChain = run.catch(() => {});
  return run;
}

async function ensureInitialized(
  entry: CatalogEntry,
  watch: boolean,
): Promise<void> {
  if (entry.initPromise) {
    return entry.initPromise;
  }
  entry.initPromise = (async () => {
    if (entry.closed) return;
    await runRefresh(entry);
    if (entry.closed) return;
    if (watch && !entry.fileWatcher) {
      entry.fileWatcher = new FileWatcherService(logger);
      for (const pathToWatch of skillWatchPaths(entry.workdir, entry.discovery)) {
        await entry.fileWatcher.watchFile(pathToWatch, async (event) => {
          if (
            event.path.endsWith("SKILL.md") ||
            event.type === "delete" ||
            event.type === "create"
          ) {
            await requestSkillCatalogRefresh(entry.workdir);
          }
        });
      }
    }
  })();
  return entry.initPromise;
}

export async function acquireSkillCatalog(
  workdir: string,
  options: CatalogAcquireOptions,
  listener: SkillCatalogListener,
): Promise<SkillCatalogHandle> {
  const key = resolveWorkdirKey(workdir);
  const discovery = options.discovery ?? {};
  let entry = catalogs.get(key);
  if (!entry) {
    entry = {
      workdir,
      discovery,
      refCount: 0,
      snapshot: emptySnapshot(),
      fileWatcher: null,
      listeners: new Set(),
      refreshChain: Promise.resolve(),
      initPromise: null,
      closed: false,
    };
    catalogs.set(key, entry);
  }

  if (entry.closed) {
    entry.closed = false;
    entry.initPromise = null;
  }

  entry.refCount++;
  entry.listeners.add(listener);

  const alreadyInitialized = entry.initPromise !== null;
  await ensureInitialized(entry, options.watch);
  if (alreadyInitialized) {
    await listener(entry.snapshot);
  }

  return {
    getSnapshot: () => entry!.snapshot,
    unsubscribe: () => {
      const current = catalogs.get(key);
      if (!current || !current.listeners.has(listener)) return;
      current.listeners.delete(listener);
      current.refCount = Math.max(0, current.refCount - 1);
      if (current.refCount <= 0) {
        catalogs.delete(key);
        void teardownCatalogEntry(current);
      }
    },
  };
}

export function requestSkillCatalogRefresh(workdir: string): Promise<void> {
  const key = resolveWorkdirKey(workdir);
  const entry = catalogs.get(key);
  if (!entry) {
    return Promise.resolve();
  }
  return runRefresh(entry);
}

export async function resetSharedSkillCatalogForTests(): Promise<void> {
  for (const entry of catalogs.values()) {
    await entry.fileWatcher?.cleanup();
  }
  catalogs.clear();
}
