import os from "node:os";
import path from "node:path";

/**
 * The `.muse-work` state dir. `home` is the parent (same semantics as
 * `MUSE_HOME` / `os.homedir()`); `dirName` can be overridden via
 * `MUSE_HOME_DIR` so dev/test instances keep all state out of production's
 * `~/.muse-work` (e.g. `MUSE_HOME_DIR=.dev-muse-work` → `~/.dev-muse-work`).
 */
export function getMuseHomeDir(
  home = os.homedir(),
  dirName = process.env.MUSE_HOME_DIR ?? ".muse-work",
): string {
  return path.join(home, dirName);
}

export function getProvidersConfigPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "providers.json");
}

export function getSessionsConfigPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "sessions.json");
}

/**
 * CodeMaker auth lives under `<home>/.muse-work/auth/` regardless of
 * `MUSE_HOME_DIR`: credentials are per-account, not per-environment, so dev
 * and production instances share the same login (auth stays consistent
 * across prod/dev). Tests still isolate via the `home` parameter.
 */
export function getCodeMakerAuthPath(home = os.homedir()): string {
  return path.join(home, ".muse-work", "auth", "codemaker.json");
}

export function getSharedCodeMakerAuthPath(home = os.homedir()): string {
  return path.join(home, ".local", "share", "codemaker", "auth.json");
}
