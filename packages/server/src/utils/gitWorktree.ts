/**
 * Git worktree helpers for todo task execution (server 侧，参照 desktop worktree.ts)。
 * 路径统一在 `<repo>/.wave/worktrees/<name>`，分支 `worktree-<name>`。
 */

import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorktreeRef {
  name: string;
  path: string;
  branch: string;
  repoRoot: string;
}

const VALID_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const MAX_NAME_LEN = 64;

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

/** workdir 是否在 git 仓库内（非 git → false，调度器直接在该目录执行）。 */
export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function gitSync(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getGitMainRepoRoot(cwd: string): string {
  try {
    const porcelain = gitSync(cwd, ["worktree", "list", "--porcelain"]);
    const first = porcelain.split("\n").find((l) => l.startsWith("worktree "));
    if (first) return first.slice("worktree ".length).trim();
  } catch {
    // fall through
  }
  return gitSync(cwd, ["rev-parse", "--show-toplevel"]);
}

function getDefaultBaseBranch(cwd: string): string {
  for (const ref of ["origin/HEAD", "origin/main", "origin/master"]) {
    try {
      const symbolic = gitSync(cwd, [
        "symbolic-ref",
        "--short",
        `refs/remotes/${ref === "origin/HEAD" ? ref : ref}`,
      ]);
      if (ref === "origin/HEAD" && symbolic) return symbolic;
    } catch {
      // fall through
    }
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

/**
 * 同名 worktree 已存在则复用，否则新建（工作目录 = worktree path）。
 * @param baseBranch 指定 worktree 的 base 分支（从该分支 checkout）；缺省自动推断。
 */
export async function ensureWorktree(
  name: string,
  cwd: string,
  baseBranch?: string,
): Promise<WorktreeRef> {
  validateWorktreeSlug(name);
  const repoRoot = getGitMainRepoRoot(cwd);
  const worktreePath = path.join(repoRoot, ".wave", "worktrees", name);
  const branch = `worktree-${name}`;
  const base = baseBranch ?? getDefaultBaseBranch(cwd);

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  if (fs.existsSync(worktreePath)) {
    return { name, path: worktreePath, branch, repoRoot };
  }

  try {
    await execFileAsync(
      "git",
      ["worktree", "add", "-b", branch, worktreePath, base],
      { cwd: repoRoot },
    );
  } catch (error: unknown) {
    const stderr =
      (error as { stderr?: Buffer | string }).stderr?.toString() || "";
    if (stderr.includes("already exists")) {
      await execFileAsync("git", ["worktree", "add", worktreePath, branch], {
        cwd: repoRoot,
      });
    } else if (
      stderr.includes("not a valid object name") ||
      stderr.includes("unknown revision")
    ) {
      await execFileAsync("git", ["worktree", "add", "-b", branch, worktreePath, "HEAD"], {
        cwd: repoRoot,
      });
    } else {
      throw new Error(
        `Failed to create worktree: ${(error as Error).message}\n${stderr}`,
      );
    }
  }

  return { name, path: worktreePath, branch, repoRoot };
}

export async function removeWorktree(ref: WorktreeRef): Promise<void> {
  try {
    await execFileAsync("git", ["worktree", "remove", "--force", ref.path], {
      cwd: ref.repoRoot,
    });
  } catch {
    // 目录可能已被删
  }
  try {
    await execFileAsync("git", ["branch", "-D", ref.branch], {
      cwd: ref.repoRoot,
    });
  } catch {
    // branch may already be gone
  }
}
