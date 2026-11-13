import { describe, expect, it } from "vitest";
import { pruneMissingImageRefs } from "../src/utils/pruneMissingImages.js";

type Block = Record<string, unknown>;
type Msg = { id: string; blocks?: Block[] };

const image = (...urls: string[]): Block => ({ type: "image", imageUrls: urls });

describe("pruneMissingImageRefs", () => {
  const exists = (path: string) => path === "/tmp/kept.png";

  it("drops filesystem refs whose upload is gone and keeps the rest", () => {
    const messages: Msg[] = [
      {
        id: "m1",
        blocks: [
          { type: "text", content: "hi" },
          image("/tmp/kept.png", "/tmp/gone.png"),
          image("/tmp/gone-2.png"),
        ],
      },
    ];
    const out = pruneMissingImageRefs(messages, exists);
    expect(out[0].blocks).toEqual([
      { type: "text", content: "hi" },
      { type: "image", imageUrls: ["/tmp/kept.png"], missingImageCount: 1 },
      { type: "image", imageUrls: [], missingImageCount: 1 },
    ]);
  });

  it("keeps data:, file: and http refs without touching the filesystem", () => {
    const seen: string[] = [];
    const messages: Msg[] = [
      {
        id: "m1",
        blocks: [
          image("data:image/png;base64,AAAA"),
          image("file:///tmp/gone.png"),
          image("https://example.com/a.png"),
        ],
      },
    ];
    const out = pruneMissingImageRefs(messages, (path) => {
      seen.push(path);
      return false;
    });
    expect(out).toBe(messages);
    expect(seen).toEqual([]);
  });

  it("returns the same list when every file exists", () => {
    const messages: Msg[] = [
      { id: "m1", blocks: [image("/tmp/kept.png")] },
      { id: "m2", blocks: [{ type: "text", content: "no image" }] },
    ];
    expect(pruneMissingImageRefs(messages, exists)).toBe(messages);
  });

  it("keeps a placeholder count when no ref is left", () => {
    const messages: Msg[] = [
      { id: "m1", blocks: [image("/tmp/a.png", "/tmp/b.png")] },
    ];
    const out = pruneMissingImageRefs(messages, () => false);
    expect(out[0].blocks).toEqual([
      { type: "image", imageUrls: [], missingImageCount: 2 },
    ]);
  });

  it("does not double count a block that was already marked", () => {
    const messages: Msg[] = [
      {
        id: "m1",
        blocks: [
          { type: "image", imageUrls: [], missingImageCount: 2 },
        ],
      },
    ];
    expect(pruneMissingImageRefs(messages, () => false)).toBe(messages);
  });
});
