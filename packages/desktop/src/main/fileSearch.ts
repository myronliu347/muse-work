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
  /** When true, apply .gitignore (same rules as listWorkspaceDir). */
  respectGitignore?: boolean;
  /** When true, only return files (still recurse into dirs). */
  filesOnly?: boolean;
};

export type ListWorkspaceDirOptions = {
  /** When true, apply .gitignore rules (plus always-skip node_modules/.git). */
  respectGitignore?: boolean;
};

export type ContentSearchMatch = {
  line: number; // 1-based
  text: string;
  startCol: number; // 0-based
  endCol: number;
};

export type ContentSearchFileHit = {
  path: string;
  relativePath: string;
  matches: ContentSearchMatch[];
};

export type SearchContentOptions = {
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  maxFiles?: number;
  maxMatches?: number;
  maxFileBytes?: number;
};

export type SearchContentResult = {
  results: ContentSearchFileHit[];
  totalMatches: number;
  truncated?: boolean;
  error?: string;
};

const MAX_MATCH_LINE_CHARS = 400;

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
  const respectGitignore = Boolean(options.respectGitignore);
  const filesOnly = Boolean(options.filesOnly);

  if (!workdir || !fs.existsSync(workdir)) {
    return [];
  }

  const workdirAbs = path.resolve(workdir);
  const ig = respectGitignore ? loadIgnoreFilter(workdirAbs) : null;
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
      if (name === ".DS_Store") continue;
      if (name === "node_modules" || name === ".git") continue;
      if (!ig && entry.isDirectory() && isSkippedDir(name)) continue;

      const rel = relDir ? `${relDir}/${name}` : name;
      const isDirectory = entry.isDirectory();
      if (ig) {
        const check = isDirectory ? `${rel}/` : rel;
        try {
          if (ig.ignores(check)) continue;
        } catch {
          /* keep */
        }
      }

      visited += 1;
      const abs = path.join(absDir, name);
      const relativePath = isDirectory ? `${rel}/` : rel;
      if (!(filesOnly && isDirectory)) {
        const score = scoreMatch(relativePath, name, query);
        if (score > 0) {
          hits.push({
            ...toWorkspaceSuggestion(abs, rel, name, isDirectory),
            score,
          });
        }
      }

      if (isDirectory) {
        walk(abs, rel);
      }
    }
  };

  walk(workdirAbs, "");

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return hits.slice(0, maxResults).map(({ score: _s, ...item }) => item);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Search the whole workdir for a file whose basename exactly matches the given
 * relative path's basename (the path prefix may be stale). Used as a fallback
 * when resolving a markdown link against the workdir misses. Returns the first
 * (best-scored) exact-name file hit, or undefined when none exists.
 */
export function findFileByBasename(
  workdir: string,
  relativePath: string,
): string | undefined {
  const base = path.basename(relativePath);
  if (!base) return undefined;
  const hits = searchWorkspaceFiles(workdir, {
    query: base,
    filesOnly: true,
    maxResults: 20,
  });
  const exact = hits.find((h) => !h.isDirectory && h.name === base);
  return exact?.path;
}

function buildContentMatcher(
  options: SearchContentOptions,
): { re: RegExp } | { error: string } {
  const query = (options.query ?? "").trim();
  const flags = options.caseSensitive ? "g" : "gi";
  try {
    if (options.regex) {
      return { re: new RegExp(query, flags) };
    }
    const body = escapeRegExp(query);
    const pattern = options.wholeWord ? `\\b${body}\\b` : body;
    return { re: new RegExp(pattern, flags) };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function truncateMatchLine(
  line: string,
  startCol: number,
  endCol: number,
): { text: string; startCol: number; endCol: number } {
  if (line.length <= MAX_MATCH_LINE_CHARS) {
    return { text: line, startCol, endCol };
  }
  const matchLen = Math.max(0, endCol - startCol);
  const pad = Math.max(0, Math.floor((MAX_MATCH_LINE_CHARS - matchLen) / 2));
  let from = Math.max(0, startCol - pad);
  let to = Math.min(line.length, from + MAX_MATCH_LINE_CHARS);
  if (to - from < MAX_MATCH_LINE_CHARS) {
    from = Math.max(0, to - MAX_MATCH_LINE_CHARS);
  }
  return {
    text: line.slice(from, to),
    startCol: startCol - from,
    endCol: endCol - from,
  };
}

/**
 * Scan text files under workdir for content matches (gitignore-aware).
 */
export function searchContentInWorkspace(
  workdir: string,
  options: SearchContentOptions,
): SearchContentResult {
  const query = (options.query ?? "").trim();
  if (!query || !workdir || !fs.existsSync(workdir)) {
    return { results: [], totalMatches: 0 };
  }

  const matcher = buildContentMatcher(options);
  if ("error" in matcher) {
    return { results: [], totalMatches: 0, error: matcher.error };
  }
  const { re } = matcher;

  const maxFiles = options.maxFiles ?? 5000;
  const maxMatches = options.maxMatches ?? 2000;
  const maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;

  const workdirAbs = path.resolve(workdir);
  const ig = loadIgnoreFilter(workdirAbs);
  const byFile = new Map<string, ContentSearchFileHit>();
  let totalMatches = 0;
  let filesVisited = 0;
  let truncated = false;

  const walk = (absDir: string, relDir: string): void => {
    if (truncated || filesVisited >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (truncated || filesVisited >= maxFiles) break;
      const name = entry.name;
      if (name === ".DS_Store") continue;
      if (name === "node_modules" || name === ".git") continue;

      const rel = relDir ? `${relDir}/${name}` : name;
      const isDirectory = entry.isDirectory();
      const check = isDirectory ? `${rel}/` : rel;
      try {
        if (ig.ignores(check)) continue;
      } catch {
        /* keep */
      }

      const abs = path.join(absDir, name);
      if (isDirectory) {
        walk(abs, rel);
        continue;
      }

      filesVisited += 1;
      if (filesVisited > maxFiles) {
        truncated = true;
        break;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size > maxFileBytes) continue;

      let buf: Buffer;
      try {
        buf = fs.readFileSync(abs);
      } catch {
        continue;
      }
      if (buf.subarray(0, Math.min(buf.length, 8192)).includes(0)) continue;

      const content = buf.toString("utf8");
      const lines = content.split("\n");
      const fileMatches: ContentSearchMatch[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (truncated) break;
        // Drop trailing empty from final newline for line text, but keep index
        const line = lines[i];
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          if (m[0].length === 0) {
            re.lastIndex += 1;
            if (re.lastIndex > line.length) break;
            continue;
          }
          const startCol = m.index;
          const endCol = m.index + m[0].length;
          const clipped = truncateMatchLine(line, startCol, endCol);
          fileMatches.push({
            line: i + 1,
            text: clipped.text,
            startCol: clipped.startCol,
            endCol: clipped.endCol,
          });
          totalMatches += 1;
          if (totalMatches >= maxMatches) {
            truncated = true;
            break;
          }
        }
      }

      if (fileMatches.length > 0) {
        byFile.set(rel, {
          path: abs,
          relativePath: rel,
          matches: fileMatches,
        });
      }
    }
  };

  walk(workdirAbs, "");

  return {
    results: Array.from(byFile.values()),
    totalMatches,
    truncated: truncated || undefined,
  };
}
