import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diffLines, enrichFileHistory } from "../../src/utils/fileHistoryDiff.js";

describe("diffLines", () => {
  it("returns zero diff for identical content", () => {
    const r = diffLines("a\nb\nc\n", "a\nb\nc\n");
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(0);
    expect(r.hunks).toBe("");
  });

  it("counts additions and deletions for a modified middle block", () => {
    const before = "line1\nline2\nline3\nline4\nline5\n";
    const after = "line1\nline2\nCHANGED\nline4\nline5\n";
    const r = diffLines(before, after);
    expect(r.additions).toBe(1);
    expect(r.deletions).toBe(1);
    expect(r.hunks).toMatch(/^@@ -/);
  });

  it("counts pure additions", () => {
    const before = "a\nb\n";
    const after = "a\nb\nc\nd\n";
    const r = diffLines(before, after);
    expect(r.additions).toBe(2);
    expect(r.deletions).toBe(0);
  });

  it("counts pure deletions", () => {
    const before = "a\nb\nc\n";
    const after = "a\n";
    const r = diffLines(before, after);
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(2);
  });

  it("counts a full-file create as all additions", () => {
    const r = diffLines("", "a\nb\n");
    expect(r.additions).toBe(2);
    expect(r.deletions).toBe(0);
  });

  it("counts a full-file delete as all deletions", () => {
    const r = diffLines("a\nb\n", "");
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(2);
  });

  it("hunks carry git-style headers with context", () => {
    const before = "1\n2\n3\n4\n5\n6\n7\n8\n";
    const after = "1\n2\n3\nX\n5\n6\n7\n8\n";
    const r = diffLines(before, after);
    // Header must include line ranges; body must include +X and -4
    expect(r.hunks).toContain("+X");
    expect(r.hunks).toContain("-4");
  });

  it("handles files without trailing newline", () => {
    const r = diffLines("a\nb", "a\nb\nc");
    expect(r.additions).toBe(1);
  });
});

