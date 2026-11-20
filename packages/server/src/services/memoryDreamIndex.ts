import fs from "node:fs";
import path from "node:path";
import {
  MEMORY_INDEX_NAME,
  MEMORY_TYPES,
  readMemoryFrontmatter,
} from "./memoryDreamLint.js";

/**
 * Rebuild MEMORY.md by importance, with an overflow archive.
 *
 * Placement is decided by priority, not by "what happened to overflow":
 *
 * - importance = type (user > feedback > project > reference), then recency;
 * - MEMORY.md keeps as many of the most important units as fit its budget;
 * - everything else goes to archive.md, one pointer line in the entrypoint.
 *
 * A unit is an existing index line kept verbatim (full title + description,
 * including a packed line written by an earlier pass) or a generated line for a
 * file that had no pointer. Because the split is recomputed from file type and
 * mtime on every rebuild, a file that becomes important again moves back out of
 * the archive; this is not a one-way door.
 */

export const ARCHIVE_FILE = "archive.md";
export const INDEX_BUDGET_CHARS = 20_000;
const MAX_INDEX_LINES = 195;

const TYPE_ORDER = ["user", "feedback", "project", "reference"] as const;
const TYPE_RANK: Record<string, number> = {
  user: 0,
  feedback: 1,
  project: 2,
  reference: 3,
};
const DEFAULT_LABEL: Record<string, string> = {
  user: "User",
  feedback: "Feedback",
  project: "Project",
  reference: "Reference",
};
/** Existing indexes use English headings; Chinese headings are accepted too. */
const LABEL_ALIASES: Record<string, string[]> = {
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

interface Unit {
  text: string;
  files: string[];
  type: string;
  /** Sort key: smaller is more important. */
  rank: number;
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

function generatedLine(entry: MemoryEntry): string {
  const prefix = `- [${entry.name}](${entry.file})`;
  const withDescription = entry.description
    ? `${prefix} — ${entry.description}`
    : prefix;
  // Never truncate the title and never emit a half sentence: if the line does
  // not fit, keep the pointer and drop the description.
  return withDescription.length <= 160 ? withDescription : prefix;
}

function makeUnit(
  text: string,
  files: string[],
  byFile: Map<string, MemoryEntry>,
): Unit | undefined {
  const known = files.filter((file) => byFile.has(file));
  if (known.length === 0) return undefined;
  const entries = known.map((file) => byFile.get(file)!);
  const type = entries.reduce(
    (best, entry) =>
      (TYPE_RANK[entry.type] ?? 9) < (TYPE_RANK[best.type] ?? 9) ? entry : best,
    entries[0],
  ).type;
  return {
    text,
    files: known,
    type,
    rank: Math.min(...entries.map((entry) => TYPE_RANK[entry.type] ?? 9)),
    mtime: Math.max(...entries.map((entry) => entry.mtime)),
  };
}

function sortUnits(units: Unit[]): Unit[] {
  return units.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.text.localeCompare(b.text);
  });
}

function readArchiveUnits(
  raw: string,
  byFile: Map<string, MemoryEntry>,
): Unit[] {
  const units: Unit[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("- ")) continue;
    const unit = makeUnit(line, linksIn(line), byFile);
    if (unit) units.push(unit);
  }
  return units;
}

