import * as path from "node:path";
import { homedir } from "node:os";
import { CONFIG_DIR_NAME } from "./constants.js";
import { getGitCommonDir } from "./gitUtils.js";
import { pathEncoder } from "./pathEncoder.js";

/**
 * Resolve the auto-memory directory for a workdir.
 *
 * Memory is keyed by the git common dir so every worktree of a repository
 * shares one store. Kept as a free function (not only a `MemoryService`
 * method) because offline consumers — the memory-dream scheduler, lint and
 * applier — need the same path without constructing an agent container.
 */
export function resolveAutoMemoryDirectory(
  workdir: string,
  home = homedir(),
): string {
  const commonDir = getGitCommonDir(workdir);
  const projectRoot =
    path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
  return path.join(
    home,
    CONFIG_DIR_NAME,
    "projects",
    pathEncoder.encodeSync(projectRoot),
    "memory",
  );
}
