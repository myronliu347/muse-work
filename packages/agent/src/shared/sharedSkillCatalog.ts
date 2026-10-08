import { join } from "path";
import { homedir } from "os";
import {
  discoverDiskSkills,
  type DiskSkillDiscoveryOptions,
  type DiskSkillSnapshot,
} from "./diskSkillDiscovery.js";
import type { SkillMetadata } from "../types/skills.js";
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
  /** Watches project-scoped skill dirs only (user dirs are global). */
  fileWatcher: FileWatcherService | null;
  listeners: Set<SkillCatalogListener>;
  refreshChain: Promise<void>;
  initPromise: Promise<void> | null;
  closed: boolean;
  wantWatch: boolean;
  watching: boolean;
};

const catalogs = new Map<string, CatalogEntry>();

let globalPersonalSkillWatcher: FileWatcherService | null = null;
let globalPersonalSkillWatchUsers = 0;

function emptySnapshot(): DiskSkillSnapshot {
  return {
    metadata: new Map(),
    content: new Map(),
    errors: [],
  };
}

function personalSkillWatchPaths(
  discovery: Omit<DiskSkillDiscoveryOptions, "workdir">,
): string[] {
  return [
    discovery.personalSkillsPath ?? join(homedir(), CONFIG_DIR_NAME, "skills"),
    discovery.personalClaudeSkillsPath ??
      join(homedir(), ".claude", "skills"),
    discovery.personalAgentsSkillsPath ??
      join(homedir(), ".agents", "skills"),
  ];
}

function projectSkillWatchPaths(
  workdir: string,
): string[] {
  return [
    join(workdir, CONFIG_DIR_NAME, "skills"),
    join(workdir, ".claude", "skills"),
    join(workdir, ".agents", "skills"),
  ];
}

function skillWatchEventShouldRefresh(event: {
  path: string;
  type: string;
}): boolean {
  return (
    event.path.endsWith("SKILL.md") ||
    event.type === "delete" ||
    event.type === "create"
  );
}

async function ensureGlobalPersonalSkillWatcher(
  discovery: Omit<DiskSkillDiscoveryOptions, "workdir">,
): Promise<void> {
  if (globalPersonalSkillWatcher) return;
  globalPersonalSkillWatcher = new FileWatcherService(logger);
  for (const pathToWatch of personalSkillWatchPaths(discovery)) {
    await globalPersonalSkillWatcher.watchFile(pathToWatch, async (event) => {
      if (!skillWatchEventShouldRefresh(event)) return;
      for (const catalogEntry of catalogs.values()) {
        if (!catalogEntry.closed) {
          await requestSkillCatalogRefresh(catalogEntry.workdir);
        }
      }
    });
  }
}

async function attachCatalogWatchers(entry: CatalogEntry): Promise<void> {
  if (entry.watching || entry.closed || !entry.wantWatch) return;
  entry.watching = true;
  globalPersonalSkillWatchUsers++;
  await ensureGlobalPersonalSkillWatcher(entry.discovery);
  if (!entry.fileWatcher) {
    entry.fileWatcher = new FileWatcherService(logger);
    for (const pathToWatch of projectSkillWatchPaths(entry.workdir)) {
      await entry.fileWatcher.watchFile(pathToWatch, async (event) => {
        if (!skillWatchEventShouldRefresh(event)) return;
        await requestSkillCatalogRefresh(entry.workdir);
      });
    }
  }
}

async function releaseGlobalPersonalSkillWatcher(): Promise<void> {
  globalPersonalSkillWatchUsers = Math.max(0, globalPersonalSkillWatchUsers - 1);
  if (globalPersonalSkillWatchUsers > 0 || !globalPersonalSkillWatcher) return;
  await globalPersonalSkillWatcher.cleanup();
  globalPersonalSkillWatcher = null;
}

async function teardownCatalogEntry(entry: CatalogEntry): Promise<void> {
  entry.closed = true;
  entry.listeners.clear();
  const watcher = entry.fileWatcher;
  entry.fileWatcher = null;
  await watcher?.cleanup();
  if (entry.watching) {
    entry.watching = false;
    await releaseGlobalPersonalSkillWatcher();
  }
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

async function ensureInitialized(entry: CatalogEntry): Promise<void> {
  if (entry.initPromise) {
    return entry.initPromise;
  }
  entry.initPromise = (async () => {
    if (entry.closed) return;
    await runRefresh(entry);
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
      wantWatch: false,
      watching: false,
    };
    catalogs.set(key, entry);
  }

  if (entry.closed) {
    entry.closed = false;
    entry.initPromise = null;
  }

  entry.wantWatch = entry.wantWatch || options.watch;
  entry.refCount++;
  entry.listeners.add(listener);

  const alreadyInitialized = entry.initPromise !== null;
  await ensureInitialized(entry);
  if (entry.wantWatch) {
    await attachCatalogWatchers(entry);
  }
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

/** Read disk skill metadata without acquire/release (uses live catalog snapshot when present). */
export async function peekDiskSkillMetadataForWorkdir(
  workdir: string,
): Promise<SkillMetadata[]> {
  const key = resolveWorkdirKey(workdir);
  const entry = catalogs.get(key);
  if (entry && !entry.closed) {
    return Array.from(entry.snapshot.metadata.values());
  }
  const snapshot = await discoverDiskSkills({ workdir });
  return Array.from(snapshot.metadata.values());
}

export async function resetSharedSkillCatalogForTests(): Promise<void> {
  for (const entry of catalogs.values()) {
    await entry.fileWatcher?.cleanup();
  }
  if (globalPersonalSkillWatcher) {
    await globalPersonalSkillWatcher.cleanup();
    globalPersonalSkillWatcher = null;
  }
  globalPersonalSkillWatchUsers = 0;
  catalogs.clear();
}
