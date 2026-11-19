import fs from "node:fs";
import path from "node:path";

/**
 * Mechanical checks for a memory directory.
 *
 * Run against a dream draft before it is adopted, and against the live
 * directory after a rollback. Nothing here needs a model: these are the
 * invariants the memory system already assumes (`MEMORY.md` is the only way a
 * topic file is discovered, the index has a hard read budget, each file has a
 * bounded size).
 */

export const MEMORY_INDEX_NAME = "MEMORY.md";
export const MEMORY_FILE_MAX_BYTES = 4096;
export const MEMORY_INDEX_MAX_CHARS = 22_000;
export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"];

export interface MemoryDirStats {
  files: number;
  orphans: number;
  indexChars: number;
  indexLines: number;
}

export interface MemoryLintResult extends MemoryDirStats {
  ok: boolean;
  /** Index links whose target file does not exist. */
  dangling: string[];
  /** Files with no index entry at all. */
  orphanFiles: string[];
  /** Files over the per-file byte cap. */
  overCap: string[];
  /** Missing or invalid `type` in frontmatter. */
  badType: string[];
  /** Missing `name` or `description`. */
  badFrontmatter: string[];
  /** Same description used by more than one file. */
  duplicateDescriptions: string[][];
  indexMissing: boolean;
  indexOverChars: boolean;
  indexOverLines: boolean;
}

function listMemoryFiles(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        entry.name !== MEMORY_INDEX_NAME,
    )
    .map((entry) => entry.name)
    .sort();
}

export function readMemoryFrontmatter(
  raw: string,
): Record<string, string> | undefined {
  if (!raw.startsWith("---\n")) return undefined;
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return undefined;
  const block = raw.slice(4, end);
  const fields: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}

export function lintMemoryDir(dir: string): MemoryLintResult {
  const files = listMemoryFiles(dir);
  const indexFile = path.join(dir, MEMORY_INDEX_NAME);
  const indexMissing = !fs.existsSync(indexFile);
  const indexRaw = indexMissing ? "" : fs.readFileSync(indexFile, "utf-8");
  const indexChars = indexRaw.trim().length;
  const indexLines = indexRaw.trim() ? indexRaw.trim().split("\n").length : 0;

  const links = [
    ...indexRaw.matchAll(/\]\(([^)]+\.md)\)/g),
  ].map((match) => match[1]);

  // Overflow archive: MEMORY.md lists most files directly; lower-priority ones
  // sit in `archive*.md`, which MEMORY.md points at with one line. Reachable
  // at either level counts as indexed.
  const linked = new Set(links);
  const archiveFiles = files.filter(
    (file) => file === "archive.md" || file.startsWith("archive_"),
  );
  const archiveLinks = new Set<string>();
  for (const archive of archiveFiles) {
    try {
      const raw = fs.readFileSync(path.join(dir, archive), "utf-8");
      for (const match of raw.matchAll(/\]\(([^)]+\.md)\)/g)) {
        archiveLinks.add(match[1]);
      }
    } catch {
      // Unreadable archive: its members surface as orphans.
    }
  }
  const reachable = new Set([...linked, ...archiveLinks]);
  const dangling = [...reachable].filter(
    (link) => !fs.existsSync(path.join(dir, link)),
  );
  const orphanFiles = files.filter((file) => !reachable.has(file));

  const overCap: string[] = [];
  const badType: string[] = [];
  const badFrontmatter: string[] = [];
  const byDescription = new Map<string, string[]>();

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const raw = fs.readFileSync(fullPath, "utf-8");
    // Archive pages are indexes, not memory notes; their size scales with the
    // number of archived files and is not the 4 KB note budget.
    const isIndexPage =
      file === "archive.md" || file.startsWith("archive_");
    if (!isIndexPage && Buffer.byteLength(raw, "utf-8") > MEMORY_FILE_MAX_BYTES) {
      overCap.push(file);
    }
    const frontmatter = readMemoryFrontmatter(raw);
    if (!frontmatter?.name || !frontmatter?.description) {
      badFrontmatter.push(file);
    }
    const type = frontmatter?.type;
    if (!type || !MEMORY_TYPES.includes(type)) {
      badType.push(file);
    }
    const description = (frontmatter?.description ?? "").trim();
    if (description) {
      const key = description.replace(/\s+/g, " ").toLowerCase();
      const group = byDescription.get(key) ?? [];
      group.push(file);
      byDescription.set(key, group);
    }
  }

  const duplicateDescriptions = [...byDescription.values()].filter(
    (group) => group.length > 1,
  );
  const indexOverChars = indexChars > MEMORY_INDEX_MAX_CHARS;
  const indexOverLines = indexLines > MEMORY_INDEX_MAX_LINES;

  const ok =
    !indexMissing &&
    dangling.length === 0 &&
    orphanFiles.length === 0 &&
    overCap.length === 0 &&
    badType.length === 0 &&
    badFrontmatter.length === 0 &&
    duplicateDescriptions.length === 0 &&
    !indexOverChars &&
    !indexOverLines;

  return {
    ok,
    files: files.length,
    orphans: orphanFiles.length,
    indexChars,
    indexLines,
    dangling,
    orphanFiles,
    overCap,
    badType,
    badFrontmatter,
    duplicateDescriptions,
    indexMissing,
    indexOverChars,
    indexOverLines,
  };
}

/**
 * Failures that must block adoption even when a person accepts warnings:
 * the index is unusable (missing/over capacity) or points at files that are
 * not there / files that cannot be read by the memory layer.
 *
 * Orphans and over-cap files are warnings: an existing store already has
 * them, and a draft may reduce them without reaching zero.
 */
export function hasCriticalMemoryLint(lint: MemoryLintResult): boolean {
  return (
    lint.indexMissing ||
    lint.indexOverChars ||
    lint.indexOverLines ||
    lint.dangling.length > 0 ||
    lint.badFrontmatter.length > 0 ||
    lint.badType.length > 0
  );
}

export function memoryDirStats(dir: string): MemoryDirStats {
  const lint = lintMemoryDir(dir);
  return {
    files: lint.files,
    orphans: lint.orphans,
    indexChars: lint.indexChars,
    indexLines: lint.indexLines,
  };
}
