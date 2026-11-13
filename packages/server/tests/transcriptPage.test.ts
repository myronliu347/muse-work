import { describe, expect, it } from "vitest";
import {
  pageTranscript,
  TRANSCRIPT_INITIAL_LIMIT,
  type PageMessage,
} from "../src/utils/transcriptPage.js";

function msg(id: string, type: "text" | "compact" = "text"): PageMessage {
  return { id, blocks: [{ type }] };
}

describe("pageTranscript", () => {
  const disk = [
    msg("u1"),
    msg("a1"),
    msg("u2"),
    msg("a2"),
    msg("c1", "compact"),
    msg("u3"),
    msg("a3"),
  ];

  it("opens on the chronological tail after the last compact, not the folded API order", () => {
    const live = [msg("c1", "compact"), msg("u2"), msg("a2"), msg("u3"), msg("a3")];
    const page = pageTranscript(disk, live);
    expect(page.messages.map((m) => m.id)).toEqual(["c1", "u3", "a3"]);
    expect(page.hasMore).toBe(true);
  });

  it("appends live messages that are not on disk yet", () => {
    const page = pageTranscript(disk, [...disk, msg("u4")]);
    expect(page.messages.map((m) => m.id)).toEqual(["c1", "u3", "a3", "u4"]);
    expect(page.hasMore).toBe(true);
  });

  it("pages backward from an id and does not keep the prefix", () => {
    const page = pageTranscript(disk, [], { before: "c1", limit: 2 });
    expect(page.messages.map((m) => m.id)).toEqual(["u2", "a2"]);
    expect(page.hasMore).toBe(true);
    const older = pageTranscript(disk, [], { before: "u2", limit: 2 });
    expect(older.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(older.hasMore).toBe(false);
  });

  it("returns the whole transcript when nothing has been compacted", () => {
    const plain = [msg("u1"), msg("a1")];
    const page = pageTranscript(plain, plain);
    expect(page.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(page.hasMore).toBe(false);
  });

  it("caps the first page and pages back through a long session", () => {
    const long = Array.from({ length: 200 }, (_, i) => msg(`m${i}`));
    const page = pageTranscript(long, []);
    expect(page.messages).toHaveLength(TRANSCRIPT_INITIAL_LIMIT);
    expect(page.messages[0]?.id).toBe(`m${200 - TRANSCRIPT_INITIAL_LIMIT}`);
    expect(page.messages.at(-1)?.id).toBe("m199");
    expect(page.hasMore).toBe(true);

    // Walking backward with the page size reaches the start and then stops.
    let before = page.messages[0]!.id;
    let loaded = page.messages.length;
    for (;;) {
      const older = pageTranscript(long, [], { before });
      if (older.messages.length === 0) break;
      loaded += older.messages.length;
      before = older.messages[0]!.id;
      if (!older.hasMore) break;
    }
    expect(loaded).toBe(long.length);
  });

  it("caps a post-compaction tail that is still longer than the page", () => {
    const long = Array.from({ length: 200 }, (_, i) => msg(`m${i}`));
    long[100] = msg("m100", "compact");
    const page = pageTranscript(long, []);
    // The post-compact tail is longer than the cap, so the window starts after
    // the compact; the compact marker is still reachable by paging backwards.
    expect(page.messages).toHaveLength(TRANSCRIPT_INITIAL_LIMIT);
    expect(page.hasMore).toBe(true);
  });
});