export function rebuildFlatIndex(dir: string): RebuildIndexResult {
  for (const file of fs.readdirSync(dir)) {
    if (file.startsWith("index_")) fs.rmSync(path.join(dir, file), { force: true });
  }

  const entries = readEntries(dir);
  const byFile = new Map(entries.map((entry) => [entry.file, entry]));
  const existingIndex = readIfExists(path.join(dir, MEMORY_INDEX_NAME));
  const existingArchive = readIfExists(path.join(dir, ARCHIVE_FILE));

  // Keep the original preamble and the section labels it used.
  const originalLines = existingIndex.trim()
    ? existingIndex.trimEnd().split("\n")
    : ["# Memory", "", "This file serves as an index for the project's auto-memory."];
  const firstSection = originalLines.findIndex((line) => line.startsWith("## "));
  const preamble =
    firstSection === -1 ? originalLines : originalLines.slice(0, firstSection);
  while (preamble.length > 0 && preamble[preamble.length - 1].trim() === "") {
    preamble.pop();
  }
  const labels: Record<string, string> = { ...DEFAULT_LABEL };
  for (let i = 0; i < originalLines.length; i += 1) {
    if (!originalLines[i].startsWith("## ")) continue;
    const label = originalLines[i].slice(3).trim();
    const type = Object.keys(LABEL_ALIASES).find((key) =>
      LABEL_ALIASES[key].includes(label),
    );
    if (type) labels[type] = label;
  }

  const seen = new Set<string>();
  const units: Unit[] = [];

  for (const line of originalLines) {
    if (!line.startsWith("- ")) continue;
    if (/\]\(archive(?:_\d+)?\.md\)/.test(line)) continue;
    // A line that points at a file the organizer deleted must not survive:
    // preserving it would leave a dangling link the index can never satisfy.
    if (linksIn(line).some((file) => !byFile.has(file))) continue;
    const files = linksIn(line).filter((file) => !seen.has(file));
    if (files.length === 0) continue;
    files.forEach((file) => seen.add(file));
    const unit = makeUnit(line, files, byFile);
    if (unit) units.push(unit);
  }
  for (const unit of readArchiveUnits(existingArchive, byFile)) {
    if (linksIn(unit.text).some((file) => !byFile.has(file))) continue;
    if (unit.files.some((file) => seen.has(file))) continue;
    unit.files.forEach((file) => seen.add(file));
    units.push(unit);
  }
  for (const entry of entries) {
    if (seen.has(entry.file)) continue;
    seen.add(entry.file);
    units.push({
      text: generatedLine(entry),
      files: [entry.file],
      type: entry.type,
      rank: TYPE_RANK[entry.type] ?? 9,
      mtime: entry.mtime,
    });
  }

  const ordered = sortUnits(units);
  const direct: Unit[] = [];
  const archived: Unit[] = [];
  let usedChars = 0;
  for (const unit of ordered) {
    const cost = unit.text.length + 1 + (direct.length === 0 ? 10 : 0);
    if (usedChars + cost <= INDEX_BUDGET_CHARS && direct.length < MAX_INDEX_LINES) {
      direct.push(unit);
      usedChars += cost;
    } else {
      archived.push(unit);
    }
  }

  const archiveLinkCount = archived.reduce(
    (sum, unit) => sum + unit.files.length,
    0,
  );

  const render = (): { content: string; lines: number; chars: number } => {
    const lines = [...preamble];
    for (const type of TYPE_ORDER) {
      const section = direct.filter((unit) => unit.type === type);
      if (section.length === 0) continue;
      lines.push("", `## ${labels[type] ?? DEFAULT_LABEL[type]}`, ...section.map((unit) => unit.text));
    }
    if (archiveLinkCount > 0) {
      lines.push(
        "",
        "## 归档",
        `- [归档：${archiveLinkCount} 个低优先级文件](${ARCHIVE_FILE}) — 旧项目/参考记录，需要时再打开`,
      );
    }
    const content = `${lines.join("\n").trim()}\n`;
    return {
      content,
      lines: content.trim().split("\n").length,
      chars: content.trim().length,
    };
  };

  let rendered = render();
  while (
    (rendered.chars > INDEX_BUDGET_CHARS || rendered.lines > MAX_INDEX_LINES) &&
    direct.length > 0
  ) {
    const moved = direct.pop();
    if (!moved) break;
    archived.push(moved);
    rendered = render();
  }

  rendered = render();
  if (archiveLinkCount > 0) {
    const archiveContent = `${[
      "---",
      "name: 归档索引",
      `description: ${archiveLinkCount} 个低优先级记忆文件的清单；需要翻旧记录时先读这里，再打开具体文件。`,
      "type: reference",
      "archive: true",
      "---",
      "",
      "# 归档（低优先级）",
      "",
      ...sortUnits(archived).map((unit) => unit.text),
    ]
      .join("\n")
      .trim()}\n`;
    fs.writeFileSync(path.join(dir, ARCHIVE_FILE), archiveContent, "utf-8");
  } else {
    fs.rmSync(path.join(dir, ARCHIVE_FILE), { force: true });
  }

  fs.writeFileSync(path.join(dir, MEMORY_INDEX_NAME), rendered.content, "utf-8");

  return {
    direct: direct.reduce((sum, unit) => sum + unit.files.length, 0),
    archived: archiveLinkCount,
    indexChars: rendered.chars,
    indexLines: rendered.lines,
  };
}

