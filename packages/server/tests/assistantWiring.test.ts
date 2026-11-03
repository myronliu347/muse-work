import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHonoApp } from "../src/app.js";
import { createAssistantMessageLog } from "../src/services/assistant/messages.js";
import { enqueueIssuePermission, enqueueIssueSessionTurn } from "../src/services/assistant/observe.js";
import type { AssistantEvent } from "../src/services/assistant/events.js";
import { createIssueStore } from "../src/services/issueStore.js";
import type { AppContext } from "../src/services/appContext.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

describe("assistant wiring", () => {
  it("appends a muse line, broadcasts, and enqueues a chat event", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-assistant-wire-"));
    homes.push(home);
    const log = createAssistantMessageLog({ home });
    const events: AssistantEvent[] = [];
    const broadcasts: unknown[] = [];
    const ctx = {
      assistantLog: log,
      hub: { broadcastAll: (event: unknown) => broadcasts.push(event) },
      assistantRuntime: { enqueue: (event: AssistantEvent) => events.push(event) },
    } as unknown as AppContext;
    const app = createHonoApp(ctx);

    const empty = await app.request("/assistant/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "  " }),
    });
    expect(empty.status).toBe(400);

    const posted = await app.request("/assistant/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "你好" }),
    });
    expect(posted.status).toBe(200);
    const line = await posted.json();
    expect(line.role).toBe("user");
    expect(line.message).toBe("你好");
    expect(broadcasts).toEqual([{ type: "assistant:chat", line }]);
    expect(events).toEqual([{ type: "chat", from: "muse", message: "你好" }]);

    const listed = await app.request("/assistant/messages");
    expect(listed.status).toBe(200);
    const page = await listed.json();
    expect(page.messages).toEqual([line]);
    expect(page.hasMore).toBe(false);

    const withImage = await app.request("/assistant/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "[@file:src/app.ts] [image1]",
        images: [{ data: "data:image/png;base64,a", mediaType: "image/png" }],
      }),
    });
    expect(withImage.status).toBe(200);
    const imageLine = await withImage.json();
    expect(imageLine.images).toEqual([
      { data: "data:image/png;base64,a", mediaType: "image/png" },
    ]);
    expect(events[1]).toMatchObject({
      type: "chat",
      from: "muse",
      message: "[@file:src/app.ts] [image1]",
      images: [{ data: "data:image/png;base64,a", mediaType: "image/png" }],
    });
  });

  it("clears the visible log and the assistant session", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-assistant-clear-"));
    homes.push(home);
    const log = createAssistantMessageLog({ home });
    log.append("user", "你好");
    const cleared: string[] = [];
    const broadcasts: unknown[] = [];
    const ctx = {
      assistantLog: log,
      store: { list: () => [{ id: "asst", origin: "assistant" }] },
      runner: {
        clear: async (id: string) => {
          cleared.push(id);
          return { ok: true as const };
        },
      },
      hub: { broadcastAll: (event: unknown) => broadcasts.push(event) },
      assistantRuntime: { working: () => false },
    } as unknown as AppContext;
    const app = createHonoApp(ctx);

    const clearedRes = await app.request("/assistant/clear", { method: "POST" });
    expect(clearedRes.status).toBe(200);
    expect(await clearedRes.json()).toEqual({ ok: true });
    expect(cleared).toEqual(["asst"]);
    expect(log.page().messages).toEqual([]);
    expect(broadcasts).toEqual([{ type: "assistant:cleared" }]);
  });

  it("refuses to clear while the assistant is working", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-assistant-clear-busy-"));
    homes.push(home);
    const log = createAssistantMessageLog({ home });
    log.append("user", "你好");
    const ctx = {
      assistantLog: log,
      store: { list: () => [{ id: "asst", origin: "assistant" }] },
      runner: { clear: async () => ({ ok: true as const }) },
      hub: { broadcastAll: () => undefined },
      assistantRuntime: { working: () => true },
    } as unknown as AppContext;
    const app = createHonoApp(ctx);
    const res = await app.request("/assistant/clear", { method: "POST" });
    expect(res.status).toBe(409);
    expect(log.page().messages).toHaveLength(1);
  });

  it("enqueues an issue event when that issue's session settles", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-assistant-issue-"));
    homes.push(home);
    const issues = createIssueStore({ home });
    const issue = issues.create({ title: "修登录" });
    issues.setPlanning(issue.id, {
      planningSessionId: "sess-1",
      workdir: "/tmp/repo",
      worktreeEnabled: false,
    });
    const events: AssistantEvent[] = [];
    await enqueueIssueSessionTurn({
      issues,
      runner: {
        getMessages: async () => [
          {
            role: "user",
            blocks: [{ type: "text", content: "上一轮" }],
          },
          {
            role: "assistant",
            blocks: [{ type: "text", content: "先这样" }],
          },
          {
            role: "user",
            isMeta: true,
            blocks: [{ type: "text", content: "系统提示" }],
          },
          {
            role: "user",
            blocks: [{ type: "text", content: "登录失败" }],
          },
          {
            role: "user",
            blocks: [{ type: "text", content: "还有验证码", source: "hook" }, { type: "text", content: "还有验证码" }],
          },
          {
            role: "assistant",
            blocks: [{ type: "text", content: "已经修好" }],
          },
        ],
      },
      enqueue: (event) => events.push(event),
      assistantSessionId: "assistant",
      sessionId: "sess-1",
    });
    await enqueueIssueSessionTurn({
      issues,
      runner: { getMessages: async () => [] },
      enqueue: (event) => events.push(event),
      assistantSessionId: "assistant",
      sessionId: "assistant",
    });
    issues.setExecutionSessionId(issue.id, "exec-1");
    await enqueueIssueSessionTurn({
      issues,
      runner: {
        getMessages: async () => [
          { role: "assistant", blocks: [{ type: "text", content: "执行完了" }] },
        ],
      },
      enqueue: (event) => events.push(event),
      assistantSessionId: "assistant",
      sessionId: "exec-1",
    });
    expect(events).toEqual([
      {
        type: "issue",
        issueId: issue.id,
        title: "修登录",
        workdir: "/tmp/repo",
        summary: "已经修好",
        request: "登录失败\n\n还有验证码",
        replyPending: true,
      },
    ]);
    expect(issues.get(issue.id)?.replyPending).toBe(true);
  });

  it("keeps the dispatch note on the issue event", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-assistant-note-"));
    homes.push(home);
    const issues = createIssueStore({ home });
    const issue = issues.create({ title: "修登录" });
    issues.setPlanning(issue.id, {
      planningSessionId: "sess-1",
      workdir: "/tmp/repo",
      worktreeEnabled: false,
    });
    issues.setReplyNote(issue.id, "做完发到群里");
    const events: AssistantEvent[] = [];
    await enqueueIssueSessionTurn({
      issues,
      runner: {
        getMessages: async () => [
          { role: "assistant", blocks: [{ type: "text", content: "已经修好" }] },
        ],
      },
      enqueue: (event) => events.push(event),
      sessionId: "sess-1",
    });
    expect(events[0]).toMatchObject({
      replyPending: true,
      replyNote: "做完发到群里",
    });
    expect(issues.get(issue.id)?.replyNote).toBe("做完发到群里");
  });

  it("enqueues a permission event only for an issue session", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-assistant-perm-"));
    homes.push(home);
    const issues = createIssueStore({ home });
    const issue = issues.create({ title: "修登录" });
    issues.setPlanning(issue.id, {
      planningSessionId: "sess-1",
      workdir: "/tmp/repo",
      worktreeEnabled: false,
    });
    const events: AssistantEvent[] = [];
    const enqueue = (event: AssistantEvent) => events.push(event);
    enqueueIssuePermission({
      issues,
      enqueue,
      sessionId: "someone-else",
      permissionId: "p0",
      toolName: "Bash",
      description: "Bash: {}",
    });
    enqueueIssuePermission({
      issues,
      enqueue,
      sessionId: "sess-1",
      permissionId: "p1",
      toolName: "Bash",
      description: "Bash: {\"command\":\"rm -rf /\"}",
    });
    expect(events).toEqual([
      {
        type: "permission",
        permissionId: "p1",
        issueId: issue.id,
        title: "修登录",
        workdir: "/tmp/repo",
        sessionId: "sess-1",
        toolName: "Bash",
        description: "Bash: {\"command\":\"rm -rf /\"}",
      },
    ]);
  });
});
