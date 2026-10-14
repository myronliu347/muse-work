import { describe, it, expect } from "vitest";
import {
  filterMentionIssues,
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

  it("reads an issue mention without treating it as a file", () => {
    const parts = parseMentions("接着做 [@issue:abc123 登录失败] 吧");
    expect(parts).toEqual([
      { type: "text", content: "接着做 " },
      {
        type: "mention",
        content: "[@issue:abc123 登录失败]",
        issueId: "abc123",
        fileName: "登录失败",
      },
      { type: "text", content: " 吧" },
    ]);
  });
});

describe("issue mention token", () => {
  it("filters issues by title or id", () => {
    const issues = [
      { id: "abc123", title: "登录失败" },
      { id: "def456", title: "导出报表" },
    ];
    expect(filterMentionIssues(issues, "登录").map((issue) => issue.id)).toEqual([
      "abc123",
    ]);
    expect(filterMentionIssues(issues, "def").map((issue) => issue.id)).toEqual([
      "def456",
    ]);
  });
});
