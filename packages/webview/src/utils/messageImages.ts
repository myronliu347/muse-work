import type { Message, MessageBlock } from "../types";

/** Max session transcripts kept for instant switch paint. */
export const TRANSCRIPT_CACHE_MAX_SESSIONS = 3;

/**
 * Ingest hook for message image URLs.
 *
 * data: must stay as data: — rewriting to blob: broke thumbs in the desktop
 * renderer. Strip leftover blob: handles from that experiment so they cannot
 * paint as broken icons; the next host page supplies data: again.
 * Memory wins come from slimTranscriptCache + stable callbacks instead.
 */
export function materializeImageUrl(url: string): string {
  if (url.startsWith("blob:")) return "";
  return url;
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
      if (!img.data?.startsWith("blob:")) return img;
      changed = true;
      return { ...img, data: "" };
    });
    return changed ? { ...block, images } : block;
  }
  return block;
}

/** Keep data: image URLs; drop unrecoverable blob: leftovers. */
export function materializeMessageImages(messages: Message[]): Message[] {
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

export type AttachedImageRef = { data: string; mediaType: string };

/** Keep data: attached images; drop unrecoverable blob: leftovers. */
export function materializeAttachedImages(
  images: AttachedImageRef[] | undefined,
): AttachedImageRef[] | undefined {
  if (!images?.length) return images;
  let changed = false;
  const next = images.map((img) => {
    const data = materializeImageUrl(img.data);
    if (data === img.data) return img;
    changed = true;
    return { ...img, data };
  });
  return changed ? next : images;
}
/** @deprecated no-op; kept for existing tests/imports */
export function clearMessageImageBlobCacheForTests(): void {}

/** @deprecated no-op */
export function dataUrlFingerprint(dataUrl: string): string {
  return `${dataUrl.length}`;
}

/** @deprecated unused after blob materialize was disabled */
export function dataUrlToBlob(_dataUrl: string): Blob | null {
  return null;
}

function collectBlobUrlsFromBlocks(
  blocks: MessageBlock[] | undefined,
  into: Set<string>,
): void {
  if (!blocks?.length) return;
  for (const block of blocks) {
    if (block.type === "image" && block.imageUrls?.length) {
      for (const url of block.imageUrls) {
        if (url.startsWith("blob:")) into.add(url);
      }
    }
    if (block.type === "tool" && block.images?.length) {
      for (const img of block.images) {
        if (typeof img.data === "string" && img.data.startsWith("blob:")) {
          into.add(img.data);
        }
      }
    }
  }
}

export function collectBlobUrlsFromMessages(messages: Message[]): Set<string> {
  const urls = new Set<string>();
  for (const message of messages) {
    collectBlobUrlsFromBlocks(message.blocks, urls);
  }
  return urls;
}

export function collectBlobUrlsFromAttachedImages(
  images: Array<{ data: string }> | undefined,
  into: Set<string> = new Set(),
): Set<string> {
  if (!images?.length) return into;
  for (const img of images) {
    if (img.data.startsWith("blob:")) into.add(img.data);
  }
  return into;
}

export function revokeBlobUrlsExcept(
  keep: Set<string>,
  candidates: Iterable<string>,
): void {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
    return;
  }
  for (const url of candidates) {
    if (!url.startsWith("blob:") || keep.has(url)) continue;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore revoke failures; the URL may already be gone.
    }
  }
}

export function revokeUnusedMessageImageBlobs(
  previous: Message[],
  next: Message[],
  keepExtra?: Set<string>,
): void {
  const prev = collectBlobUrlsFromMessages(previous);
  if (prev.size === 0) return;
  const keep = collectBlobUrlsFromMessages(next);
  if (keepExtra) {
    for (const url of keepExtra) keep.add(url);
  }
  revokeBlobUrlsExcept(keep, prev);
}

export function revokeUnusedAttachedImageBlobs(
  previous: Array<{ data: string }> | undefined,
  next: Array<{ data: string }> | undefined,
): void {
  const prev = collectBlobUrlsFromAttachedImages(previous);
  if (prev.size === 0) return;
  revokeBlobUrlsExcept(collectBlobUrlsFromAttachedImages(next), prev);
}

function slimBlock(block: MessageBlock): MessageBlock {
  if (block.type === "image" && block.imageUrls?.length) {
    // Drop heavy data: payloads from the session switch book. Skip empty / blob
    // leftovers so switch-back paint does not flash broken thumbs.
    if (!block.imageUrls.some((url) => url.startsWith("data:"))) {
      return block;
    }
    return {
      ...block,
      imageUrls: block.imageUrls.map((url) =>
        url.startsWith("data:") ? "" : url,
      ),
    };
  }
  if (block.type === "tool" && block.images?.length) {
    if (
      !block.images.some(
        (img) => typeof img.data === "string" && img.data.startsWith("data:"),
      )
    ) {
      return block;
    }
    return {
      ...block,
      images: block.images.map((img) =>
        typeof img.data === "string" && img.data.startsWith("data:")
          ? { ...img, data: "" }
          : img,
      ),
    };
  }
  return block;
}

/**
 * Copy a transcript for transcriptsBySession without retaining base64
 * payloads. Session switch refetches the real page from the host.
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

export function collectBlobUrlsFromTranscriptBook(
  book: Record<string, Message[]> | undefined,
): Set<string> {
  const urls = new Set<string>();
  if (!book) return urls;
  for (const messages of Object.values(book)) {
    for (const url of collectBlobUrlsFromMessages(messages)) urls.add(url);
  }
  return urls;
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
