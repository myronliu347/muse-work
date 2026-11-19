import fs from "node:fs";
import path from "node:path";
import {
  MEMORY_INDEX_NAME,
  MEMORY_TYPES,
  readMemoryFrontmatter,
} from "./memoryDreamLint.js";

/**
 * Maintain a flat `MEMORY.md` with an overflow archive, without rewriting the
 * lines a person or an earlier pass already wrote.
 *
 * An earlier version regenerated every entry from filenames and truncated the
 * titles to 12 characters, which destroyed the curated index: descriptions were
 * gone and almost every line ended in "…". This version instead:
 *
 * - keeps existing index lines verbatim (title + description stay as written);
 * - appends only the files that have no pointer yet, with their full title;
 * - when the entrypoint is over budget, moves whole lines (oldest files first)
 *   to `archive.md` instead of shortening what stays.
 *
 * `MEMORY.md` and `archive*.md` are still derived in the sense that this
 * function may move lines around, but it never invents a shorter title.
 */

export const ARCHIVE_FILE = "archive.md";
export const INDEX_BUDGET_CHARS = 20_000;
const MAX_INDEX_LINES = 195;
const MAX_LINE_CHARS = 160;

const TYPE_ORDER = ["user", "feedback", "project", "reference"] as const;
const TYPE_LABEL: Record<string, string> = {
  user: "用户",
  feedback: "规则",
  project: "项目",
  reference: "参考",
};
const TYPE_RANK: Record<string, number> = {
  user: 0,
  feedback: 1,
  project: 2,
  reference: 3,
};
/** Existing indexes use English headings (Claude Code style); accept both. */
const SECTION_ALIASES: Record<string, string[]> = {
  user: ["User", "用户"],
  feedback: ["Feedback", "规则"],
  project: ["Project", "项目"],
  reference: ["Reference", "参考"],
};

export interface RebuildIndexResult {
  direct: number;
  archived: number;
  indexChars: number;
  indexLines: number;
}

interface MemoryEntry {
  file: string;
  name: string;
  description: string;
  type: string;
  mtime: number;
}

function isDerived(file: string): boolean {
  return (
    file === MEMORY_INDEX_NAME ||
    file === ARCHIVE_FILE ||
    file.startsWith("archive_") ||
    file.startsWith("index_")
  );
}

function readEntries(dir: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md") || isDerived(file)) continue;
    const full = path.join(dir, file);
    let raw = "";
    let mtime = 0;
    try {
      raw = fs.readFileSync(full, "utf-8");
      mtime = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }
    const frontmatter = readMemoryFrontmatter(raw) ?? {};
    entries.push({
      file,
      name: frontmatter.name?.trim() || file.replace(/\.md$/, ""),
      description: frontmatter.description?.trim() ?? "",
      type: MEMORY_TYPES.includes(frontmatter.type as never)
        ? (frontmatter.type as string)
        : "reference",
      mtime,
    });
  }
  return entries;
}

function linksIn(line: string): string[] {
  return [...line.matchAll(/\]\(([^)]+\.md)\)/g)].map((match) => match[1]);
}

function readIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function entryLine(entry: MemoryEntry): string {
  const prefix = `- [${entry.name}](${entry.file})`;
  const withDescription = entry.description
    ? `${prefix} — ${entry.description}`
    : prefix;
  if (withDescription.length <= MAX_LINE_CHARS) return withDescription;
  // Never truncate a title, and never leave a half sentence: keep the pointer
  // and drop the description instead of appending an ellipsis.
  return prefix;
}

function sectionFor(lines: string[], type: string): number {
  const aliases = SECTION_ALIASES[type] ?? [];
  return lines.findIndex((line) => {
    if (!line.startsWith("## ")) return false;
    const label = line.slice(3).trim();
    return aliases.includes(label);
  });
}

function insertEntry(lines: string[], type: string, line: string): void {
  const headerIndex = sectionFor(lines, type);
  if (headerIndex === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(`## ${TYPE_LABEL[type] ?? type}`, line);
    return;
  }
  let insertAt = headerIndex + 1;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) break;
    if (lines[i].trim() !== "") insertAt = i + 1;
  }
  lines.splice(insertAt, 0, line);
}

function archiveLinkLines(raw: string): string[] {
  return raw
    .split("\n")
    .filter((line) => !line.startsWith("---") && !line.startsWith("name:"))
    .filter((line) => !line.startsWith("description:"))
    .filter((line) => !line.startsWith("type:"))
    .filter((line) => !line.startsWith("archive:"))
    .filter((line) => linksIn(line).length > 0 || line.startsWith("## "));
}

