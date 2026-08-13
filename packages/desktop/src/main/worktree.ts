/**
 * Git worktree helpers ported from wave-agent `packages/code/src/utils/worktree.ts`.
 * Paths live under `<repo>/.wave/worktrees/<name>` with branch `worktree-<name>`.
 */

import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs";
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
  const worktreePath = path.join(repoRoot, ".wave", "worktrees", name);
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
      stderr.includes("not a valid object name") ||
      stderr.includes("unknown revision")
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