/** Kept for callers that only care about the type label. */
export function memoryTypeLabel(type: string): string {
  return DEFAULT_LABEL[type] ?? type;
}


/**
 * Completeness fallback: add pointers for files that have none, and drop
 * pointers whose file is gone. It never decides what to archive — which
 * memories stay in MEMORY.md and which move to archive.md is the model's call.
 * If the added pointers no longer fit the entrypoint caps, the remaining files
 * stay unindexed and the run fails so a person can look.
 */
function insertLineIntoSection(lines: string[], type: string, line: string): void {
  const aliases = LABEL_ALIASES[type] ?? [];
  const header = lines.findIndex(
    (item) => item.startsWith("## ") && aliases.includes(item.slice(3).trim()),
  );
  if (header === -1) {
    const archive = lines.findIndex((item) => item.trim() === "## 归档");
    const block = [`## ${DEFAULT_LABEL[type] ?? type}`, line, ""];
    if (archive === -1) {
      if (lines.length > 0 && lines[lines.length - 1].trim() !== "") lines.push("");
      lines.push(...block);
    } else {
      lines.splice(archive, 0, ...block);
    }
    return;
  }
  let insertAt = header + 1;
  for (let i = header + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) break;
    if (lines[i].trim() !== "") insertAt = i + 1;
  }
  lines.splice(insertAt, 0, line);
}

export function appendMissingPointers(dir: string): {
  added: number;
  remaining: number;
  droppedDead: number;
} {
  const entries = readEntries(dir);
  const byFile = new Map(entries.map((entry) => [entry.file, entry]));
  const indexRaw = readIfExists(path.join(dir, MEMORY_INDEX_NAME));
  const lines = indexRaw.trim()
    ? indexRaw.trimEnd().split("\n")
    : ["# Memory", "", "This file serves as an index for the project's auto-memory."];

  const live = lines.filter(
    (line) => !line.startsWith("- ") || !linksIn(line).some((file) => !byFile.has(file)),
  );
  const droppedDead = lines.length - live.length;

  const archiveRaw = readIfExists(path.join(dir, ARCHIVE_FILE));
  const indexed = new Set(
    [...live, ...archiveRaw.split("\n")].flatMap((line) => linksIn(line)),
  );
  const missing = entries
    .filter((entry) => !indexed.has(entry.file))
    .sort((a, b) => {
      const rank = (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9);
      if (rank !== 0) return rank;
      return b.mtime - a.mtime;
    });

  let added = 0;
  for (const entry of missing) {
    const candidate = [...live];
    insertLineIntoSection(candidate, entry.type, generatedLine(entry));
    const trimmed = candidate.join("\n").trim();
    if (trimmed.split("\n").length > 199 || trimmed.length > 24_500) {
      break;
    }
    live.splice(0, live.length, ...candidate);
    added += 1;
  }

  const content = `${live.join("\n").trim()}\n`;
  fs.writeFileSync(path.join(dir, MEMORY_INDEX_NAME), content, "utf-8");
  return { added, remaining: missing.length - added, droppedDead };
}
