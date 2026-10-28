import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  MAX_MEMORY_DESCRIPTION_CHARS,
  MAX_MEMORY_ENTRYPOINT_CHARS,
  MAX_MEMORY_ENTRYPOINT_LINES,
  MAX_MEMORY_FILE_BYTES,
  MAX_MEMORY_FILE_LINES,
  MEMORY_CAP_TARGET_RATIO,
  MEMORY_CAP_WARN_RATIO,
  MEMORY_ENTRYPOINT_NAME,
  MEMORY_INDEX_LINE_GUIDANCE_CHARS,
} from "../constants/memory.js";
import { EDIT_TOOL_NAME, WRITE_TOOL_NAME } from "../constants/tools.js";
import type { ToolResult } from "../tools/types.js";
import { parseFrontmatter } from "./markdownParser.js";
import { isPathInside } from "./pathSafety.js";

/**
 * Write-time capacity gate for the auto-memory files.
 *
 * The load-time truncation in `memoryEntrypoint.ts` only ever tells the reader
 * that something is missing, and it runs once per session — by then the write is
 * long done. These notices run in the write's own tool result instead, so the
 * model hears about it while it still has the file in hand.
 *
 * Thresholds and wording follow Claude Code's write-time gate
 * (`iDn=0.8` / `QG=0.7`, targets = cap * 0.7), with one measurement difference:
 * the index cap counts characters (`String.length`, matching the load-time
 * truncation), while the per-file cap counts bytes — a topic file is read whole
 * whenever it is opened, so its cost is bytes, not characters.
 */

interface CapDimension {
  frac: number;
  over: boolean;
  sizeDesc: string;
  capDesc: string;
  targetDesc: string;
}

function targetOf(cap: number): number {
  return Math.floor(cap * MEMORY_CAP_TARGET_RATIO);
}

/**
 * The dimension closest to (or past) its cap, or null when every dimension is
 * still under the warning ratio. Reporting the worst one keeps the notice short
 * and tells the model which limit is actually binding.
 */
function worstDimension(dimensions: CapDimension[]): CapDimension | null {
  const worst = dimensions.reduce((a, b) => (b.frac > a.frac ? b : a));
  return worst.frac < MEMORY_CAP_WARN_RATIO ? null : worst;
}

/** Line numbers of index entries longer than the per-line guidance, if any. */
function overlongIndexLineNotice(raw: string): string | null {
  const overlong: number[] = [];
  raw.split("\n").forEach((line, index) => {
    if (line.length > MEMORY_INDEX_LINE_GUIDANCE_CHARS)
      overlong.push(index + 1);
  });
  if (overlong.length === 0) return null;

  const shown = overlong
    .slice(0, 5)
    .map((line) => `line ${line}`)
    .join(", ");
  const more =
    overlong.length > 5
      ? ` (+${overlong.length - 5} more over-long lines)`
      : "";
  return `${overlong.length} index line(s) exceed the ~${MEMORY_INDEX_LINE_GUIDANCE_CHARS}-character guidance: ${shown}${more}. Derive each line from the topic file's frontmatter \`description\` and move the rest of the detail into that file.`;
}

/**
 * Lines of `raw` that `truncateEntrypointContent` would keep, measured the
 * same way: line cap first, then the last newline at or before the char cap.
 */
function findCut(raw: string): number {
  const trimmed = raw.trim();
  const lines = trimmed.split("\n");
  let body =
    lines.length > MAX_MEMORY_ENTRYPOINT_LINES
      ? lines.slice(0, MAX_MEMORY_ENTRYPOINT_LINES).join("\n")
      : trimmed;
  if (body.length > MAX_MEMORY_ENTRYPOINT_CHARS) {
    const cutAt = body.lastIndexOf("\n", MAX_MEMORY_ENTRYPOINT_CHARS);
    body = body.slice(0, cutAt > 0 ? cutAt : MAX_MEMORY_ENTRYPOINT_CHARS);
  }
  return body.length;
}

