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
  | { kind: "error"; message: string }
  | { kind: "ok"; files: WorkspaceDiffFile[] };

export type CommitCompare = "patch" | "head" | "worktree";

export interface GitCommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

export type ListCommitsResult =
  | { kind: "not-a-repo" }
  | { kind: "ok"; commits: GitCommitSummary[] };

/** Well-known hash of the empty tree; used to diff a root commit. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const RECENT_COMMIT_LIMIT = 50;

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

function parseNameStatusZ(z: string): StatusEntry[] {
  const parts = z.split("\0");
  const entries: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i];
    if (!token) continue;
    const code = token[0];
    if (code === "R" || code === "C") {
      const oldPath = parts[++i] ?? "";
      const filePath = parts[++i] ?? "";
      if (!filePath) continue;
      entries.push({ path: filePath, oldPath, status: "renamed" });
      continue;
    }
    const filePath = parts[++i] ?? "";
    if (!filePath) continue;
    const status: WorkspaceFileStatus =
      code === "A" ? "added" : code === "D" ? "deleted" : "modified";
    entries.push({ path: filePath, status });
  }
  return entries;
}

/** Reject option-like or whitespace revisions before they reach git. */
function isSafeRev(rev: string): boolean {
  return rev.length > 0 && rev.length <= 200 && !rev.startsWith("-") && !/[\0\s]/.test(rev);
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

export async function listRecentCommits(
  cwd: string,
  limit = RECENT_COMMIT_LIMIT,
): Promise<ListCommitsResult> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { kind: "not-a-repo" };
  }

  const n = Math.min(Math.max(Math.floor(limit), 1), 100);
  let out = "";
  try {
    out = await git(cwd, [
      "log",
      "-z",
      "-n",
      String(n),
      "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI",
    ]);
  } catch {
    return { kind: "ok", commits: [] };
  }

  const commits: GitCommitSummary[] = [];
  for (const rec of out.split("\0")) {
    if (!rec) continue;
    const [hash, shortHash, subject, author, date] = rec.split("\x1f");
    if (!hash || !shortHash) continue;
    commits.push({
      hash,
      shortHash,
      subject: subject ?? "",
      author: author ?? "",
      date: date ?? "",
    });
  }
  return { kind: "ok", commits };
}

export async function getCommitDiff(
  cwd: string,
  rev: string,
  compare: CommitCompare,
): Promise<WorkspaceDiffResult> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { kind: "not-a-repo" };
  }
  if (
    !isSafeRev(rev) ||
    (compare !== "patch" && compare !== "head" && compare !== "worktree")
  ) {
    return { kind: "error", message: "找不到该提交" };
  }

  const root =
    (await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => "")).trim() ||
    cwd;

  let resolved: string;
  try {
    resolved = (
      await git(cwd, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${rev}^{commit}`,
      ])
    ).trim();
  } catch {
    return { kind: "error", message: "找不到该提交" };
  }

  // patch: parent..commit (root commits diff against the empty tree).
  // head: commit..HEAD. worktree: commit..worktree.
  let parent = resolved;
  if (compare === "patch") {
    try {
      parent = (
        await git(cwd, ["rev-parse", "--verify", "--end-of-options", `${resolved}^`])
      ).trim();
    } catch {
      parent = EMPTY_TREE;
    }
  }
  const diffBase =
    compare === "patch"
      ? ["-M", parent, resolved]
      : compare === "head"
        ? ["-M", resolved, "HEAD"]
        : ["-M", resolved];

  let nameStatus = "";
  try {
    nameStatus = await git(root, ["diff", "--name-status", "-z", ...diffBase]);
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : "无法读取差异",
    };
  }

  const entries = parseNameStatusZ(nameStatus);
  if (compare === "worktree") {
    const status = await git(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]).catch(() => "");
    for (const entry of parsePorcelain(status)) {
      if (entry.status === "untracked") entries.push(entry);
    }
  }

  const files: WorkspaceDiffFile[] = [];
  for (const entry of entries) {
    files.push(
      entry.status === "untracked"
        ? await diffForUntracked(root, entry)
        : await diffForTracked(root, diffBase, entry),
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
