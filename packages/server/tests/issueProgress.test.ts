import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { describe, expect, it } from "vitest";
import {
  ISSUE_UPDATE_LIMIT,
  createIssueProgressStore,
} from "../src/services/issueProgress.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "muse-progress-"));
}

function progressFile(home: string, issueId: string): string {
  return path.join(getMuseHomeDir(home), "db", "issue-progress", `${issueId}.jsonl`);
}

function makeStore(home: string) {
  let now = 1_000;
  let id = 0;
  return createIssueProgressStore({
    home,
    now: () => ++now,
    newId: () => `u-${++id}`,
  });
}

describe("issue progress store", () => {
  it("writes one file per issue and reads newest first", () => {
    const home = tempHome();
    const store = makeStore(home);
    store.append("issue-a", { kind: "assistant", summary: "first" });
    store.append("issue-a", { kind: "assistant", summary: "second" });
    store.append("issue-b", { kind: "turn", summary: "b" });

    expect(fs.existsSync(progressFile(home, "issue-a"))).toBe(true);
    expect(fs.existsSync(progressFile(home, "issue-b"))).toBe(true);
    expect(store.latest("issue-a")?.summary).toBe("second");
    expect(store.list("issue-a").updates.map((u) => u.summary)).toEqual([
      "second",
      "first",
    ]);
    expect(store.count("issue-a")).toBe(2);
    expect(store.latest("missing")).toBeUndefined();
  });

  it("survives a restart and dedupes sourceKey", () => {
    const home = tempHome();
    const first = makeStore(home);
    const written = first.append("issue-a", {
      kind: "assistant",
      summary: "done",
      sourceKey: "assistant:line-1",
      files: ["/tmp/report.html"],
      changedFiles: ["/tmp/src/a.ts"],
    });
    expect(written).toBeDefined();
    expect(
      first.append("issue-a", {
        kind: "assistant",
        summary: "duplicate",
        sourceKey: "assistant:line-1",
      })?.summary,
    ).toBe("done");

    const reloaded = makeStore(home);
    expect(reloaded.latest("issue-a")?.summary).toBe("done");
    expect(reloaded.latest("issue-a")?.files).toEqual(["/tmp/report.html"]);
    expect(reloaded.latest("issue-a")?.changedFiles).toEqual(["/tmp/src/a.ts"]);
    expect(
      reloaded.append("issue-a", {
        kind: "assistant",
        summary: "duplicate again",
        sourceKey: "assistant:line-1",
      })?.summary,
    ).toBe("done");
    expect(reloaded.count("issue-a")).toBe(1);
  });

  it("caps retained updates and compacts long files", () => {
    const home = tempHome();
    const store = makeStore(home);
    for (let i = 0; i < 85; i++) {
      store.append("issue-a", { kind: "turn", summary: `turn ${i}` });
    }
    expect(store.count("issue-a")).toBeGreaterThanOrEqual(ISSUE_UPDATE_LIMIT);
    expect(store.count("issue-a")).toBeLessThanOrEqual(80);
    expect(store.latest("issue-a")?.summary).toBe("turn 84");
    const lines = fs
      .readFileSync(progressFile(home, "issue-a"), "utf8")
      .split("\n")
      .filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(80);
  });

  it("skips corrupt lines and rejects path-like issue ids", () => {
    const home = tempHome();
    const store = makeStore(home);
    store.append("issue-a", { kind: "assistant", summary: "valid" });
    fs.appendFileSync(progressFile(home, "issue-a"), '{"broken":\n');

    const reloaded = makeStore(home);
    expect(reloaded.latest("issue-a")?.summary).toBe("valid");
    expect(reloaded.append("../escape", { kind: "turn", summary: "no" })).toBeUndefined();
    expect(reloaded.append("a/b", { kind: "turn", summary: "no" })).toBeUndefined();
  });

  it("returns no updates when the file does not exist", () => {
    const home = tempHome();
    const store = makeStore(home);
    expect(store.list("missing")).toEqual({ updates: [], hasMore: false });
    expect(store.count("missing")).toBe(0);
  });

  it("folds the assistant messages of one turn into a single update", () => {
    const home = tempHome();
    const store = makeStore(home);
    store.append("issue-a", { kind: "turn", summary: "回合结束", turnId: "t1" });
    store.append("issue-a", {
      kind: "assistant",
      summary: "第一段",
      next: "等用户点头",
      turnId: "t1",
      messageId: "line-1",
    });
    store.append("issue-a", {
      kind: "assistant",
      summary: "第二段",
      files: ["/tmp/report.html"],
      turnId: "t1",
      messageId: "line-2",
    });

    const updates = store.list("issue-a").updates;
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      kind: "assistant",
      summary: "第一段 第二段",
      next: "等用户点头",
      files: ["/tmp/report.html"],
      messageId: "line-2",
      turnId: "t1",
    });
    expect(updates[0]?.detail).toBe("第一段\n\n第二段");

    // 合并落盘，重启后仍是一条；换一轮则另起一条。
    const reloaded = makeStore(home);
    expect(reloaded.list("issue-a").updates).toHaveLength(2);
    reloaded.append("issue-a", {
      kind: "assistant",
      summary: "下一轮",
      turnId: "t2",
    });
    expect(reloaded.count("issue-a")).toBe(3);
  });

  it("folds the duplicate assistant lines a legacy file already holds", () => {
    const home = tempHome();
    const body = [
      {
        id: "u-old-1",
        at: 1_000,
        kind: "assistant",
        summary: "报告第一段",
        next: "等用户点头",
        turnId: "t1",
      },
      {
        id: "u-old-2",
        at: 1_001,
        kind: "assistant",
        summary: "报告第二段",
        turnId: "t1",
      },
    ];
    fs.mkdirSync(path.dirname(progressFile(home, "issue-a")), { recursive: true });
    fs.writeFileSync(
      progressFile(home, "issue-a"),
      body.map((update) => `${JSON.stringify(update)}\n`).join(""),
      "utf8",
    );

    const store = makeStore(home);
    const updates = store.list("issue-a").updates;
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: "u-old-1",
      summary: "报告第一段 报告第二段",
      next: "等用户点头",
    });
    expect(store.count("issue-a")).toBe(1);
    // 折叠结果写回文件：下次启动不会重新折一遍。
    const lines = fs
      .readFileSync(progressFile(home, "issue-a"), "utf8")
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});
