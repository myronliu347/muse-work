import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getMuseHomeDir } from "@muse-work/provider";

const execFileAsync = promisify(execFile);

export type ServerWorktree = {
  path: string;
  name: string;
  branch: string;
  baseBranch: string;
  repoRoot: string;
};

const ADJECTIVES = ["gentle", "swift", "calm", "bold", "bright", "quiet"];
const NOUNS = ["pike", "river", "cloud", "fox", "deer", "breeze"];

function worktreeName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)] ?? "calm";
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)] ?? "river";
  const n = Math.floor(Math.random() * 900) + 100;
  return `${adj}-${noun}-${n}`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function repoRoot(cwd: string): Promise<string> {
  try {
    const porcelain = await git(cwd, ["worktree", "list", "--porcelain"]);
    const first = porcelain.split("\n").find((line) => line.startsWith("worktree "));
    if (first) return first.slice("worktree ".length).trim();
  } catch {
    // fall through
  }
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

async function defaultBaseBranch(cwd: string): Promise<string> {
  try {
    const ref = await git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if (ref) return ref;
  } catch {
    // fall through
  }
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    try {
      await git(cwd, ["rev-parse", "--verify", candidate]);
      return candidate;
    } catch {
      // try the next ref
    }
  }
  return "HEAD";
}

/** 在本机建 git worktree。服务器不依赖桌面客户端。 */
export async function createServerWorktree(args: {
  home: string;
  workdir: string;
  baseBranch?: string;
  name?: string;
}): Promise<ServerWorktree> {
  const name = args.name ?? worktreeName();
  const root = await repoRoot(args.workdir);
  const branch = `worktree-${name}`;
  const baseBranch = args.baseBranch || (await defaultBaseBranch(args.workdir));
  const treePath = path.join(getMuseHomeDir(args.home), "worktrees", name);
  fs.mkdirSync(path.dirname(treePath), { recursive: true });
  if (!fs.existsSync(treePath)) {
    try {
      await execFileAsync(
        "git",
        ["worktree", "add", "-b", branch, treePath, baseBranch],
        { cwd: root },
      );
    } catch (error: unknown) {
      const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? "";
      if (stderr.includes("already exists")) {
        await execFileAsync("git", ["worktree", "add", treePath, branch], { cwd: root });
      } else if (
        !args.baseBranch &&
        (stderr.includes("not a valid object name") ||
          stderr.includes("unknown revision") ||
          stderr.includes("invalid reference"))
      ) {
        await execFileAsync(
          "git",
          ["worktree", "add", "-b", branch, treePath, "HEAD"],
          { cwd: root },
        );
      } else {
        throw new Error(stderr.trim() || (error instanceof Error ? error.message : String(error)));
      }
    }
  }
  return { path: treePath, name, branch, baseBranch, repoRoot: root };
}
