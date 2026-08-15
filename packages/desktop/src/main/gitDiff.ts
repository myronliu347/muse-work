/**
 * Local read-only workspace git-diff for the desktop diff panel.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type WorkspaceFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked";

export interface WorkspaceDiffFile {
  path: string;
  status: WorkspaceFileStatus;
  oldPath?: string;
  additions: number;
  deletions: number;
  hunks: string;
  truncated: boolean;
  binary: boolean;
}

export type WorkspaceDiffResult =
  | { kind: "not-a-repo" }
  | { kind: "ok"; files: WorkspaceDiffFile[] };

export const MAX_DIFF_LINES = 2000;
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;
const GIT_BUFFER = 16 * 1024 * 1024;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    maxBuffer: GIT_BUFFER,
  });
  return stdout;
}

interface StatusEntry {
  path: string;
  oldPath?: string;
  status: WorkspaceFileStatus;
}

function parsePorcelain(z: string): StatusEntry[] {
  const entries: StatusEntry[] = [];
  const parts = z.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const x = rec[0];
    const y = rec[1];
    const p = rec.slice(3);
    if (x === "R" || y === "R" || x === "C" || y === "C") {
      const oldPath = parts[++i] ?? "";
      entries.push({ path: p, oldPath, status: "renamed" });
      continue;
    }
    const status: WorkspaceFileStatus =
      x === "?"
        ? "untracked"
        : x === "A" || y === "A"
          ? "added"
          : x === "D" || y === "D"
            ? "deleted"
            : "modified";
    entries.push({ path: p, status });
  }
  return entries;
}

function truncateHunks(hunks: string): { hunks: string; truncated: boolean } {
  const lines = hunks.split("\n");
  if (lines.length <= MAX_DIFF_LINES) return { hunks, truncated: false };
  return { hunks: lines.slice(0, MAX_DIFF_LINES).join("\n"), truncated: true };
}

async function diffForTracked(
  repoRoot: string,
  base: string[],
  entry: StatusEntry,
): Promise<WorkspaceDiffFile> {
  const num = await git(repoRoot, [
    "diff",
    ...base,
    "--numstat",
    "--",
    entry.path,
  ]).catch(() => "");
  const m = num.split("\n")[0]?.match(/^(\d+|-)\t(\d+|-)\t/);
  const binary = m ? m[1] === "-" : false;
  const additions = m && m[1] !== "-" ? parseInt(m[1], 10) : 0;
  const deletions = m && m[2] !== "-" ? parseInt(m[2], 10) : 0;

  let hunks = "";
  let truncated = false;
  if (!binary) {
    const patch = await git(repoRoot, ["diff", ...base, "--", entry.path]).catch(
      () => "",
    );
    const at = patch.indexOf("@@");
    const body = at === -1 ? "" : patch.slice(at).trimEnd();
    ({ hunks, truncated } = truncateHunks(body));
  }
  return {
    path: entry.path,
    status: entry.status,
    oldPath: entry.oldPath,
    additions,
    deletions,
    hunks,
    truncated,
    binary,
  };
}

const UNREADABLE: Omit<WorkspaceDiffFile, "path" | "status"> = {
  additions: 0,
  deletions: 0,
  hunks: "",
  truncated: false,
  binary: true,
};

async function diffForUntracked(
  repoRoot: string,
  entry: StatusEntry,
): Promise<WorkspaceDiffFile> {
  const full = path.join(repoRoot, entry.path);
  try {
    const st = await fs.promises.stat(full);
    if (!st.isFile() || st.size > MAX_UNTRACKED_BYTES) {
      return { path: entry.path, status: "untracked", ...UNREADABLE };
    }
    const buf = await fs.promises.readFile(full);
    if (buf.subarray(0, 8192).includes(0)) {
      return { path: entry.path, status: "untracked", ...UNREADABLE };
    }
    const lines = buf.toString("utf-8").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const truncated = lines.length > MAX_DIFF_LINES;
    const shown = truncated ? lines.slice(0, MAX_DIFF_LINES) : lines;
    return {
      path: entry.path,
      status: "untracked",
      additions: lines.length,
      deletions: 0,
      hunks: shown.map((l) => `+${l}`).join("\n"),
      truncated,
      binary: false,
    };
  } catch {
    return { path: entry.path, status: "untracked", ...UNREADABLE };
  }
}

export async function getWorkspaceDiff(cwd: string): Promise<WorkspaceDiffResult> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { kind: "not-a-repo" };
  }

  const root =
    (await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => "")).trim() ||
    cwd;

  const hasHead = await git(cwd, ["rev-parse", "--verify", "HEAD"]).then(
    () => true,
    () => false,
  );
  const base = hasHead ? ["HEAD"] : ["--cached"];

  const status = await git(cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]).catch(() => "");
  const entries = parsePorcelain(status);

  const files: WorkspaceDiffFile[] = [];
  for (const entry of entries) {
    files.push(
      entry.status === "untracked"
        ? await diffForUntracked(root, entry)
        : await diffForTracked(root, base, entry),
    );
  }
  return { kind: "ok", files };
}

export type RevertWorkspaceDiffResult =
  | { ok: true }
  | { ok: false; error: string };

function resolveInsideRepo(repoRoot: string, rel: string): string | null {
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, rel);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) return null;
  return abs;
}

export async function revertWorkspaceDiff(
  cwd: string,
  paths?: string[],
): Promise<RevertWorkspaceDiffResult> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { ok: false, error: "非 git 仓库" };
  }

  const root =
    (await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => "")).trim() ||
    cwd;

  let status: string;
  try {
    status = await git(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  let entries = parsePorcelain(status);

  if (paths !== undefined) {
    for (const p of paths) {
      if (!resolveInsideRepo(root, p)) {
        return { ok: false, error: `非法路径：${p}` };
      }
    }
    const want = new Set(paths);
    entries = entries.filter((e) => want.has(e.path));
  }

  if (entries.length === 0) return { ok: true };

  const hasHead = await git(root, ["rev-parse", "--verify", "HEAD"]).then(
    () => true,
    () => false,
  );

  const trackedArgs: string[] = [];
  for (const entry of entries) {
    if (entry.status === "untracked") {
      const abs = resolveInsideRepo(root, entry.path);
      if (!abs) return { ok: false, error: `非法路径：${entry.path}` };
      try {
        await fs.promises.rm(abs, { recursive: true, force: true });
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      continue;
    }
    const abs = resolveInsideRepo(root, entry.path);
    if (!abs) return { ok: false, error: `非法路径：${entry.path}` };
    trackedArgs.push(entry.path);
    if (entry.oldPath) {
      const oldAbs = resolveInsideRepo(root, entry.oldPath);
      if (!oldAbs) return { ok: false, error: `非法路径：${entry.oldPath}` };
      trackedArgs.push(entry.oldPath);
    }
  }

  if (trackedArgs.length > 0) {
    const restore = hasHead
      ? ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...trackedArgs]
      : ["restore", "--staged", "--worktree", "--", ...trackedArgs];
    try {
      await git(root, restore);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { ok: true };
}
