import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readAssistantTranscriptCache,
  resetAssistantTranscriptCache,
  writeAssistantTranscriptCache,
} from "../../src/muse/assistantTranscriptCache";

const owner = {};

function line(id: string) {
  return {
    id,
    at: 1,
    role: "assistant" as const,
    message: `msg ${id}`,
  };
}

afterEach(() => {
  vi.useRealTimers();
  resetAssistantTranscriptCache();
});

describe("assistant transcript cache", () => {
  it("seeds a later mount for the same owner", () => {
    writeAssistantTranscriptCache(owner, {
      lines: [line("a")],
      hasMore: true,
    });
    expect(readAssistantTranscriptCache(owner)?.lines.map((l) => l.id)).toEqual([
      "a",
    ]);
    expect(readAssistantTranscriptCache(owner)?.hasMore).toBe(true);
  });

  it("is keyed by owner so another pane starts clean", () => {
    writeAssistantTranscriptCache(owner, { lines: [line("a")], hasMore: false });
    expect(readAssistantTranscriptCache({})).toBeNull();
  });

  it("replaces instead of appending", () => {
    writeAssistantTranscriptCache(owner, { lines: [line("a")], hasMore: false });
    writeAssistantTranscriptCache(owner, { lines: [line("b")], hasMore: false });
    expect(readAssistantTranscriptCache(owner)?.lines.map((l) => l.id)).toEqual([
      "b",
    ]);
  });

  it("drops a snapshot after 30 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    writeAssistantTranscriptCache(owner, { lines: [line("a")], hasMore: false });
    vi.setSystemTime(new Date("2026-01-01T00:29:00Z"));
    expect(readAssistantTranscriptCache(owner)).not.toBeNull();
    vi.setSystemTime(new Date("2026-01-01T00:31:00Z"));
    expect(readAssistantTranscriptCache(owner)).toBeNull();
  });
});
