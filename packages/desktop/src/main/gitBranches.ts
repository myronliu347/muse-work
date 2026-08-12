/**
 * Local git branch listing for desktop worktree controls.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type GitBranchesResult = {
  branches: string[];
  current: string | null;
};

export async function listGitBranches(
  workdir: string,
): Promise<GitBranchesResult | null> {
  if (!workdir) return null;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", workdir, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
      { encoding: "utf-8", maxBuffer: 2 * 1024 * 1024 },
    );
    const branches = stdout
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);
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
    return { branches, current };
  } catch {
    return null;
  }
}
