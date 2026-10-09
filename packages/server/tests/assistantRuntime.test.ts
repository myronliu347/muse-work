import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSessionStore } from "../src/services/sessionStore.js";
import { createAssistantQueue } from "../src/services/assistant/queue.js";
import { createAssistantRuntime } from "../src/services/assistant/runtime.js";

describe("assistant runtime", () => {
  it("injects one event at a time and retries once", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-rt-"));
    const sessions = createSessionStore({ home });
    const sends: Array<{ sessionId: string; content: string; source?: string }> = [];
    const notes: string[] = [];
    const runner = {
      sendMessage: async (sessionId: string, content: string, _images?: unknown, source?: string) => {
        sends.push({ sessionId, content, source });
        sessions.update(sessionId, {});
        return { accepted: true as const };
      },
      appendSystemNote: async (_sessionId: string, content: string) => {
        notes.push(content);
      },
    };
    const queue = createAssistantQueue({ home });
    const runtime = createAssistantRuntime({
      home,
      model: "m",
      sessions,
      runner: runner as never,
      queue,
    });
    runtime.start();
    const assistantId = sessions.list().find((s) => s.origin === "assistant")!.id;
    runtime.enqueue({ type: "chat", from: "muse", message: "一" });
    runtime.enqueue({ type: "chat", from: "muse", message: "二" });
    expect(sends).toHaveLength(1);
    expect(sends[0].source).toBe("system-inject");
    expect(sends[0].content).toContain("message: 一");
    runtime.onAssistantTurnSettled(assistantId, { ok: false, error: "boom" });
    expect(sends).toHaveLength(2);
    expect(sends[1].content).toContain("retry: 1");
    expect(sends[1].content).toContain("error: boom");
    runtime.onAssistantTurnSettled(assistantId, { ok: false, error: "boom" });
    expect(notes[0]).toContain("type: failure");
    expect(sends.some((s) => s.content.includes("message: 二"))).toBe(true);
  });

  it("folds later chats from the same person into one waiting event", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-rt2-"));
    const sessions = createSessionStore({ home });
    const sends: string[] = [];
    const runner = {
      sendMessage: async (_sessionId: string, content: string) => {
        sends.push(content);
        return { accepted: true as const };
      },
      appendSystemNote: async () => {},
    };
    const queue = createAssistantQueue({ home });
    const runtime = createAssistantRuntime({
      home,
      model: "m",
      sessions,
      runner: runner as never,
      queue,
    });
    runtime.start();
    const assistantId = sessions.list().find((s) => s.origin === "assistant")!.id;
    runtime.enqueue({ type: "chat", from: "muse", message: "一" });
    runtime.enqueue({ type: "chat", from: "muse", message: "二" });
    runtime.enqueue({ type: "chat", from: "muse", message: "三" });
    runtime.enqueue({ type: "chat", from: "popo-group", user: "a", groupId: "g1", message: "群1" });
    runtime.enqueue({ type: "chat", from: "popo-group", user: "a", groupId: "g2", message: "群2" });
    expect(sends).toHaveLength(1);
    expect(queue.list().map((item) => item.title)).toEqual([
      "Muse：一",
      "Muse：二 三",
      "POPO 群：群1",
      "POPO 群：群2",
    ]);
    expect(queue.list().map((item) => item.active ?? false)).toEqual([true, false, false, false]);
    runtime.onAssistantTurnSettled(assistantId, { ok: true });
    expect(sends).toHaveLength(2);
    expect(sends[1]).toContain("message: 二\n三");
    expect(sends[1]).toContain("message: 群1");
    expect(sends[1]).toContain("groupId: g1");
    expect(sends[1]).toContain("message: 群2");
    expect(sends[1]).toContain("groupId: g2");
    expect(sends[1].indexOf("message: 二")).toBeLessThan(sends[1].indexOf("message: 群1"));
    expect(sends[1].indexOf("message: 群1")).toBeLessThan(sends[1].indexOf("message: 群2"));
  });

  it("injects every event already waiting, and retries that batch without later arrivals", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-rt3-"));
    const sessions = createSessionStore({ home });
    const sends: Array<{ content: string; images?: Array<{ data: string }> }> = [];
    const notes: string[] = [];
    const runner = {
      sendMessage: async (
        _sessionId: string,
        content: string,
        images?: Array<{ data: string }>,
      ) => {
        sends.push({ content, images });
        return { accepted: true as const };
      },
      appendSystemNote: async (_sessionId: string, content: string) => {
        notes.push(content);
      },
    };
    const queue = createAssistantQueue({ home });
    const runtime = createAssistantRuntime({
      home,
      model: "m",
      sessions,
      runner: runner as never,
      queue,
    });
    runtime.enqueue({
      type: "chat",
      from: "muse",
      message: "一",
      images: [{ data: "aaa", mediaType: "image/png" }],
    });
    runtime.enqueue({ type: "issue", issueId: "i1", title: "登录", workdir: "/repo", summary: "s" });
    runtime.enqueue({
      type: "chat",
      from: "popo",
      user: "a",
      message: "二",
      images: [{ data: "bbb", mediaType: "image/png" }],
    });
    expect(sends).toHaveLength(0);
    runtime.start();
    const assistantId = sessions.list().find((s) => s.origin === "assistant")!.id;
    expect(sends).toHaveLength(1);
    expect(sends[0].content).toContain("message: 一");
    expect(sends[0].content).toContain("type: issue");
    expect(sends[0].content).toContain("message: 二");
    expect(sends[0].content.indexOf("message: 一")).toBeLessThan(sends[0].content.indexOf("type: issue"));
    expect(sends[0].content.indexOf("type: issue")).toBeLessThan(sends[0].content.indexOf("message: 二"));
    expect(sends[0].images?.map((image) => image.data)).toEqual(["aaa", "bbb"]);
    runtime.enqueue({ type: "chat", from: "muse", message: "三" });
    expect(sends).toHaveLength(1);
    expect(queue.list().map((item) => item.title)).toEqual(["Muse：一", "登录", "POPO：二", "Muse：三"]);
    expect(queue.list().map((item) => item.active ?? false)).toEqual([true, true, true, false]);
    runtime.onAssistantTurnSettled(assistantId, { ok: false, error: "boom" });
    expect(sends).toHaveLength(2);
    expect(sends[1].content).toContain("message: 一");
    expect(sends[1].content).toContain("summary: s");
    expect(sends[1].content).toContain("retry: 1");
    expect(sends[1].content).not.toContain("message: 三");
    expect(sends[1].content.split("retry: 1").length - 1).toBe(3);
    runtime.onAssistantTurnSettled(assistantId, { ok: false, error: "boom" });
    expect(notes[0]).toContain("type: failure");
    expect(sends).toHaveLength(3);
    expect(sends[2].content).toContain("message: 三");
    expect(sends[2].content).not.toContain("message: 一");
  });
});
