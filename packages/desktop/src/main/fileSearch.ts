/**
 * Lightweight workspace file search for @ mentions (local desktop only).
 * Avoids pulling wave-agent-sdk / ripgrep into the Electron main process.
 */

import fs from "node:fs";
import path from "node:path";
import ignore from "ignore";

const SKIP_DIR_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  "node_modules",
  ".pnpm-store",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "release",
  "target",
  "__pycache__",
  ".venv",
  "venv",
]);

export type WorkspaceFileSuggestion = {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  icon: string;
  isDirectory: boolean;
};

export type SearchWorkspaceFilesOptions = {
  query?: string;
  maxResults?: number;
  /** Soft cap on filesystem entries visited (files + dirs). */
  maxVisit?: number;
};

export type ListWorkspaceDirOptions = {
  /** When true, apply .gitignore rules (plus always-skip node_modules/.git). */
  respectGitignore?: boolean;
};

function isSkippedDir(name: string): boolean {
  return SKIP_DIR_NAMES.has(name) || name.startsWith(".");
}

function toWorkspaceSuggestion(
  abs: string,
  rel: string,
  name: string,
  isDirectory: boolean,
): WorkspaceFileSuggestion {
  const relativePath = isDirectory ? `${rel}/` : rel;
  const extensionMatch = !isDirectory ? name.match(/\.([^.]+)$/) : null;
  return {
    path: abs,
    relativePath,
    name,
    extension: extensionMatch ? extensionMatch[1] : "",
    icon: isDirectory ? "codicon-folder" : "codicon-file",
    isDirectory,
  };
}

/** Always hide these; merge .gitignore from workdir up to the git repo root.
 *  If workdir is not inside a git repo, only the workdir's own .gitignore applies
 *  (never walk to / or $HOME — that would inherit unrelated ignore rules). */
function loadIgnoreFilter(workdirAbs: string) {
  const ig = ignore();
  ig.add(["node_modules/", ".git/"]);

  const hasGit = (dir: string) => fs.existsSync(path.join(dir, ".git"));
  let inRepo = false;
  let dir = workdirAbs;
  for (;;) {
    if (hasGit(dir)) {
      inRepo = true;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (!inRepo) {
    try {
      ig.add(fs.readFileSync(path.join(workdirAbs, ".gitignore"), "utf8"));
    } catch {
      /* missing is fine */
    }
    return ig;
  }

  dir = workdirAbs;
  for (;;) {
    const gi = path.join(dir, ".gitignore");
    try {
      ig.add(fs.readFileSync(gi, "utf8"));
    } catch {
      /* missing is fine */
    }
    if (hasGit(dir)) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return ig;
}

/**
 * List direct children of `dir` (relative to workdir). Does not recurse.
 */
export function listWorkspaceDir(
  workdir: string,
  dir = "",
  options: ListWorkspaceDirOptions = {},
): WorkspaceFileSuggestion[] {
  if (!workdir || !fs.existsSync(workdir)) {
    return [];
  }

  const normalized = dir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (normalized.split("/").some((seg) => seg === ".." || seg === ".")) {
    return [];
  }

  const workdirAbs = path.resolve(workdir);
  const target = normalized
    ? path.resolve(workdirAbs, ...normalized.split("/"))
    : workdirAbs;
  const relToRoot = path.relative(workdirAbs, target);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) return [];
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return [];
  }

  const ig = options.respectGitignore ? loadIgnoreFilter(workdirAbs) : null;

  const items: WorkspaceFileSuggestion[] = [];
  for (const entry of entries) {
    const name = entry.name;
    if (name === ".DS_Store") continue;
    if (name === "node_modules" || name === ".git") continue;
    if (!ig && entry.isDirectory() && isSkippedDir(name)) continue;
    const rel = normalized ? `${normalized}/${name}` : name;
    if (ig) {
      const check = entry.isDirectory() ? `${rel}/` : rel;
      try {
        if (ig.ignores(check)) continue;
      } catch {
        /* invalid path for ignore — keep entry */
      }
    }
    const abs = path.join(target, name);
    items.push(toWorkspaceSuggestion(abs, rel, name, entry.isDirectory()));
  }

  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

function scoreMatch(relativePath: string, name: string, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  const p = relativePath.toLowerCase();
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.includes(q)) return 60;
  if (p.includes(q)) return 40;
  // fuzzy: all query chars appear in order in name
  let qi = 0;
  for (let i = 0; i < n.length && qi < q.length; i++) {
    if (n[i] === q[qi]) qi++;
  }
  return qi === q.length ? 20 : 0;
}

/**
 * Walk workdir and return fuzzy-filtered file/dir suggestions.
 */
export function searchWorkspaceFiles(
  workdir: string,
  options: SearchWorkspaceFilesOptions = {},
): WorkspaceFileSuggestion[] {
  const query = (options.query ?? "").trim();
  const maxResults = options.maxResults ?? 20;
  const maxVisit = options.maxVisit ?? 8000;

  if (!workdir || !fs.existsSync(workdir)) {
    return [];
  }

  const hits: Array<WorkspaceFileSuggestion & { score: number }> = [];
  let visited = 0;

  const walk = (absDir: string, relDir: string): void => {
    if (visited >= maxVisit || hits.length >= maxResults * 8) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (visited >= maxVisit) break;
      const name = entry.name;
      if (entry.isDirectory() && isSkippedDir(name)) continue;
      if (name === ".DS_Store") continue;

      visited += 1;
      const rel = relDir ? `${relDir}/${name}` : name;
      const abs = path.join(absDir, name);
      const isDirectory = entry.isDirectory();
      const relativePath = isDirectory ? `${rel}/` : rel;
      const score = scoreMatch(relativePath, name, query);
      if (score > 0) {
        hits.push({
          ...toWorkspaceSuggestion(abs, rel, name, isDirectory),
          score,
        });
      }

      if (isDirectory) {
        walk(abs, rel);
      }
    }
  };

  walk(workdir, "");

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return hits.slice(0, maxResults).map(({ score: _s, ...item }) => item);
}
