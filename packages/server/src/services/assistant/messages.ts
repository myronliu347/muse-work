import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";

export const ASSISTANT_SLICE_BYTES = 1_048_576;
export const ASSISTANT_PAGE_SIZE = 50;
export const ASSISTANT_SEARCH_MAX_FILES = 8;
export const ASSISTANT_SEARCH_MAX_BYTES = 8_388_608;
export const ASSISTANT_TEXT_MAX = 8000;

export type MuseChatRole = "user" | "assistant";

export interface MuseChatImage {
  data: string;
  mediaType: string;
}

export interface MuseChatLine {
  id: string;
  at: number;
  role: MuseChatRole;
  message: string;
  images?: MuseChatImage[];
  /** 主人与机器人的 POPO 私聊。缺省表示 Muse 里的对话。 */
  app?: "popo";
  /** POPO 发出去的消息 id，用来撤回。 */
  msgIds?: string[];
}

export interface MuseChatPage {
  messages: MuseChatLine[];
  hasMore: boolean;
}

export interface MuseChatSearchHit extends MuseChatLine {
  truncated?: boolean;
}

export interface MuseChatSearchPage {
  messages: MuseChatSearchHit[];
  hasMore: boolean;
  truncatedScan?: boolean;
}

function messagesDir(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "assistant-messages");
}

function listSliceNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^\d{6}\.jsonl$/.test(name))
    .sort();
}

export function normalizeAssistantImages(raw: unknown): MuseChatImage[] {
  if (!Array.isArray(raw)) return [];
  const images: MuseChatImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const data = (item as { data?: unknown }).data;
    const mediaType = (item as { mediaType?: unknown }).mediaType;
    if (typeof data !== "string" || !data) continue;
    images.push({
      data,
      mediaType:
        typeof mediaType === "string" && mediaType ? mediaType : "image/png",
    });
    if (images.length >= 20) break;
  }
  return images;
}

function normalizeMsgIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) continue;
    ids.push(item.trim());
    if (ids.length >= 20) break;
  }
  return ids;
}

function parseLine(raw: string): MuseChatLine | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const record = JSON.parse(trimmed) as MuseChatLine;
    if (!record || typeof record.id !== "string" || !record.id) return undefined;
    if (record.role !== "user" && record.role !== "assistant") return undefined;
    if (typeof record.message !== "string") return undefined;
    const images = normalizeAssistantImages(
      (record as { images?: unknown }).images,
    );
    if (images.length > 0) record.images = images;
    else delete record.images;
    if ((record as { app?: unknown }).app === "popo") record.app = "popo";
    else delete record.app;
    const msgIds = normalizeMsgIds((record as { msgIds?: unknown }).msgIds);
    if (msgIds.length > 0) record.msgIds = msgIds;
    else delete record.msgIds;
    return record;
  } catch {
    return undefined;
  }
}

function readAll(dir: string): MuseChatLine[] {
  const lines: MuseChatLine[] = [];
  for (const name of listSliceNames(dir)) {
    const content = fs.readFileSync(path.join(dir, name), "utf8");
    for (const raw of content.split("\n")) {
      const line = parseLine(raw);
      if (line) lines.push(line);
    }
  }
  return lines;
}

function capLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) {
    return ASSISTANT_PAGE_SIZE;
  }
  return Math.min(Math.floor(limit), ASSISTANT_PAGE_SIZE);
}

function sliceCodePoints(text: string, max: number): { text: string; truncated: boolean } {
  const chars = [...text];
  if (chars.length <= max) return { text, truncated: false };
  return { text: chars.slice(0, max).join(""), truncated: true };
}

function olderThan(lines: MuseChatLine[], before?: string): MuseChatLine[] {
  if (!before) return lines;
  const index = lines.findIndex((line) => line.id === before);
  if (index < 0) return [];
  return lines.slice(0, index);
}

