/**
 * Local git branch listing for desktop worktree controls.
 */

import { execFile } from "child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type GitBranchesResult = {
  branches: string[];
  /** Remote-tracking names such as `origin/main`, without `origin/HEAD`. */
  remotes: string[];
  current: string | null;
};

function resolvePath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * List branches only when `workdir` itself is inside a git work tree.
 * Returns null for non-git directories (and does not invent stale UI state).
 */
export async function listGitBranches(
  workdir: string,
): Promise<GitBranchesResult | null> {
  if (!workdir) return null;
  try {
    const inside = await execFileAsync(
      "git",
      ["-C", workdir, "rev-parse", "--is-inside-work-tree"],
      { encoding: "utf-8" },
    );
    if (inside.stdout.trim() !== "true") return null;

    const { stdout } = await execFileAsync(
      "git",
      ["-C", workdir, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
      { encoding: "utf-8", maxBuffer: 2 * 1024 * 1024 },
    );
    const branches = stdout
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);
    let remotes: string[] = [];
    try {
      const remote = await execFileAsync(
        "git",
        ["-C", workdir, "for-each-ref", "--format=%(refname:short)", "refs/remotes"],
        { encoding: "utf-8", maxBuffer: 2 * 1024 * 1024 },
      );
      remotes = remote.stdout
        .split("\n")
        .map((b) => b.trim())
        .filter((b) => b && !b.endsWith("/HEAD"));
    } catch {
      remotes = [];
    }
    let current: string | null = null;
    try {
      const head = await execFileAsync(
        "git",
        ["-C", workdir, "rev-parse", "--abbrev-ref", "HEAD"],
        { encoding: "utf-8" },
      );
      const name = head.stdout.trim();
      current = name && name !== "HEAD" ? name : null;
    } catch {
      current = null;
    }
    // Confirm discovery rooted under workdir (avoid weird false positives).
    void resolvePath(workdir);
    return { branches, remotes, current };
  } catch {
    return null;
  }
}
