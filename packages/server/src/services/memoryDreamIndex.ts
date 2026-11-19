import fs from "node:fs";
import path from "node:path";
import {
  MEMORY_INDEX_NAME,
  MEMORY_TYPES,
  MEMORY_FILE_MAX_BYTES,
  readMemoryFrontmatter,
} from "./memoryDreamLint.js";

/**
 * Build a two-level index for a memory directory.
 *
 * A flat `MEMORY.md` cannot hold several hundred entries under its 22k-char
 * budget (each entry costs ~65 chars). Instead, `MEMORY.md` lists a handful of
 * generated hub pages (`index_<type>_<topic>.md`), and each hub lists the files
 * of that topic with their descriptions. Reading an entry costs one extra hop,
 * but every file becomes discoverable again without rewriting its content.
 *
 * The hubs and the entrypoint are derived data: rebuild them from frontmatter
 * whenever the store changes. Files named `index_*` are reserved for this.
 */

export const HUB_PREFIX = "index_";
export const MAX_ENTRIES_PER_HUB = 30;
/** Topics smaller than this are pooled into a per-type misc hub. */
const MIN_TOPIC_ENTRIES = 3;

const TYPE_ORDER = ["user", "feedback", "project", "reference"] as const;
const TYPE_LABEL: Record<string, string> = {
  user: "用户",
  feedback: "规则",
  project: "项目",
  reference: "参考",
};

export interface RebuildIndexResult {
  hubs: number;
  entries: number;
  indexChars: number;
  indexLines: number;
}

interface MemoryEntry {
  file: string;
  name: string;
  description: string;
  type: string;
  topic: string;
  bytes: number;
}

function isHub(file: string): boolean {
  return file.startsWith(HUB_PREFIX) && file.endsWith(".md");
}

function sanitize(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "misc";
}

function topicOf(file: string, type: string): string {
  const stem = file.replace(/\.md$/, "");
  const parts = stem.split("_");
  if ((MEMORY_TYPES as readonly string[]).includes(type) && parts[0] === type) {
    return sanitize(parts[1] ?? "misc");
  }
  const first = MEMORY_TYPES.find((t) => parts[0] === t);
  if (first) return sanitize(parts[1] ?? "misc");
  return sanitize(parts[0] ?? "misc");
}

function listEntries(dir: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md") || file === MEMORY_INDEX_NAME || isHub(file)) {
      continue;
    }
    const full = path.join(dir, file);
    let raw = "";
    try {
      raw = fs.readFileSync(full, "utf-8");
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
      topic: topicOf(file, type),
      bytes: Buffer.byteLength(raw, "utf-8"),
    });
  }
  return entries;
}

function hubHeader(
  type: string,
  topic: string,
  count: number,
  chunk: number,
  chunks: number,
): { name: string; description: string; title: string } {
  const label = TYPE_LABEL[type] ?? type;
  const suffix = chunks > 1 ? ` ${chunk}/${chunks}` : "";
  const name = `${label} · ${topic}${suffix}`;
  return {
    name,
    description: `${label}类中「${topic}」相关的 ${count} 个记忆文件；找这一类内容时先读这个目录页。`,
    title: `${label} · ${topic}${suffix}（${count} 条）`,
  };
}

function hubBody(
  header: { name: string; description: string; title: string },
  entries: MemoryEntry[],
): string {
  const lines = [
    "---",
    `name: ${header.name}`,
    `description: ${header.description}`,
    "type: reference",
    "hub: true",
    "---",
    "",
    `# ${header.title}`,
    "",
    ...entries.map(
      (entry) =>
        `- [${entry.name}](${entry.file})${entry.description ? ` — ${entry.description}` : ""}`,
    ),
    "",
  ];
  return lines.join("\n");
}