export function rebuildFlatIndex(dir: string): RebuildIndexResult {
  for (const file of fs.readdirSync(dir)) {
    if (file.startsWith("index_")) fs.rmSync(path.join(dir, file), { force: true });
  }

  const entries = readEntries(dir);
  const byFile = new Map(entries.map((entry) => [entry.file, entry]));
  const existingIndex = readIfExists(path.join(dir, MEMORY_INDEX_NAME));
  const existingArchive = readIfExists(path.join(dir, ARCHIVE_FILE));

  const lines = existingIndex.trim()
    ? existingIndex.trimEnd().split("\n")
    : ["# 记忆索引", ""];
  // The archive pointer is regenerated below; drop stale copies first.
  const withoutPointer = lines.filter(
    (line) => !/\]\(archive(?:_\d+)?\.md\)/.test(line),
  );
  lines.length = 0;
  lines.push(...withoutPointer);

  const archivedLines = archiveLinkLines(existingArchive);
  const indexed = new Set(
    [...lines, ...archivedLines].flatMap((line) => linksIn(line)),
  );

  const missing = entries
    .filter((entry) => !indexed.has(entry.file))
    .sort((a, b) => {
      const rank = (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9);
      if (rank !== 0) return rank;
      return b.mtime - a.mtime;
    });
  for (const entry of missing) {
    insertEntry(lines, entry.type, entryLine(entry));
  }

  const lineMtime = (line: string): number => {
    const times = linksIn(line)
      .map((file) => byFile.get(file)?.mtime ?? 0)
      .filter((time) => time > 0);
    return times.length > 0 ? Math.min(...times) : 0;
  };

  const contentLength = () => lines.join("\n").trimEnd().length;
  const movable = () =>
    lines
      .map((line, index) => ({ line, index }))
      .filter(
        ({ line }) =>
          linksIn(line).length > 0 &&
          !/\]\(archive(?:_\d+)?\.md\)/.test(line) &&
          !line.startsWith("#"),
      );

  while (
    (contentLength() > INDEX_BUDGET_CHARS || lines.length > MAX_INDEX_LINES) &&
    movable().length > 0
  ) {
    const victim = movable().sort((a, b) => {
      // Archive low-value types first: reference, then project, then feedback,
      // and only then user notes.
      const rankOf = (line: string) => {
        const files = linksIn(line);
        const ranks = files.map((file) => {
          const type = byFile.get(file)?.type ?? "reference";
          return type === "reference"
            ? 0
            : type === "project"
              ? 1
              : type === "feedback"
                ? 2
                : 3;
        });
        return ranks.length > 0 ? Math.min(...ranks) : 0;
      };
      const rank = rankOf(a.line) - rankOf(b.line);
      if (rank !== 0) return rank;
      return lineMtime(a.line) - lineMtime(b.line);
    })[0];
    archivedLines.push(victim.line);
    lines.splice(victim.index, 1);
  }

  let archiveContent = "";
  if (archivedLines.length > 0) {
    const archivedCount = archivedLines.reduce(
      (sum, line) => sum + linksIn(line).length,
      0,
    );
    archiveContent =
      [
        "---",
        "name: 归档索引",
        `description: ${archivedCount} 个低优先级记忆文件的清单；需要翻旧记录时先读这里，再打开具体文件。`,
        "type: reference",
        "archive: true",
        "---",
        "",
        "# 归档（低优先级）",
        "",
        ...archivedLines,
      ]
        .join("\n")
        .trim() + "\n";
    fs.writeFileSync(path.join(dir, ARCHIVE_FILE), archiveContent, "utf-8");
    lines.push(
      "",
      "## 归档",
      `- [归档：${archivedCount} 个低优先级文件](${ARCHIVE_FILE}) — 旧项目/参考记录，需要时再打开`,
      "",
    );
  } else {
    fs.rmSync(path.join(dir, ARCHIVE_FILE), { force: true });
  }

  const content = `${lines.join("\n").trim()}\n`;
  fs.writeFileSync(path.join(dir, MEMORY_INDEX_NAME), content, "utf-8");

  const direct = [...content.matchAll(/\]\(([^)]+\.md)\)/g)].filter(
    (match) => match[1] !== ARCHIVE_FILE,
  ).length;
  return {
    direct,
    archived: archivedLines.length > 0
      ? archivedLines.reduce((sum, line) => sum + linksIn(line).length, 0)
      : 0,
    indexChars: content.trim().length,
    indexLines: content.trim().split("\n").length,
  };
}

/** Kept for callers that only care about the type label. */
export function memoryTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}