describe("enrichFileHistory", () => {
  let dir: string;
  let snapshotsDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fhd-enrich-"));
    snapshotsDir = path.join(dir, "file-history");
    fs.mkdirSync(snapshotsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function snapshotFile(content: string): string {
    const p = path.join(snapshotsDir, `snap-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(p, content);
    return p;
  }

  function message(id: string, role: string, blocks: unknown[]) {
    return { id, role, timestamp: "0", blocks };
  }

  it("enriches the last assistant message's file_history snapshots", () => {
    const filePath = path.join(dir, "app.js");
    fs.writeFileSync(filePath, "const a = 1;\nconst b = 2;\n");
    const snapshotPath = snapshotFile("const a = 1;\n");
    const messages = [
      message("u1", "user", [{ type: "text", content: "hi" }]),
      message("a1", "assistant", [
        {
          type: "file_history",
          snapshots: [{ filePath, snapshotPath, operation: "modify", timestamp: 1 }],
        },
      ]),
    ];
    const result = enrichFileHistory(messages, dir, "s1");
    const block = result[1].blocks[0];
    expect(block.type).toBe("file_history");
    expect(block.snapshots[0].additions).toBe(1);
    expect(block.snapshots[0].deletions).toBe(0);
    expect(block.snapshots[0].hunks).toContain("+const b = 2;");
  });

  it("enriches the newest message that carries a file_history block even when the last message has none", () => {
    const filePath = path.join(dir, "a.txt");
    fs.writeFileSync(filePath, "new\n");
    const snapshotPath = snapshotFile("old\n");
    const messages = [
      message("a-old", "assistant", [
        {
          type: "file_history",
          snapshots: [{ filePath, snapshotPath, operation: "modify", timestamp: 1 }],
        },
      ]),
      message("a-last", "assistant", [{ type: "text", content: "done" }]),
    ];
    const result = enrichFileHistory(messages, dir, "s1");
    expect(result[0].blocks[0].snapshots[0].additions).toBe(1);
    // The trailing message stays untouched.
    expect(result[1].blocks[0].content).toBe("done");
  });

  it("enriches every file_history message within the newest turn", () => {
    const filePath = path.join(dir, "a.txt");
    fs.writeFileSync(filePath, "third\n");
    const snapOld = snapshotFile("first\n");
    const snapNew = snapshotFile("second\n");
    const messages = [
      message("u1", "user", [{ type: "text", content: "做 xxxx" }]),
      message("a1", "assistant", [
        {
          type: "file_history",
          snapshots: [{ filePath, snapshotPath: snapOld, operation: "modify", timestamp: 1 }],
        },
      ]),
      message("a2", "assistant", [
        {
          type: "file_history",
          snapshots: [{ filePath, snapshotPath: snapNew, operation: "modify", timestamp: 2 }],
        },
      ]),
      message("a3", "assistant", [{ type: "text", content: "done" }]),
    ];
    const result = enrichFileHistory(messages, dir, "s1");
    // Both messages of the newest turn (u1 → a1/a2) are enriched.
    expect(result[1].blocks[0].snapshots[0].additions).toBe(1);
    expect(result[1].blocks[0].snapshots[0].deletions).toBe(1);
    expect(result[2].blocks[0].snapshots[0].additions).toBe(1);
    expect(result[2].blocks[0].snapshots[0].deletions).toBe(1);
  });

  it("skips a trailing turn without file_history and enriches the previous turn", () => {
    const filePath = path.join(dir, "a.txt");
    fs.writeFileSync(filePath, "new\n");
    const snapshotPath = snapshotFile("old\n");
    const messages = [
      message("u1", "user", [{ type: "text", content: "做 xxxx" }]),
      message("a-old", "assistant", [
        {
          type: "file_history",
          snapshots: [{ filePath, snapshotPath, operation: "modify", timestamp: 1 }],
        },
      ]),
      message("u2", "user", [{ type: "text", content: "跑个测试" }]),
      message("a-diag", "assistant", [{ type: "text", content: "结果通过" }]),
    ];
    const result = enrichFileHistory(messages, dir, "s1");
    // The diagnostic turn (u2 → a-diag) has no file_history; the previous
    // turn's changes are enriched instead.
    expect(result[1].blocks[0].snapshots[0].additions).toBe(1);
    expect(result[3].blocks[0].content).toBe("结果通过");
  });

  it("does not let meta-injected user messages break the turn", () => {
    const filePath = path.join(dir, "a.txt");
    fs.writeFileSync(filePath, "new\n");
    const snapshotPath = snapshotFile("old\n");
    const messages = [
      message("u1", "user", [{ type: "text", content: "做 xxxx" }]),
      message("a1", "assistant", [
        {
          type: "file_history",
          snapshots: [{ filePath, snapshotPath, operation: "modify", timestamp: 1 }],
        },
      ]),
      { id: "meta", role: "user", isMeta: true, timestamp: "0", blocks: [{ type: "text", content: "reminder" }] },
      message("a2", "assistant", [{ type: "text", content: "done" }]),
    ];
    const result = enrichFileHistory(messages, dir, "s1");
    expect(result[1].blocks[0].snapshots[0].additions).toBe(1);
  });

  it("removes snapshots whose current content matches the snapshot (already reverted)", () => {
    const filePath = path.join(dir, "a.txt");
    fs.writeFileSync(filePath, "same\n");
    const snapshotPath = snapshotFile("same\n");
    const messages = [
      message("a1", "assistant", [
        {
          type: "file_history",
          snapshots: [{ filePath, snapshotPath, operation: "modify", timestamp: 1 }],
        },
      ]),
    ];
    const result = enrichFileHistory(messages, dir, "s1");
    // The only snapshot vanished → the whole block is dropped.
    expect(result[0].blocks.some((b: { type?: string }) => b.type === "file_history")).toBe(false);
  });

  it("drops the whole block when all snapshots vanish", () => {
    const filePath = path.join(dir, "a.txt");
    fs.writeFileSync(filePath, "same\n");
    const snapshotPath = snapshotFile("same\n");
    const messages = [
      message("a1", "assistant", [
        {
          type: "file_history",
          snapshots: [{ filePath, snapshotPath, operation: "modify", timestamp: 1 }],
        },
      ]),
    ];
    const result = enrichFileHistory(messages, dir, "s1");
    expect(result[0].blocks.some((b: { type?: string }) => b.type === "file_history")).toBe(false);
  });

  it("keeps snapshot when snapshotPath is missing but file content differs", () => {
    const filePath = path.join(dir, "a.txt");
    fs.writeFileSync(filePath, "current\n");
    const messages = [
      message("a1", "assistant", [
        {
          type: "file_history",
          snapshots: [{ filePath, operation: "delete", timestamp: 1 }],
        },
      ]),
    ];
    // delete operation with a file still present: content differs, keep with diff
    const result = enrichFileHistory(messages, dir, "s1");
    const snap = result[0].blocks[0].snapshots[0];
    expect(snap.deletions).toBe(0);
    expect(snap.additions).toBeGreaterThan(0);
  });

  it("returns messages unchanged when there is no file_history block", () => {
    const messages = [
      message("a1", "assistant", [{ type: "text", content: "ok" }]),
    ];
    const result = enrichFileHistory(messages, dir, "s1");
    expect(result).toEqual(messages);
  });
});
