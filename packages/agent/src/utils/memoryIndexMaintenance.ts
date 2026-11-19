import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  MAX_MEMORY_ENTRYPOINT_CHARS,
  MAX_MEMORY_ENTRYPOINT_LINES,
  MEMORY_ENTRYPOINT_NAME,
} from "../constants/memory.js";
import { atomicWriteFile } from "./atomicWrite.js";
import { parseFrontmatter } from "./markdownParser.js";
import { isPathInside } from "./pathSafety.js";

/**
 * Keep the flat memory index in sync with the files the agent writes.
 *
 * The save instructions ask the model to add a pointer after creating a topic
 * file, but that is a prediction about its own future behavior — the 248
 * orphans in one real store are the counter-example. This module makes the
 * index maintenance a code path:
 *
 * - `ensureMemoryIndexEntry` adds a missing pointer after a successful write;
 * - `rejectDerivedIndexWrite` refuses writes to generated pages (`archive*.md`,
 *   `index_*`), so the agent can neither edit the overflow index nor delete its
 *   pointer by rewriting it;
 * - `isDerivedIndexFile` keeps those pages out of the "existing memory files"
 *   manifest, so they are not offered as topics to update.
 *
 * The nightly tidy still rebuilds the whole index from frontmatter; this only
 * keeps the window between tidy runs from drifting.
 */

export function isDerivedIndexFile(fileName: string): boolean {
  const base = path.basename(fileName);
  return (
    base === "archive.md" ||
    /^archive_.*\.md$/.test(base) ||
    /^index_.*\.md$/.test(base)
  );
}

export function rejectDerivedIndexWrite(
  absolutePath: string,
  autoMemoryDir: string | undefined,
): string | null {
  if (!autoMemoryDir) return null;
  if (!isPathInside(absolutePath, autoMemoryDir)) return null;
  if (!isDerivedIndexFile(absolutePath)) return null;
  return (
    `${path.basename(absolutePath)} is a generated index page and cannot be edited. ` +
    "Write the memory as its own topic file; the index is maintained automatically."
  );
}

// Serialize index appends: the extraction fork issues parallel writes, and two
// read-modify-write cycles on MEMORY.md would drop one of the entries.
let indexWriteChain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = indexWriteChain.then(fn, fn);
  indexWriteChain = run.catch(() => undefined);
  return run;
}

async function readIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

function indexEntry(
  fileName: string,
  name: string,
  description: string,
): string {
  const title = name.trim() || path.basename(fileName, ".md");
  const suffix = description.trim() ? ` — ${description.trim()}` : "";
  return `- [${title}](${fileName})${suffix}`;
}

/**
 * Add a pointer for `absolutePath` when MEMORY.md (or an archive page) does not
 * already link to it.
 *
 * Returns a short note for the tool result when it wrote something or had to
 * refuse because the entrypoint is full; null when there was nothing to do.
 */
export async function ensureMemoryIndexEntry(
  absolutePath: string,
  autoMemoryDir: string | undefined,
): Promise<string | null> {
  if (!autoMemoryDir) return null;
  if (!isPathInside(absolutePath, autoMemoryDir)) return null;
  const fileName = path.basename(absolutePath);
  if (fileName === MEMORY_ENTRYPOINT_NAME) return null;
  if (isDerivedIndexFile(fileName)) return null;
  if (!fileName.endsWith(".md")) return null;

  const raw = await readIfExists(absolutePath);
  if (!raw) return null;
  const { frontmatter } = parseFrontmatter(raw);
  const name =
    typeof frontmatter?.name === "string" ? frontmatter.name : "";
  const description =
    typeof frontmatter?.description === "string"
      ? frontmatter.description
      : "";

  return serialize(async () => {
    const indexFile = path.join(autoMemoryDir, MEMORY_ENTRYPOINT_NAME);
    const indexRaw = await readIfExists(indexFile);

    let entries: string[] = [];
    try {
      const listed = await fs.readdir(autoMemoryDir);
      entries = Array.isArray(listed) ? listed : [];
    } catch {
      entries = [];
    }
    const archiveNames = entries.filter(
      (entry) => /^archive_.*\.md$/.test(entry) || entry === "archive.md",
    );
    let alreadyIndexed = indexRaw.includes(`](${fileName})`);
    if (!alreadyIndexed) {
      for (const archive of archiveNames) {
        const archiveRaw = await readIfExists(path.join(autoMemoryDir, archive));
        if (archiveRaw.includes(`](${fileName})`)) {
          alreadyIndexed = true;
          break;
        }
      }
    }
    if (alreadyIndexed) return null;

    const entry = indexEntry(fileName, name, description);
    const next = indexRaw.trim()
      ? `${indexRaw.trimEnd()}\n${entry}\n`
      : `# Memory\n\n${entry}\n`;
    const trimmed = next.trim();
    const lineCount = trimmed.split("\n").length;
    const charCount = trimmed.length;
    if (
      lineCount > MAX_MEMORY_ENTRYPOINT_LINES ||
      charCount > MAX_MEMORY_ENTRYPOINT_CHARS
    ) {
      return (
        `"${fileName}" is not indexed yet: MEMORY.md is at its size cap. ` +
        "Merge or archive older entries; the nightly tidy rebuilds the index too."
      );
    }

    await atomicWriteFile(indexFile, next);
    return `Indexed "${fileName}" in MEMORY.md (the pointer was missing).`;
  });
}

/**
 * Re-add the archive pointer when a MEMORY.md rewrite dropped it.
 *
 * The archive page holds the overflow entries; losing its single pointer turns
 * every archived file into an orphan. This runs after any MEMORY.md write.
 */
export async function ensureArchivePointer(
  autoMemoryDir: string | undefined,
): Promise<string | null> {
  if (!autoMemoryDir) return null;
  return serialize(async () => {
    const indexPath = path.join(autoMemoryDir, MEMORY_ENTRYPOINT_NAME);
    const indexRaw = await readIfExists(indexPath);
    if (!indexRaw) return null;

    let entries: string[] = [];
    try {
      const listed = await fs.readdir(autoMemoryDir);
      entries = Array.isArray(listed) ? listed : [];
    } catch {
      return null;
    }
    const archives = entries.filter(
      (entry) => entry === "archive.md" || /^archive_.*\.md$/.test(entry),
    );
    const missing = archives.filter(
      (entry) => !indexRaw.includes(`](${entry})`),
    );
    if (missing.length === 0) return null;

    const lines = missing.map(
      (entry) => `- [归档](${entry}) — 低优先级记忆的清单，需要翻旧记录时再打开`,
    );
    const next = `${indexRaw.trimEnd()}\n${lines.join("\n")}\n`;
    const trimmed = next.trim();
    if (
      trimmed.split("\n").length > MAX_MEMORY_ENTRYPOINT_LINES ||
      trimmed.length > MAX_MEMORY_ENTRYPOINT_CHARS
    ) {
      return "MEMORY.md lost its archive pointer, but the index is full; the nightly tidy will restore it.";
    }
    await atomicWriteFile(indexPath, next);
    return "Restored the archive pointer in MEMORY.md.";
  });
}
