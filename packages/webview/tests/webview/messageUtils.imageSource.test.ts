import { describe, it, expect } from "vitest";
import {
  parseMentions,
  stripImageSourceMarkers,
} from "../../src/utils/messageUtils";

describe("stripImageSourceMarkers", () => {
  it("removes a single [Image source: path] marker", () => {
    expect(
      stripImageSourceMarkers("hello\n\n[Image source: /tmp/x.png]"),
    ).toBe("hello\n\n");
  });

  it("removes multiple markers", () => {
    expect(
      stripImageSourceMarkers(
        "look\n\n[Image source: /tmp/a.png]\n[Image source: /tmp/b.jpg]",
      ),
    ).toBe("look\n\n");
  });

  it("keeps text without markers unchanged", () => {
    expect(stripImageSourceMarkers("plain text")).toBe("plain text");
  });
});

describe("parseMentions strips [Image source: ...]", () => {
  it("hides the marker from user message text", () => {
    const parts = parseMentions(
      "hello\n\n[Image source: /tmp/muse-work/uploads/a.png]",
    );
    expect(parts).toEqual([
      { type: "text", content: "hello\n\n" },
    ]);
  });

  it("keeps real mentions next to a marker", () => {
    const parts = parseMentions(
      "[@file:/a.ts]\n\n[Image source: /tmp/x.png]",
    );
    expect(parts.map((p) => p.type)).toEqual(["mention", "text"]);
    expect(parts[1].content).toBe("\n\n");
  });
});
