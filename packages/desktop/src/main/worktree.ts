/**
 * Git worktree helpers. New trees live under `~/.muse-work/worktrees/<name>`
 * (or `$HOME/$MUSE_HOME_DIR/worktrees`). Existing trees under
 * `<repo>/.wave/worktrees` or `<repo>/.muse-work/worktrees` are reused.
 * `.wave/worktrees` 是旧树兼容路径，刻意保留读取，暂不删。
 */

import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorktreeSession {
  name: string;
  path: string;
  branch: string;
  baseBranch: string;
  repoRoot: string;
  isNew: boolean;
}

const VALID_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const MAX_NAME_LEN = 64;

export function getMuseWorktreesRoot(home = os.homedir()): string {
  const dirName = process.env.MUSE_HOME_DIR ?? ".muse-work";
  return path.join(home, dirName, "worktrees");
}

/** Prefer an existing tree (home, then in-repo Muse, then legacy Wave). */
export function resolveWorktreePath(name: string, repoRoot: string): string {
  const next = path.join(getMuseWorktreesRoot(), name);
  const inRepoMuse = path.join(repoRoot, ".muse-work", "worktrees", name);
  // 旧 Wave 落点；已有树继续复用，新树不再写这里。
  const legacyWave = path.join(repoRoot, ".wave", "worktrees", name);
  if (fs.existsSync(next)) return next;
  if (fs.existsSync(inRepoMuse)) return inRepoMuse;
  if (fs.existsSync(legacyWave)) return legacyWave;
  return next;
}

export function validateWorktreeSlug(name: string): void {
  if (name.length > MAX_NAME_LEN) {
    throw new Error(
      `Invalid worktree name: "${name}" must be ${MAX_NAME_LEN} characters or fewer`,
    );
  }
  for (const segment of name.split("/")) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      !VALID_SEGMENT.test(segment)
    ) {
      throw new Error(
        `Invalid worktree name: "${name}" segments must be non-empty [a-zA-Z0-9._-]`,
      );
    }
  }
}

function gitSync(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function getGitMainRepoRoot(cwd: string): string {
  try {
    const porcelain = gitSync(cwd, ["worktree", "list", "--porcelain"]);
    const first = porcelain.split("\n").find((l) => l.startsWith("worktree "));
    if (first) return first.slice("worktree ".length).trim();
  } catch {
    // fall through
  }
  return gitSync(cwd, ["rev-parse", "--show-toplevel"]);
}

export function getDefaultRemoteBranch(cwd: string): string {
  try {
    const ref = gitSync(cwd, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    if (ref) return ref;
  } catch {
    // fall through
  }
  try {
    gitSync(cwd, ["rev-parse", "--verify", "origin/main"]);
    return "origin/main";
  } catch {
    // fall through
  }
  try {
    gitSync(cwd, ["rev-parse", "--verify", "origin/master"]);
    return "origin/master";
  } catch {
    return "main";
  }
}

export async function createWorktree(
  name: string,
  cwd: string,
  options?: { baseBranch?: string },
): Promise<WorktreeSession> {
  validateWorktreeSlug(name);
  const repoRoot = getGitMainRepoRoot(cwd);
  const worktreePath = resolveWorktreePath(name, repoRoot);
  const branchName = `worktree-${name}`;
  const resolvedBaseBranch = options?.baseBranch || getDefaultRemoteBranch(cwd);

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  if (fs.existsSync(worktreePath)) {
    return {
      name,
      path: worktreePath,
      branch: branchName,
      baseBranch: resolvedBaseBranch,
      repoRoot,
      isNew: false,
    };
  }

  try {
    await execFileAsync(
      "git",
      ["worktree", "add", "-b", branchName, worktreePath, resolvedBaseBranch],
      { cwd: repoRoot },
    );
  } catch (error: unknown) {
    const stderr =
      (error as { stderr?: Buffer | string }).stderr?.toString() || "";
    if (stderr.includes("already exists")) {
      await execFileAsync(
        "git",
        ["worktree", "add", worktreePath, branchName],
        { cwd: repoRoot },
      );
    } else if (
      !options?.baseBranch &&
      (stderr.includes("not a valid object name") ||
        stderr.includes("unknown revision") ||
        stderr.includes("invalid reference"))
    ) {
      await execFileAsync(
        "git",
        ["worktree", "add", "-b", branchName, worktreePath, "HEAD"],
        { cwd: repoRoot },
      );
    } else {
      throw new Error(
        `Failed to create worktree: ${(error as Error).message}\n${stderr}`,
      );
    }
  }

  return {
    name,
    path: worktreePath,
    branch: branchName,
    baseBranch: resolvedBaseBranch,
    repoRoot,
    isNew: true,
  };
}

export async function removeWorktree(session: {
  path: string;
  branch: string;
  repoRoot: string;
}): Promise<void> {
  try {
    await execFileAsync(
      "git",
      ["worktree", "remove", "--force", session.path],
      { cwd: session.repoRoot },
    );
  } catch (error) {
    console.error(
      `Failed to remove worktree: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    await execFileAsync("git", ["branch", "-D", session.branch], {
      cwd: session.repoRoot,
    });
  } catch {
    // branch may already be gone
  }
}
