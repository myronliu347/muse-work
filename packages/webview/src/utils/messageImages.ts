import type { Message, MessageBlock } from "../types";

/** Max session transcripts kept for instant switch paint. */
export const TRANSCRIPT_CACHE_MAX_SESSIONS = 3;

/** Fingerprint → blob URL. Never keyed by the data URL itself (that would pin base64). */
const blobUrlByFingerprint = new Map<string, string>();

/** Test helper: drop the fingerprint → blob memo. */
export function clearMessageImageBlobCacheForTests(): void {
  blobUrlByFingerprint.clear();
}

function canCreateBlobUrl(): boolean {
  return (
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof atob === "function"
  );
}

/** Cheap stable id so identical payloads share one blob without retaining the string. */
export function dataUrlFingerprint(dataUrl: string): string {
  let hash = 2166136261;
  for (let i = 0; i < dataUrl.length; i++) {
    hash ^= dataUrl.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${dataUrl.length.toString(16)}:${(hash >>> 0).toString(16)}`;
}

/** Parse a data URL into a Blob. Returns null when the input is not usable. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const base64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  try {
    if (base64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(payload)], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Turn a data: image URL into a blob: URL so React state does not retain the
 * multi-hundred-KB base64 string. Identical payloads reuse one blob URL.
 */
export function materializeImageUrl(url: string): string {
  if (!url.startsWith("data:")) return url;
  const fingerprint = dataUrlFingerprint(url);
  const cached = blobUrlByFingerprint.get(fingerprint);
  if (cached) return cached;
  if (!canCreateBlobUrl()) return url;
  const blob = dataUrlToBlob(url);
  if (!blob) return url;
  const blobUrl = URL.createObjectURL(blob);
  blobUrlByFingerprint.set(fingerprint, blobUrl);
  return blobUrl;
}

function materializeBlock(block: MessageBlock): MessageBlock {
  if (block.type === "image" && block.imageUrls?.length) {
    let changed = false;
    const imageUrls = block.imageUrls.map((url) => {
      const next = materializeImageUrl(url);
      if (next !== url) changed = true;
      return next;
    });
    return changed ? { ...block, imageUrls } : block;
  }
  if (block.type === "tool" && block.images?.length) {
    let changed = false;
    const images = block.images.map((img) => {
      if (!img.data?.startsWith("data:")) return img;
      const next = materializeImageUrl(img.data);
      if (next === img.data) return img;
      changed = true;
      return { ...img, data: next };
    });
    return changed ? { ...block, images } : block;
  }
  return block;
}

/** Replace embedded data: image URLs with blob: URLs on a message list. */
export function materializeMessageImages(
  messages: Message[],
): Message[] {
  let listChanged = false;
  const next = messages.map((message) => {
    const blocks = message.blocks;
    if (!blocks?.length) return message;
    let blocksChanged = false;
    const nextBlocks = blocks.map((block) => {
      const nextBlock = materializeBlock(block);
      if (nextBlock !== block) blocksChanged = true;
      return nextBlock;
    });
    if (!blocksChanged) return message;
    listChanged = true;
    return { ...message, blocks: nextBlocks };
  });
  return listChanged ? next : messages;
}

function slimBlock(block: MessageBlock): MessageBlock {
  if (block.type === "image" && block.imageUrls?.length) {
    if (
      !block.imageUrls.some(
        (url) => url.startsWith("data:") || url.startsWith("blob:"),
      )
    ) {
      return block;
    }
    // Keep slot count for layout hints; drop the heavy payloads from the cache.
    return {
      ...block,
      imageUrls: block.imageUrls.map(() => ""),
    };
  }
  if (block.type === "tool" && block.images?.length) {
    if (
      !block.images.some(
        (img) =>
          typeof img.data === "string" &&
          (img.data.startsWith("data:") || img.data.startsWith("blob:")),
      )
    ) {
      return block;
    }
    return {
      ...block,
      images: block.images.map((img) =>
        typeof img.data === "string" &&
        (img.data.startsWith("data:") || img.data.startsWith("blob:"))
          ? { ...img, data: "" }
          : img,
      ),
    };
  }
  return block;
}

/**
 * Copy a transcript for transcriptsBySession without retaining base64 / blob
 * image payloads. Session switch still refetches the real page from the host.
 */
export function slimMessagesForTranscriptCache(
  messages: Message[],
): Message[] {
  let listChanged = false;
  const next = messages.map((message) => {
    const blocks = message.blocks;
    if (!blocks?.length) return message;
    let changed = false;
    const nextBlocks = blocks.map((block) => {
      const slimmed = slimBlock(block);
      if (slimmed !== block) changed = true;
      return slimmed;
    });
    if (!changed) return message;
    listChanged = true;
    return { ...message, blocks: nextBlocks };
  });
  return listChanged ? next : messages;
}

/** Drop oldest session entries until the book fits the size cap. */
export function evictTranscriptCache(
  book: Record<string, Message[]>,
  keepId: string,
  maxSessions = TRANSCRIPT_CACHE_MAX_SESSIONS,
): Record<string, Message[]> {
  const keys = Object.keys(book);
  if (keys.length <= maxSessions) return book;
  const next = { ...book };
  for (const key of keys) {
    if (key === keepId) continue;
    delete next[key];
    if (Object.keys(next).length <= maxSessions) break;
  }
  return next;
}
