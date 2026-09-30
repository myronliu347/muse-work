import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

import type {
  RemoteSettingsCache,
  RemoteSettingsFetchResult,
} from "../types/configuration.js";
import type { WaveConfiguration } from "../types/configuration.js";
import type { HookEvent, HookEventConfig } from "../types/hooks.js";

import { CONFIG_DIR_NAME } from "../utils/constants.js";

const CACHE_FILE = path.join(homedir(), CONFIG_DIR_NAME, "remote-settings.json");

let _cachedSettings: RemoteSettingsCache | null = null;
let _onSettingsUpdateCallbacks: Array<() => void | Promise<void>> = [];

/**
 * Register a callback invoked when remote settings change (checksum differs).
 * Returns an unsubscribe function.
 */
export function onSettingsUpdate(
  callback: () => void | Promise<void>,
): () => void {
  _onSettingsUpdateCallbacks.push(callback);
  return () => {
    _onSettingsUpdateCallbacks = _onSettingsUpdateCallbacks.filter(
      (cb) => cb !== callback,
    );
  };
}

export function initialize(): void {
  // Muse does not poll Wave enterprise remote-settings.
}

/**
 * Start the fire-and-forget initial network fetch + background polling.
 * Muse keeps this as a no-op; local settings.json is the source of truth.
 */
export function startBackgroundFetch(): void {}

export function getRemoteSettingsSync(): WaveConfiguration | null {
  return null;
}

export async function refresh(): Promise<RemoteSettingsFetchResult> {
  return { success: false, notConfigured: true };
}

export function clear(): void {
  _cachedSettings = null;
  try {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
  } catch {
    // ignore
  }
}

export function shutdown(): void {}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

function mergeHooks(
  local: Partial<Record<HookEvent, HookEventConfig[]>> | undefined,
  remote: Partial<Record<HookEvent, HookEventConfig[]>> | undefined,
): Partial<Record<HookEvent, HookEventConfig[]>> | undefined {
  if (!remote && !local) {
    return undefined;
  }
  if (!remote) {
    return local;
  }
  if (!local) {
    return remote;
  }
  const merged: Partial<Record<HookEvent, HookEventConfig[]>> = { ...local };
  for (const [event, remoteHooks] of Object.entries(remote)) {
    const localHooks = merged[event as HookEvent] ?? [];
    const combined = [...localHooks, ...(remoteHooks ?? [])];
    const seen = new Set<string>();
    merged[event as HookEvent] = combined.filter((h) => {
      const key = JSON.stringify(h);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  return merged;
}

export function mergeRemoteSettings(
  localMerged: WaveConfiguration,
  remote: WaveConfiguration,
): WaveConfiguration {
  const result: WaveConfiguration = { ...localMerged };

  if (remote.env || localMerged.env) {
    result.env = { ...localMerged.env, ...remote.env };
  }

  if (remote.permissions || localMerged.permissions) {
    const lp = localMerged.permissions ?? {};
    const rp = remote.permissions ?? {};
    result.permissions = {
      allow:
        lp.allow || rp.allow
          ? dedupe([...(lp.allow ?? []), ...(rp.allow ?? [])])
          : undefined,
      deny:
        lp.deny || rp.deny
          ? dedupe([...(lp.deny ?? []), ...(rp.deny ?? [])])
          : undefined,
      defaultMode: rp.defaultMode ?? lp.defaultMode,
      additionalDirectories:
        lp.additionalDirectories || rp.additionalDirectories
          ? dedupe([
              ...(lp.additionalDirectories ?? []),
              ...(rp.additionalDirectories ?? []),
            ])
          : undefined,
    };
    if (!result.permissions.allow) delete result.permissions.allow;
    if (!result.permissions.deny) delete result.permissions.deny;
    if (!result.permissions.defaultMode) delete result.permissions.defaultMode;
    if (!result.permissions.additionalDirectories)
      delete result.permissions.additionalDirectories;
  }

  result.hooks = mergeHooks(localMerged.hooks, remote.hooks);

  if (remote.language !== undefined) result.language = remote.language;
  if (remote.model !== undefined) result.model = remote.model;
  if (remote.autoMemoryEnabled !== undefined)
    result.autoMemoryEnabled = remote.autoMemoryEnabled;
  if (remote.autoMemoryFrequency !== undefined)
    result.autoMemoryFrequency = remote.autoMemoryFrequency;
  if (remote.worktree !== undefined) result.worktree = remote.worktree;
  if (remote.models !== undefined) result.models = remote.models;
  if (remote.marketplaces !== undefined)
    result.marketplaces = {
      ...localMerged.marketplaces,
      ...remote.marketplaces,
    };
  if (remote.enabledPlugins !== undefined)
    result.enabledPlugins = {
      ...localMerged.enabledPlugins,
      ...remote.enabledPlugins,
    };
  if (remote.enableArtifact !== undefined)
    result.enableArtifact = remote.enableArtifact;
  if (remote.enableExec !== undefined) result.enableExec = remote.enableExec;

  return result;
}

export const remoteSettingsService = {
  initialize,
  startBackgroundFetch,
  getRemoteSettingsSync,
  refresh,
  clear,
  shutdown,
  mergeRemoteSettings,
  onSettingsUpdate,
} as const;
