import fs from "node:fs";
import path from "node:path";
import {
  MEMORY_INDEX_NAME,
  MEMORY_TYPES,
  readMemoryFrontmatter,
} from "./memoryDreamLint.js";

/**
 * Build a flat `MEMORY.md` with an overflow archive.
 *
 * The entrypoint stays a one-line-per-file list — no intermediate hub layer —
 * but a few hundred long filenames do not fit its 25k-character budget with
 * full descriptions. Important files are listed directly; the low-priority
 * remainder is listed in `archive.md`, which MEMORY.md points at with a single
 * line. That keeps every file reachable without changing how a memory entry
 * looks.
 *
 * `MEMORY.md`, `archive*.md` and legacy `index_*` pages are derived data; this
 * function regenerates them from frontmatter.
 */

export const ARCHIVE_FILE = "archive.md";
export const INDEX_BUDGET_CHARS = 21_500;
const MAX_TITLE_CHARS = 12;
/** Rough per-entry cost: `[title](file) · ` + a little slack. */
function entryChars(name: string, file: string): number {
  return 6 + Math.min(name.length, MAX_TITLE_CHARS) + file.length;
}

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
    const type = frontmatter.type?.trim() ?? "reference";
    entries.push({
      file,
      name: frontmatter.name?.trim() || file.replace(/\.md$/, ""),
      description: frontmatter.description?.trim() ?? "",
      type,
      mtime,
    });
  }
  return entries;
}

function titleOf(entry: MemoryEntry): string {
  const title = entry.name.replace(/\s+/g, " ").trim();
  return title.length > MAX_TITLE_CHARS
    ? `${title.slice(0, MAX_TITLE_CHARS)}…`
    : title;
}

function renderSections(
  entries: MemoryEntry[],
  perLine: number,
  lineBudget = 110,
): string[] {
  const lines: string[] = [];
  const present = new Set(entries.map((entry) => entry.type));
  const types = [
    ...TYPE_ORDER.filter((type) => present.has(type)),
    ...[...present].filter(
      (type) => !(TYPE_ORDER as readonly string[]).includes(type),
    ),
  ];
  for (const type of types) {
    const list = entries.filter((entry) => entry.type === type);
    if (list.length === 0) continue;
    lines.push(`## ${TYPE_LABEL[type] ?? type}`);
    let current: string[] = [];
    for (const entry of list) {
      const item = `[${titleOf(entry)}](${entry.file})`;
      const candidate = current.length === 0 ? item : `${current.join(" · ")} · ${item}`;
      if (current.length > 0 && (candidate.length > lineBudget || current.length >= perLine)) {
        lines.push(`- ${current.join(" · ")}`);
        current = [item];
      } else {
        current.push(item);
      }
    }
    if (current.length > 0) lines.push(`- ${current.join(" · ")}`);
    lines.push("");
  }
  return lines;
}

export function rebuildFlatIndex(dir: string): RebuildIndexResult {
  for (const file of fs.readdirSync(dir)) {
    if (file === ARCHIVE_FILE || file.startsWith("archive_") || file.startsWith("index_")) {
      fs.rmSync(path.join(dir, file), { force: true });
    }
  }

  const entries = readEntries(dir).sort((a, b) => {
    const rank = (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9);
    if (rank !== 0) return rank;
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.file.localeCompare(b.file);
  });

  // Reserve room for the archive pointer itself.
  const budget = INDEX_BUDGET_CHARS - 200;
  const direct: MemoryEntry[] = [];
  const archived: MemoryEntry[] = [];
  let used = 0;
  for (const entry of entries) {
    const cost = entryChars(entry.name, entry.file);
    if (used + cost <= budget) {
      direct.push(entry);
      used += cost;
    } else {
      archived.push(entry);
    }
  }

  const renderAll = () => {
    const lines = [
      "# 记忆索引",
      "",
      "> 一行一条直指文件；标为「归档」的低优先级文件在 archive.md 里。",
      "",
      ...renderSections(direct, 3, 180),
    ];
    if (archived.length > 0) {
      lines.push(
        "## 归档",
        `- [归档：${archived.length} 个低优先级文件](${ARCHIVE_FILE}) — 旧项目/参考记录，需要时再打开`,
        "",
      );
    }
    const archiveContent =
      archived.length > 0
        ? [
            "---",
            "name: 归档索引",
            `description: ${archived.length} 个低优先级记忆文件的清单；需要翻旧记录时先读这里，再打开具体文件。`,
            "type: reference",
            "archive: true",
            "---",
            "",
            "# 归档（低优先级）",
            "",
            ...renderSections(archived, 4, 200),
          ]
            .join("\n")
            .trim() + "\n"
        : "";
    return { content: `${lines.join("\n").trim()}\n`, archiveContent };
  };

  // The estimate above is approximate (titles, ellipses, section headers).
  // Move the lowest-priority entries to the archive until the entrypoint
  // really fits the character budget.
  let rendered = renderAll();
  while (
    rendered.content.trim().length > INDEX_BUDGET_CHARS &&
    direct.length > 0
  ) {
    const moved = direct.pop();
    if (!moved) break;
    archived.unshift(moved);
    rendered = renderAll();
  }

  if (rendered.archiveContent) {
    fs.writeFileSync(
      path.join(dir, ARCHIVE_FILE),
      rendered.archiveContent,
      "utf-8",
    );
  }

  const content = rendered.content;
  fs.writeFileSync(path.join(dir, MEMORY_INDEX_NAME), content, "utf-8");
  return {
    direct: direct.length,
    archived: archived.length,
    indexChars: content.trim().length,
    indexLines: content.trim().split("\n").length,
  };
}

/** Kept for callers that only care about the type label. */
export function memoryTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

export { MEMORY_TYPES };
