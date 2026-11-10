import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Message } from "../../src/types";
import {
  TRANSCRIPT_CACHE_MAX_SESSIONS,
  clearMessageImageBlobCacheForTests,
  evictTranscriptCache,
  materializeMessageImages,
  slimMessagesForTranscriptCache,
} from "../../src/utils/messageImages";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function imageMessage(id: string, urls: string[]): Message {
  return {
    id,
    role: "user",
    timestamp: "0",
    blocks: [{ type: "image", imageUrls: urls }],
  };
}

describe("messageImages", () => {
  const created: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    created.length = 0;
    clearMessageImageBlobCacheForTests();
    URL.createObjectURL = vi.fn((blob: Blob) => {
      const url = `blob:mock-${created.length}-${blob.size}`;
      created.push(url);
      return url;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("materializeMessageImages converts data URLs to blob URLs once", () => {
    const messages = [imageMessage("a", [TINY_PNG, TINY_PNG])];
    const next = materializeMessageImages(messages);
    const urls = (next[0].blocks?.[0] as { imageUrls: string[] }).imageUrls;
    expect(urls[0]).toMatch(/^blob:/);
    expect(urls[1]).toBe(urls[0]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(next).not.toBe(messages);
  });

  it("does not retain data URLs as cache keys", () => {
    materializeMessageImages([imageMessage("a", [TINY_PNG])]);
    // Re-materializing the same payload must hit the fingerprint cache, not a
    // Map keyed by the multi-KB data URL string.
    materializeMessageImages([imageMessage("b", [TINY_PNG])]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("materializeMessageImages leaves non-data URLs alone", () => {
    const messages = [imageMessage("a", ["https://example.com/a.png"])];
    expect(materializeMessageImages(messages)).toBe(messages);
  });

  it("slimMessagesForTranscriptCache strips data and blob image payloads", () => {
    const messages = materializeMessageImages([
      imageMessage("a", [TINY_PNG]),
    ]);
    const slim = slimMessagesForTranscriptCache(messages);
    const urls = (slim[0].blocks?.[0] as { imageUrls: string[] }).imageUrls;
    expect(urls).toEqual([""]);
  });

  it("evictTranscriptCache keeps the active session and caps size", () => {
    const book: Record<string, Message[]> = {
      old1: [],
      old2: [],
      old3: [],
      active: [imageMessage("x", [])],
    };
    const next = evictTranscriptCache(
      { ...book, active: book.active },
      "active",
      TRANSCRIPT_CACHE_MAX_SESSIONS,
    );
    expect(Object.keys(next)).toHaveLength(TRANSCRIPT_CACHE_MAX_SESSIONS);
    expect(next.active).toBe(book.active);
  });
});
