import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { formatAssistantEvent } from "../src/services/assistant/events.js";
import { createAssistantQueue } from "../src/services/assistant/queue.js";

describe("assistant events and queue", () => {
  it("formats the three event kinds and omits empty fields", () => {
    expect(formatAssistantEvent({
      type: "chat",
      from: "popo-group",
      message: "你好",
      user: "a@corp",
      groupId: "g1",
    })).toBe("type: chat\nfrom: popo-group\nmessage: 你好\nuser: a@corp\ngroupId: g1");
    expect(formatAssistantEvent({
      type: "issue",
      issueId: "i1",
      title: "登录",
      workdir: "/repo",
      summary: "你".repeat(8001),
    })).toContain("type: issue");
    const issue = formatAssistantEvent({
      type: "issue",
      issueId: "i1",
      title: "登录",
      workdir: "/repo",
      summary: "你".repeat(8001),
    });
    const summaryLine = issue.split("\n").find((line) => line.startsWith("summary: "));
    expect([...(summaryLine?.slice("summary: ".length) ?? "")].length).toBe(8000);
    expect(issue).toContain("summaryNote: summary 在这里被截断了");
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
    })).not.toContain("error:");
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
  });
});
