import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { formatAssistantEvent, formatAssistantEvents, formatEventTimestamp, viewAssistantEvent } from "../src/services/assistant/events.js";
import { createAssistantQueue } from "../src/services/assistant/queue.js";

describe("assistant events and queue", () => {
  it("formats the three event kinds and omits empty fields", () => {
    expect(formatAssistantEvent({
      type: "chat",
      from: "room",
      message: "你好",
      user: "a@corp",
      groupId: "g1",
    })).toBe("type: chat\nfrom: room\nmessage: 你好\nuser: a@corp\ngroupId: g1");
    const triggeredAt = Date.UTC(2026, 9, 20, 8, 1, 37);
    expect(formatAssistantEvent({
      type: "chat",
      from: "muse",
      message: "现在",
      timestamp: triggeredAt,
    })).toBe(`type: chat\ntimestamp: ${formatEventTimestamp(triggeredAt)}\nfrom: muse\nmessage: 现在`);
    expect(formatAssistantEvents([
      { type: "chat", from: "muse", message: "一" },
      { type: "issue", issueId: "i1", title: "登录", workdir: "/repo", summary: "s" },
    ])).toBe(
      "type: chat\nfrom: muse\nmessage: 一\n\ntype: issue\nissueId: i1\ntitle: 登录\nworkdir: /repo\nsummary: s",
    );
    const longSummary = "你".repeat(8001);
    const issue = formatAssistantEvent({
      type: "issue",
      issueId: "i1",
      title: "登录",
      workdir: "/repo",
      summary: longSummary,
    });
    expect(issue).toContain("type: issue");
    const summaryLine = issue.split("\n").find((line) => line.startsWith("summary: "));
    expect(summaryLine?.slice("summary: ".length)).toBe(longSummary);
    expect(issue).not.toContain("summaryNote");
    expect(formatAssistantEvent({
      type: "issue",
      issueId: "i1",
      title: "登录",
      workdir: "/repo",
      request: "修登录",
      summary: "已经修好",
    })).toBe(
      "type: issue\nissueId: i1\ntitle: 登录\nworkdir: /repo\nrequest: 修登录\nsummary: 已经修好",
    );
    expect(formatAssistantEvent({
      type: "issue",
      issueId: "i1",
      title: "登录",
      workdir: "/repo",
      summary: "已经修好",
    })).not.toContain("summaryNote");
    expect(formatAssistantEvent({
      type: "automation",
      automationId: "a",
      name: "巡检",
      runId: "r",
      workdir: "/repo",
      status: "skipped",
      trigger: "cron",
      mode: "agent",
    })).not.toContain("error:");
    expect(formatAssistantEvent({
      type: "automation",
      automationId: "a",
      name: "站会",
      runId: "r",
      workdir: "",
      status: "succeeded",
      trigger: "cron",
      mode: "remind",
      instruction: "提醒用户开站会",
    })).toContain("instruction: 提醒用户开站会");
  });

  it("persists fifo order and reloads", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-q-"));
    const q = createAssistantQueue({ home });
    q.enqueue({ type: "chat", from: "muse", message: "1" });
    q.enqueue({ type: "chat", from: "muse", message: "2" });
    expect(q.peek()).toMatchObject({ message: "1" });
    q.dropHead();
    const again = createAssistantQueue({ home });
    expect(again.peek()).toMatchObject({ message: "2" });
    expect(fs.existsSync(path.join(getMuseHomeDir(home), "db", "assistant-queue.json"))).toBe(true);
  });

  it("markRetry keeps the head and appends retry lines", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-q2-"));
    const q = createAssistantQueue({ home });
    q.enqueue({ type: "chat", from: "muse", message: "1" });
    q.markRetry("boom");
    expect(formatAssistantEvent(q.peek()!)).toContain("retry: 1\nerror: boom");
    expect(q.list()).toEqual([
      { type: "chat", title: "Muse：1", retry: true },
    ]);
  });

  it("folds a waiting chat from the same person onto the tail", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-q3-"));
    const q = createAssistantQueue({ home });
    q.enqueue({ type: "chat", from: "muse", message: "一" });
    expect(q.absorb({ type: "chat", from: "muse", message: "二" }, true)).toBe(false);
    expect(q.absorb({ type: "chat", from: "muse", message: "二" }, false)).toBe(true);
    expect(q.peek()).toMatchObject({ message: "一\n二" });
    q.enqueue({ type: "issue", issueId: "i1", title: "登录", workdir: "/repo", summary: "s" });
    expect(q.absorb({ type: "chat", from: "muse", message: "三" }, true)).toBe(false);
    q.enqueue({ type: "chat", from: "desk", user: "a", message: "4", images: [{ data: "a", mediaType: "image/png" }] });
    expect(q.absorb({
      type: "chat",
      from: "desk",
      user: "a",
      message: "5",
      images: [{ data: "b", mediaType: "image/png" }],
    }, true)).toBe(true);
    expect(q.absorb({ type: "chat", from: "desk", user: "b", message: "6" }, true)).toBe(false);
    const tail = q.list();
    expect(tail.map((item) => item.title)).toEqual(["Muse：一 二", "登录", "desk：4 5"]);
    const homeBatch = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-q4-"));
    const batch = createAssistantQueue({ home: homeBatch });
    batch.enqueue({ type: "issue", issueId: "i1", title: "登录", workdir: "/repo", summary: "s" });
    batch.enqueue({ type: "chat", from: "muse", message: "一" });
    expect(batch.claimBatch()).toHaveLength(2);
    expect(batch.absorb({ type: "chat", from: "muse", message: "二" }, true)).toBe(false);
    batch.enqueue({ type: "chat", from: "muse", message: "二" });
    expect(batch.claimBatch()).toHaveLength(2);
    expect(batch.list().map((item) => item.title)).toEqual(["登录", "Muse：一", "Muse：二"]);
    expect(batch.list().map((item) => item.active ?? false)).toEqual([true, true, false]);
    const reloaded = createAssistantQueue({ home: homeBatch });
    expect(reloaded.claimBatch()).toHaveLength(2);
    reloaded.markBatchRetry("boom");
    expect(reloaded.claimBatch().every((event) => event.retry === 1)).toBe(true);
    reloaded.dropBatch();
    expect(reloaded.peek()).toMatchObject({ message: "二" });
    const again = createAssistantQueue({ home });
    expect(again.peek()).toMatchObject({ message: "一\n二" });
  });

  it("summarizes queue rows without image payloads", () => {
    expect(viewAssistantEvent({
      type: "chat",
      from: "muse",
      message: "关一下",
      images: [{ data: "abc", mediaType: "image/png" }],
    })).toEqual({ type: "chat", title: "Muse：关一下" });
    expect(viewAssistantEvent(
      { type: "chat", from: "desk", message: "在吗" },
      { desk: "服务台" },
    )).toEqual({ type: "chat", title: "服务台：在吗" });
    expect(viewAssistantEvent({
      type: "chat",
      from: "desk",
      message: "在吗",
    })).toEqual({ type: "chat", title: "desk：在吗" });
    expect(viewAssistantEvent({
      type: "issue",
      issueId: "i1",
      title: "分析 wave-agent",
      workdir: "/repo",
      summary: "x".repeat(9000),
    })).toEqual({ type: "issue", title: "分析 wave-agent" });
  });
});