/** Split entries so one hub stays under the per-file byte cap. */
function chunkEntries(
  entries: MemoryEntry[],
): Array<{ header: ReturnType<typeof hubHeader>; body: string }> {
  const chunks: MemoryEntry[][] = [];
  let current: MemoryEntry[] = [];
  for (const entry of entries) {
    const candidate = [...current, entry];
    const body = hubBody(hubHeader(entry.type, entry.topic, candidate.length, 1, 1), candidate);
    const tooBig = Buffer.byteLength(body, "utf-8") > MEMORY_FILE_MAX_BYTES;
    if (current.length > 0 && (candidate.length > MAX_ENTRIES_PER_HUB || tooBig)) {
      chunks.push(current);
      current = [entry];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((members, index) => {
    const header = hubHeader(
      members[0].type,
      members[0].topic,
      members.length,
      index + 1,
      chunks.length,
    );
    return { header, body: hubBody(header, members) };
  });
}

export function rebuildHierarchicalIndex(dir: string): RebuildIndexResult {
  // Generated hubs are derived: drop them before regenerating.
  for (const file of fs.readdirSync(dir)) {
    if (isHub(file)) fs.rmSync(path.join(dir, file), { force: true });
  }

  const entries = listEntries(dir);
  const byType = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const list = byType.get(entry.type) ?? [];
    list.push(entry);
    byType.set(entry.type, list);
  }

  const indexLines: string[] = [
    "# 记忆索引",
    "",
    "> 顶层只列族目录。找具体规则/结论时先打开对应目录页，再读其中列出的文件。",
    "",
  ];
  let hubs = 0;

  const types = [
    ...TYPE_ORDER.filter((type) => byType.has(type)),
    ...[...byType.keys()].filter(
      (type) => !(TYPE_ORDER as readonly string[]).includes(type),
    ),
  ];

  for (const type of types) {
    const members = (byType.get(type) ?? []).sort((a, b) =>
      a.topic.localeCompare(b.topic) || a.file.localeCompare(b.file),
    );
    indexLines.push(`## ${TYPE_LABEL[type] ?? type}`);

    const byTopic = new Map<string, MemoryEntry[]>();
    for (const entry of members) {
      const list = byTopic.get(entry.topic) ?? [];
      list.push(entry);
      byTopic.set(entry.topic, list);
    }

    // Hundreds of singleton topics would produce hundreds of hubs and blow the
    // entrypoint's line cap. Keep real topics as their own hub and pool the
    // scattered ones per type.
    const small: MemoryEntry[] = [];
    const topics: Array<[string, MemoryEntry[]]> = [];
    for (const [topic, topicEntries] of [...byTopic.entries()].sort()) {
      if (topicEntries.length >= MIN_TOPIC_ENTRIES) topics.push([topic, topicEntries]);
      else small.push(...topicEntries);
    }
    if (small.length > 0) topics.push(["misc", small]);

    for (const [topic, topicEntries] of topics) {
      const chunks = chunkEntries(topicEntries);
      let chunk = 1;
      for (const hub of chunks) {
        const suffix = chunks.length > 1 ? `_${chunk}` : "";
        let fileName = `${HUB_PREFIX}${sanitize(type)}_${topic}${suffix}.md`;
        let attempt = 1;
        while (fs.existsSync(path.join(dir, fileName))) {
          fileName = `${HUB_PREFIX}${sanitize(type)}_${topic}${suffix}_${attempt}.md`;
          attempt += 1;
        }
        fs.writeFileSync(path.join(dir, fileName), hub.body, "utf-8");
        indexLines.push(
          `- [${hub.header.name}（${chunkEntriesCount(hub.body)}）](${fileName}) — ${hub.header.description}`,
        );
        hubs += 1;
        chunk += 1;
      }
    }
    indexLines.push("");
  }

  const content = `${indexLines.join("\n").trim()}\n`;
  fs.writeFileSync(path.join(dir, MEMORY_INDEX_NAME), content, "utf-8");
  return {
    hubs,
    entries: entries.length,
    indexChars: content.trim().length,
    indexLines: content.trim().split("\n").length,
  };
}

function chunkEntriesCount(body: string): number {
  return body.split("\n").filter((line) => line.startsWith("- [")).length;
}
