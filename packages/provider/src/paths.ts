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

/** Per-account auth file. Ignores `MUSE_HOME_DIR` so dev and production share it. */
export function getCodexAuthPath(home = os.homedir()): string {
  return path.join(home, ".muse-work", "auth", "codex.json");
}