/**
 * Error for a MEMORY.md write that would still be over the read limit.
 * Null when the index fits. The caller must not touch disk when this returns.
 */
export function entrypointRejection(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lineCount = trimmed.split("\n").length;
  const charCount = trimmed.length;
  const lineOver = lineCount > MAX_MEMORY_ENTRYPOINT_LINES;
  const charOver = charCount > MAX_MEMORY_ENTRYPOINT_CHARS;
  if (!lineOver && !charOver) return null;

  const limits: string[] = [];
  if (lineOver) {
    limits.push(
      `${lineCount} lines, over its ${MAX_MEMORY_ENTRYPOINT_LINES}-line read limit. Rewrite it to under ${targetOf(MAX_MEMORY_ENTRYPOINT_LINES)} lines`,
    );
  }
  if (charOver) {
    limits.push(
      `${charCount} characters, over its ${MAX_MEMORY_ENTRYPOINT_CHARS}-character read limit. Rewrite it to under ${targetOf(MAX_MEMORY_ENTRYPOINT_CHARS)} characters`,
    );
  }

  const dropped = trimmed
    .slice(findCut(trimmed))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 15)
    .map((line) => `- ${line.slice(0, 80)}`);

  return [
    `Error: The file was not modified. This write would have left ${MEMORY_ENTRYPOINT_NAME} at ${limits.join("; ")}.`,
    "Lines and characters past the read limit are dropped on load, so those entries would be invisible.",
    "Rewrite the whole index in one Write: one line per entry, detail lives in the topic file, merge or drop stale lines.",
    dropped.length > 0
      ? `Entries that would not be loaded:\n${dropped.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Returns the rejection when `next` is a MEMORY.md inside the auto-memory
 * directory and would exceed the index cap. Null means the write may proceed.
 */
export function rejectEntrypointWrite(
  absolutePath: string,
  next: string,
  autoMemoryDir: string | undefined,
): string | null {
  if (!autoMemoryDir) return null;
  if (!isPathInside(absolutePath, autoMemoryDir)) return null;
  if (path.basename(absolutePath) !== MEMORY_ENTRYPOINT_NAME) return null;
  return entrypointRejection(next);
}

/**
 * Notice to append to the result of a write that targeted `MEMORY.md`, or null
 * when the index is comfortably within both caps and every line is short.
 *
 * Over-cap writes are refused before they touch disk (`entrypointRejection`).
 * This notice only covers an index that is still under the cap.
 */
export function buildEntrypointCapNotice(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lineCount = trimmed.split("\n").length;
  const charCount = trimmed.length;
  const parts: string[] = [];

  const worst = worstDimension([
    {
      frac: charCount / MAX_MEMORY_ENTRYPOINT_CHARS,
      over: charCount > MAX_MEMORY_ENTRYPOINT_CHARS,
      sizeDesc: `${charCount} characters`,
      capDesc: `${MAX_MEMORY_ENTRYPOINT_CHARS}-character`,
      targetDesc: `${targetOf(MAX_MEMORY_ENTRYPOINT_CHARS)} characters`,
    },
    {
      frac: lineCount / MAX_MEMORY_ENTRYPOINT_LINES,
      over: lineCount > MAX_MEMORY_ENTRYPOINT_LINES,
      sizeDesc: `${lineCount} lines`,
      capDesc: `${MAX_MEMORY_ENTRYPOINT_LINES}-line`,
      targetDesc: `${targetOf(MAX_MEMORY_ENTRYPOINT_LINES)} lines`,
    },
  ]);

  if (worst && !worst.over) {
    parts.push(
      `${MEMORY_ENTRYPOINT_NAME} is ${worst.sizeDesc}, approaching the ${worst.capDesc} read limit. Compact it to under ${worst.targetDesc} now: keep one line per entry, move detail into topic files, and merge or drop stale entries.`,
    );
  }

  const overlong = overlongIndexLineNotice(trimmed);
  if (overlong) parts.push(overlong);

  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Notice to append to the result of a write that targeted a topic file in the
 * memory directory, or null when the file is small enough and its frontmatter
 * carries a usable `description`.
 */
export function buildMemoryFileCapNotice(
  raw: string,
  displayName: string,
  description: string | null,
): string | null {
  const trimmed = raw.trim();
  const parts: string[] = [];

  if (trimmed) {
    const byteCount = Buffer.byteLength(trimmed, "utf-8");
    const lineCount = trimmed.split("\n").length;

    const worst = worstDimension([
      {
        frac: byteCount / MAX_MEMORY_FILE_BYTES,
        over: byteCount > MAX_MEMORY_FILE_BYTES,
        sizeDesc: `${byteCount} bytes`,
        capDesc: `${MAX_MEMORY_FILE_BYTES}-byte`,
        targetDesc: `${targetOf(MAX_MEMORY_FILE_BYTES)} bytes`,
      },
      {
        frac: lineCount / MAX_MEMORY_FILE_LINES,
        over: lineCount > MAX_MEMORY_FILE_LINES,
        sizeDesc: `${lineCount} lines`,
        capDesc: `${MAX_MEMORY_FILE_LINES}-line`,
        targetDesc: `${targetOf(MAX_MEMORY_FILE_LINES)} lines`,
      },
    ]);

    if (worst) {
      parts.push(
        worst.over
          ? `Error: this write left the memory file ${displayName} at ${worst.sizeDesc}, over its ${worst.capDesc} limit. The write succeeded, but a topic file is read whole whenever it is opened, and ${MEMORY_ENTRYPOINT_NAME} can only point at it — everything past the limit costs context without being summarised. Rewrite it to under ${worst.targetDesc} now: keep one fact per file, split distinct facts into their own files, and summarise instead of appending.`
          : `The memory file ${displayName} is ${worst.sizeDesc}, approaching the ${worst.capDesc} limit. Keep it to one fact under ${worst.targetDesc}: summarise rather than append, and split distinct facts into their own files.`,
      );
    }
  }

  if (!description) {
    parts.push(
      `This memory file has no frontmatter \`description\`, so it cannot be summarised into the ${MEMORY_ENTRYPOINT_NAME} index. Add the frontmatter block (name, description, type) at the top.`,
    );
  } else if (description.length > MAX_MEMORY_DESCRIPTION_CHARS) {
    parts.push(
      `This memory file's \`description\` is ${description.length} characters. It becomes the one-line index entry; shorten it to one specific line (about ${MAX_MEMORY_DESCRIPTION_CHARS / 2} characters) that says what the file answers.`,
    );
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

function readDescription(raw: string): string | null {
  const { frontmatter } = parseFrontmatter(raw);
  const description = frontmatter?.description;
  return typeof description === "string" ? description : null;
}

/**
 * Append the matching capacity notice to a successful write's tool result.
 *
 * Hung off the one funnel every built-in call passes through
 * (`ToolManager.execute`), so a write made from the main agent and from the
 * extraction fork gets the same treatment.
 * The path check runs first and the file is only read once the target is known
 * to be inside the memory directory, so writes elsewhere cost nothing.
 *
 * The notice is advisory: the write has already happened and is left alone.
 */
export async function appendMemoryCapNotice(
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResult,
  workdir: string,
  autoMemoryDir: string | undefined,
): Promise<void> {
  if (!result.success || !autoMemoryDir) return;
  if (toolName !== WRITE_TOOL_NAME && toolName !== EDIT_TOOL_NAME) return;

  const filePath = args.file_path;
  if (typeof filePath !== "string" || !filePath) return;

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(workdir, filePath);
  if (!isPathInside(absolutePath, autoMemoryDir)) return;

  let raw: string;
  try {
    raw = await fs.readFile(absolutePath, "utf-8");
  } catch {
    return;
  }

  const displayName = path.basename(absolutePath);
  const notice =
    displayName === MEMORY_ENTRYPOINT_NAME
      ? buildEntrypointCapNotice(raw)
      : buildMemoryFileCapNotice(raw, displayName, readDescription(raw));

  if (notice) result.content = `${result.content}\n\n${notice}`;
}
