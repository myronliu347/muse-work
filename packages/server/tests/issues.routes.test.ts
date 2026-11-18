import { describe, it, expect, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAppContext } from "../src/services/appContext.js";
import { closeTestApp, listenTestApp } from "./helpers.js";

describe("issues HTTP", () => {
  let server: Server | undefined;
  let home: string | undefined;
  afterEach(async () => {
    if (server) await closeTestApp(server, home);
    server = undefined;
    home = undefined;
  });

  it("POST /issues then GET list; cancel hides from list", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const created = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "修登录", type: "bug" }),
    });
    expect(created.status).toBe(201);
    const { issue } = await created.json();
    expect(issue.type).toBe("bug");
    const list = await fetch(`${app.baseUrl}/issues`).then((r) => r.json());
    expect(list.issues.map((i: { id: string }) => i.id)).toContain(issue.id);
    const cancel = await fetch(`${app.baseUrl}/issues/${issue.id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "先不做" }),
    });
    expect(cancel.status).toBe(200);
    const list2 = await fetch(`${app.baseUrl}/issues`).then((r) => r.json());
    expect(list2.issues.map((i: { id: string }) => i.id)).not.toContain(issue.id);
  });

  it("pages the closed archive without pulling full issue bodies", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    for (let index = 0; index < 3; index += 1) {
      const { issue } = await fetch(`${app.baseUrl}/issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: `已完成 ${index}` }),
      }).then((r) => r.json());
      await fetch(`${app.baseUrl}/issues/${issue.id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: `结论 ${index}` }),
      });
    }

    const first = await fetch(`${app.baseUrl}/issues/closed?limit=2`).then((r) =>
      r.json(),
    );
    expect(first.issues).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.total).toBe(3);
    expect(first.issues[0]).toMatchObject({
      status: "completed",
    });
    expect(first.issues[0].closedAt).toEqual(expect.any(Number));
    expect(first.issues[0]).not.toHaveProperty("description");
    expect(first.issues[0]).not.toHaveProperty("sessions");

    const second = await fetch(
      `${app.baseUrl}/issues/closed?limit=2&offset=2`,
    ).then((r) => r.json());
    expect(second.issues).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.total).toBe(3);
  });

  it("POST /issues/:id/summary asks the issue session without a turn", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "生成完成总结" }),
    }).then((r) => r.json());
    await fetch(`${app.baseUrl}/issues/${issue.id}/planning-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/proj", worktreeEnabled: false }),
    });
    const askBtw = vi.fn().mockResolvedValue("把入口和路由都梳理完了。");
    app.ctx.runner.askBtw = askBtw;
    const res = await fetch(`${app.baseUrl}/issues/${issue.id}/summary`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      summary: "把入口和路由都梳理完了。",
    });
    expect(askBtw).toHaveBeenCalledOnce();
    expect(askBtw.mock.calls[0]?.[1]).toContain("生成完成总结");
    expect(askBtw.mock.calls[0]?.[1]).toContain("最终结论");
    expect(askBtw.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);

    const cached = await fetch(`${app.baseUrl}/issues/${issue.id}/summary`, {
      method: "POST",
    });
    await expect(cached.json()).resolves.toEqual({
      summary: "把入口和路由都梳理完了。",
    });
    expect(askBtw).toHaveBeenCalledOnce();
  });

  it("notifies the assistant when an issue is completed directly", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "直接关闭事件" }),
    }).then((r) => r.json());
    const enqueue = vi.spyOn(app.ctx.assistantRuntime, "enqueue");
    const res = await fetch(`${app.baseUrl}/issues/${issue.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "已经做完" }),
    });
    expect(res.status).toBe(200);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "issue-closed",
        issueId: issue.id,
        status: "completed",
      }),
    );
    expect(enqueue.mock.calls[0]?.[0]).not.toHaveProperty("note");
  });

  it("keeps close Markdown in detail but strips it from the timeline summary", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Markdown 结论" }),
    }).then((r) => r.json());
    const note = "# 结论\n\n- **完成**了\n\n| 项 | 结果 |\n| --- | --- |\n| 测试 | 通过 |";
    await fetch(`${app.baseUrl}/issues/${issue.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note }),
    });
    const updates = await fetch(
      `${app.baseUrl}/issues/${issue.id}/updates`,
    ).then((r) => r.json());
    const result = updates.updates.find(
      (update: { kind: string }) => update.kind === "result",
    );
    expect(result.detail).toBe(note);
    expect(result.summary).not.toContain("#");
    expect(result.summary).not.toContain("*");
    expect(result.summary).not.toContain("|");
  });

  it("does not summarize a closed issue", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "已关闭" }),
    }).then((r) => r.json());
    await fetch(`${app.baseUrl}/issues/${issue.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "做完了" }),
    });
    const res = await fetch(`${app.baseUrl}/issues/${issue.id}/summary`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
  });

  it("POST /issues can create with checklist items", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const created = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "工具对比",
        items: [{ content: "对比 Codex" }, { content: "对比 Cursor" }],
      }),
    });
    expect(created.status).toBe(201);
    const { issue } = await created.json();
    expect(issue.status).toBe("pending");
    expect(issue.items.map((i: { content: string }) => i.content)).toEqual([
      "对比 Codex",
      "对比 Cursor",
    ]);
  });

  it("POST planning-session creates one planning session and is idempotent", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "设计评审" }),
    }).then((r) => r.json());
    const res = await fetch(`${app.baseUrl}/issues/${issue.id}/planning-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/proj", worktreeEnabled: false }),
    });
    expect(res.status).toBe(200);
    const first = await res.json();
    const session = app.ctx.store.get(first.sessionId);
    expect(session?.permissionMode).toBe("bypassPermissions");
    expect(session?.agentName).toBe("plan");
    expect(session?.systemPrompt).toContain(`Issue ID：${issue.id}`);
    expect(session?.systemPrompt).toContain("不要修改产品实现");
    expect(app.ctx.issueStore.get(issue.id)?.status).toBe("planning");
    const second = await fetch(`${app.baseUrl}/issues/${issue.id}/planning-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/other", worktreeEnabled: false }),
    }).then((r) => r.json());
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("completing an issue deletes its planning session", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "修登录" }),
    }).then((r) => r.json());
    const { sessionId } = await fetch(
      `${app.baseUrl}/issues/${issue.id}/planning-session`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workdir: "/tmp/proj", worktreeEnabled: false }),
      },
    ).then((r) => r.json());
    expect(app.ctx.store.get(sessionId)).toBeDefined();

    const done = await fetch(`${app.baseUrl}/issues/${issue.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "做完了" }),
    });
    expect(done.status).toBe(200);
    expect(app.ctx.store.get(sessionId)).toBeUndefined();
    const byId = await fetch(`${app.baseUrl}/sessions/${sessionId}`);
    expect(byId.status).toBe(404);
  });

  it("cancelling an issue deletes its planning session", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "先不做" }),
    }).then((r) => r.json());
    const { sessionId } = await fetch(
      `${app.baseUrl}/issues/${issue.id}/planning-session`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workdir: "/tmp/proj", worktreeEnabled: false }),
      },
    ).then((r) => r.json());

    const cancelled = await fetch(`${app.baseUrl}/issues/${issue.id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "先不做" }),
    });
    expect(cancelled.status).toBe(200);
    expect(app.ctx.store.get(sessionId)).toBeUndefined();
  });

  it("POST planning-session agentMode=single uses session agent and single-agent prompt", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "单会话" }),
    }).then((r) => r.json());
    const res = await fetch(`${app.baseUrl}/issues/${issue.id}/planning-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workdir: "/tmp/proj",
        worktreeEnabled: false,
        agentMode: "single",
      }),
    });
    expect(res.status).toBe(200);
    const first = await res.json();
    const session = app.ctx.store.get(first.sessionId);
    expect(session?.permissionMode).toBe("bypassPermissions");
    expect(session?.agentName).toBe("default");
    expect(session?.systemPrompt).toContain("单 agent");
    expect(session?.systemPrompt).toContain("不要 dispatch");
    expect(session?.systemPrompt).not.toContain("不要修改产品实现");
    expect(session?.systemPrompt).toContain("issue.mjs");
    expect(session?.systemPrompt).toContain("complete");
    expect(session?.systemPrompt).toContain("直接在本会话里改代码实现");
    expect(session?.systemPrompt).not.toContain("与用户确认需求后");
    expect(session?.systemPrompt).toContain("ready");
    expect(app.ctx.issueStore.get(issue.id)?.agentMode).toBe("single");
    const ready = await fetch(`${app.baseUrl}/issues/${issue.id}/ready`, { method: "POST" });
    expect(ready.status).toBe(200);
    expect(app.ctx.issueStore.get(issue.id)?.status).toBe("awaiting_close");
    const listed = await fetch(`${app.baseUrl}/issues`).then((r) => r.json());
    expect(listed.issues.map((item: { id: string }) => item.id)).toContain(issue.id);
    const dispatch = await fetch(`${app.baseUrl}/issues/${issue.id}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: "nope" }),
    });
    expect(dispatch.status).toBe(409);
  });

  it("PUT items then POST dispatch returns executionSessionId", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-server-"));
    const ctx = createAppContext({
      home: tmp,
      createAgent: async () => ({
        sendMessage: async () => {},
        dispose: async () => {},
      }),
    });
    const app = await listenTestApp({ home: tmp, ctx });
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "修登录" }),
    }).then((r) => r.json());
    await fetch(`${app.baseUrl}/issues/${issue.id}/planning-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/proj", worktreeEnabled: false }),
    });
    const put = await fetch(`${app.baseUrl}/issues/${issue.id}/items`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ content: "改登录" }] }),
    });
    expect(put.status).toBe(200);
    const { issue: withItems } = await put.json();
    const put2 = await fetch(`${app.baseUrl}/issues/${issue.id}/items`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ content: "补测试" }] }),
    });
    expect(put2.status).toBe(200);
    const { issue: twoItems } = await put2.json();
    expect(twoItems.items.map((i: { content: string }) => i.content)).toEqual([
      "改登录",
      "补测试",
    ]);
    const itemId = twoItems.items[0].id as string;
    const dispatch = await fetch(`${app.baseUrl}/issues/${issue.id}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    expect(dispatch.status).toBe(200);
    const body = await dispatch.json();
    expect(body.executionSessionId).toBeTruthy();
    const drop = await fetch(
      `${app.baseUrl}/issues/${issue.id}/items/${itemId}`,
      { method: "DELETE" },
    );
    expect(drop.status).toBe(200);
    const dropped = await drop.json();
    expect(
      dropped.issue.items.map((i: { content: string }) => i.content),
    ).toEqual(["补测试"]);
  });
});


describe("issue progress routes", () => {
  let server: Server | undefined;
  let home: string | undefined;
  afterEach(async () => {
    if (server) await closeTestApp(server, home);
    server = undefined;
    home = undefined;
  });

  it("records checklist and close results as progress", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "有清单" }),
    }).then((r) => r.json());

    await fetch(`${app.baseUrl}/issues/${issue.id}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ content: "做一半" }] }),
    });

    const history = await fetch(`${app.baseUrl}/issues/${issue.id}/updates`).then(
      (r) => r.json(),
    );
    expect(history.updates[0]).toMatchObject({
      kind: "checklist",
      summary: "清单新增 1 项",
    });

    await fetch(`${app.baseUrl}/issues/${issue.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "做完了" }),
    });

    const afterClose = await fetch(
      `${app.baseUrl}/issues/${issue.id}/updates`,
    ).then((r) => r.json());
    expect(afterClose.updates[0]).toMatchObject({
      kind: "result",
      summary: "已完成：做完了",
      status: "completed",
    });
  });
});