export function createAssistantMessageLog(options: {
  home: string;
  now?: () => number;
  newId?: () => string;
}): {
  append(
    role: MuseChatRole,
    message: string,
    images?: MuseChatImage[],
    app?: "popo",
    msgIds?: string[],
  ): MuseChatLine;
  page(args?: { before?: string; limit?: number }): MuseChatPage;
  search(args: { q: string; before?: string; limit?: number }): MuseChatSearchPage;
} {
  const now = () => options.now?.() ?? Date.now();
  const newId = () => options.newId?.() ?? crypto.randomUUID();
  const dir = messagesDir(options.home);

  function append(
    role: MuseChatRole,
    message: string,
    images?: MuseChatImage[],
    app?: "popo",
    msgIds?: string[],
  ): MuseChatLine {
    fs.mkdirSync(dir, { recursive: true });
    const names = listSliceNames(dir);
    let name = names.at(-1) ?? "000001.jsonl";
    let filePath = path.join(dir, name);
    if (names.length > 0 && fs.statSync(filePath).size >= ASSISTANT_SLICE_BYTES) {
      const next = Number(name.slice(0, 6)) + 1;
      name = `${String(next).padStart(6, "0")}.jsonl`;
      filePath = path.join(dir, name);
    }
    const at = now();
    const kept = normalizeAssistantImages(images);
    const keptIds = normalizeMsgIds(msgIds);
    const line: MuseChatLine = {
      id: newId(),
      at,
      role,
      message,
      ...(kept.length > 0 ? { images: kept } : {}),
      ...(app === "popo" ? { app: "popo" as const } : {}),
      ...(keptIds.length > 0 ? { msgIds: keptIds } : {}),
    };
    fs.appendFileSync(filePath, `${JSON.stringify(line)}\n`);
    return line;
  }

  function page(args?: { before?: string; limit?: number }): MuseChatPage {
    const limit = capLimit(args?.limit);
    const eligible = olderThan(readAll(dir), args?.before);
    return {
      messages: eligible.slice(-limit),
      hasMore: eligible.length > limit,
    };
  }

  function search(args: { q: string; before?: string; limit?: number }): MuseChatSearchPage {
    const limit = capLimit(args.limit);
    const names = listSliceNames(dir);
    const hits: MuseChatLine[] = [];
    let bytes = 0;
    let filesRead = 0;
    let truncatedScan = false;
    let hasMore = false;
    let seenBefore = !args.before;

    for (let i = names.length - 1; i >= 0; i--) {
      if (filesRead >= ASSISTANT_SEARCH_MAX_FILES || bytes >= ASSISTANT_SEARCH_MAX_BYTES) {
        truncatedScan = true;
        break;
      }
      const content = fs.readFileSync(path.join(dir, names[i]), "utf8");
      filesRead += 1;
      bytes += Buffer.byteLength(content);
      const parsed: MuseChatLine[] = [];
      for (const raw of content.split("\n")) {
        const line = parseLine(raw);
        if (line) parsed.push(line);
      }
      for (let j = parsed.length - 1; j >= 0; j--) {
        const line = parsed[j];
        if (!seenBefore) {
          if (line.id === args.before) seenBefore = true;
          continue;
        }
        if (!line.message.includes(args.q)) continue;
        if (hits.length >= limit) {
          hasMore = true;
          break;
        }
        hits.push(line);
      }
      if (hasMore) break;
      if (bytes >= ASSISTANT_SEARCH_MAX_BYTES && i > 0) {
        truncatedScan = true;
        break;
      }
    }

    const messages = hits.reverse().map((line) => {
      const clipped = sliceCodePoints(line.message, ASSISTANT_TEXT_MAX);
      return clipped.truncated
        ? { ...line, message: clipped.text, truncated: true as const }
        : line;
    });
    return truncatedScan
      ? { messages, hasMore, truncatedScan: true }
      : { messages, hasMore };
  }

  return { append, page, search };
}
