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
    runtime.onAssistantTurnSettled(assistantId, { ok: true });
    expect(sends[1]).toContain("message: 二\n三");
  });
});
