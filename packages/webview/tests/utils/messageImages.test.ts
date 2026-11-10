import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Message } from "../../src/types";
import {
  TRANSCRIPT_CACHE_MAX_SESSIONS,
  clearMessageImageBlobCacheForTests,
  evictTranscriptCache,
  materializeAttachedImages,
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
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    clearMessageImageBlobCacheForTests();
    URL.createObjectURL = vi.fn(() => "blob:mock") as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("materializeMessageImages keeps data URLs and does not create blobs", () => {
    const messages = [imageMessage("a", [TINY_PNG, TINY_PNG])];
    const next = materializeMessageImages(messages);
    expect(next).toBe(messages);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("materializeMessageImages clears leftover blob URLs", () => {
    const messages = [imageMessage("a", ["blob:dead", TINY_PNG])];
    const next = materializeMessageImages(messages);
    const urls = (next[0].blocks?.[0] as { imageUrls: string[] }).imageUrls;
    expect(urls).toEqual(["", TINY_PNG]);
  });

  it("materializeMessageImages leaves http URLs alone", () => {
    const messages = [imageMessage("a", ["https://example.com/a.png"])];
    expect(materializeMessageImages(messages)).toBe(messages);
  });

  it("slimMessagesForTranscriptCache strips data URLs", () => {
    const slim = slimMessagesForTranscriptCache([
      imageMessage("a", [TINY_PNG]),
    ]);
    expect(
      (slim[0].blocks?.[0] as { imageUrls: string[] }).imageUrls,
    ).toEqual([""]);
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

  it("materializeAttachedImages keeps data URLs", () => {
    const images = [
      { data: TINY_PNG, mediaType: "image/png" },
      { data: TINY_PNG, mediaType: "image/png" },
    ];
    expect(materializeAttachedImages(images)).toBe(images);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
