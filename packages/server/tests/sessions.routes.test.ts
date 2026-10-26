import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { closeTestApp, listenTestApp } from "./helpers.js";
import { scenarioModelsConfigPath } from "../src/services/agentConfig.js";

describe("sessions HTTP routes", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  it("POST create, PATCH pin, POST select, GET grouped", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", model: "m1" }),
    }).then((r) => r.json());
    expect(created.model).toBe("m1");

    await fetch(`${app.baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: true, title: "t1" }),
    });

    await fetch(`${app.baseUrl}/sessions/${created.id}/select`, { method: "POST" });

    const grouped = await fetch(`${app.baseUrl}/sessions?grouped=1`).then((r) =>
      r.json(),
    );
    expect(grouped.activeSessionId).toBe(created.id);
    expect(grouped.pinned[0].title).toBe("t1");
    expect(grouped.recent).toEqual([]);
  });

  it("GET /sessions omits automation origin while GET by id returns it", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const hidden = app.ctx.store.create({
      workdir: app.home,
      model: "m1",
      origin: "automation",
      title: "自动化 · 巡检",
    });
    const user = app.ctx.store.create({
      workdir: app.home,
      model: "m1",
      title: "日常",
    });

    const listed = await fetch(`${app.baseUrl}/sessions`).then((r) => r.json());
    expect(listed.sessions.map((s: { id: string }) => s.id)).toEqual([user.id]);

    const byId = await fetch(`${app.baseUrl}/sessions/${hidden.id}`).then((r) =>
      r.json(),
    );
    expect(byId.id).toBe(hidden.id);
    expect(byId.origin).toBe("automation");
  });

  it("grouped exposes issueGroups and strips those sessions from recent", async () => {
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

    // Normal session that appears in recent (title ≠ 新对话 → isStartedSession).
    const normal = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", model: "m1" }),
    }).then((r) => r.json());
    await fetch(`${app.baseUrl}/sessions/${normal.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "普通会话" }),
    });

    const grouped = await fetch(`${app.baseUrl}/sessions?grouped=1`).then((r) =>
      r.json(),
    );
    expect(grouped.issueGroups).toHaveLength(1);
    expect(grouped.issueGroups[0]).toMatchObject({
      issueId: issue.id,
      title: "修登录",
      status: "planning",
      description: "",
    });
    expect(grouped.issueGroups[0].sessions).toHaveLength(1);
    expect(grouped.issueGroups[0].sessions[0].id).toBe(sessionId);
    expect(grouped.issueGroups[0].planningSessionId).toBe(sessionId);
    expect(grouped.issueGroups[0].agentMode).toBe("split");
    expect(grouped.recent.map((s: { id: string }) => s.id)).not.toContain(
      grouped.issueGroups[0].sessions[0].id,
    );
    expect(grouped.recent.map((s: { id: string }) => s.id)).toContain(normal.id);

    await fetch(`${app.baseUrl}/issues/${issue.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "做完了" }),
    });
    const afterClose = await fetch(`${app.baseUrl}/sessions?grouped=1`).then(
      (r) => r.json(),
    );
    expect(afterClose.issueGroups).toEqual([]);
    expect(afterClose.closedIssueGroups).toHaveLength(1);
    expect(afterClose.closedIssueGroups[0]).toMatchObject({
      issueId: issue.id,
      status: "completed",
    });
    expect(afterClose.closedIssueGroups[0].sessions[0].id).toBe(sessionId);
    expect(afterClose.recent.map((s: { id: string }) => s.id)).not.toContain(
      sessionId,
    );
    expect(afterClose.recent.map((s: { id: string }) => s.id)).toContain(
      normal.id,
    );
  });

  it("grouped includes pending issues with empty sessions", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "待规划" }),
    }).then((r) => r.json());

    const grouped = await fetch(`${app.baseUrl}/sessions?grouped=1`).then((r) =>
      r.json(),
    );
    expect(grouped.issueGroups).toEqual([
      expect.objectContaining({
        issueId: issue.id,
        title: "待规划",
        status: "pending",
        sessions: [],
      }),
    ]);
  });

  it("two sessions keep independent models after PATCH", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const a = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", model: "m1" }),
    }).then((r) => r.json());
    const b = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/b", model: "m2" }),
    }).then((r) => r.json());

    expect(a.model).toBe("m1");
    expect(b.model).toBe("m2");

    await fetch(`${app.baseUrl}/sessions/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m1-updated" }),
    });

    const aGet = await fetch(`${app.baseUrl}/sessions/${a.id}`).then((r) =>
      r.json(),
    );
    const bGet = await fetch(`${app.baseUrl}/sessions/${b.id}`).then((r) =>
      r.json(),
    );
    expect(aGet.model).toBe("m1-updated");
    expect(bGet.model).toBe("m2");
  });

  it("POST /sessions without model uses deepseek-flash not the global active", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    await fetch(`${app.baseUrl}/providers/active`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "codemaker",
        modelId: "claude-opus-4-6",
      }),
    });

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a" }),
    }).then((r) => r.json());
    expect(created.model).toBe("deepseek-flash");
  });

  it("POST /sessions honors permissionMode", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workdir: "/tmp/a",
        model: "m1",
        permissionMode: "bypassPermissions",
      }),
    }).then((r) => r.json());
    expect(created.permissionMode).toBe("bypassPermissions");

    const loaded = await fetch(`${app.baseUrl}/sessions/${created.id}`).then(
      (r) => r.json(),
    );
    expect(loaded.permissionMode).toBe("bypassPermissions");
  });

  it("rejects user messages once the issue is closed", async () => {
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
    const execution = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/proj", model: "m1" }),
    }).then((r) => r.json());
    app.ctx.issueStore.setExecutionSessionId(issue.id, execution.id);

    const openSend = await fetch(`${app.baseUrl}/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "还在做" }),
    });
    expect(openSend.status).toBe(200);

    await fetch(`${app.baseUrl}/issues/${issue.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "做完了" }),
    });

    const planningSend = await fetch(
      `${app.baseUrl}/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "再改一下" }),
      },
    );
    expect(planningSend.status).toBe(409);
    expect(await planningSend.json()).toEqual({ error: "issue is closed" });

    const executionSend = await fetch(
      `${app.baseUrl}/sessions/${execution.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "执行会话也别收" }),
      },
    );
    expect(executionSend.status).toBe(409);

    const { issue: cancelled } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "先不做" }),
    }).then((r) => r.json());
    const opened = await fetch(
      `${app.baseUrl}/issues/${cancelled.id}/planning-session`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workdir: "/tmp/proj", worktreeEnabled: false }),
      },
    ).then((r) => r.json());
    await fetch(`${app.baseUrl}/issues/${cancelled.id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "不做了" }),
    });
    const cancelSend = await fetch(
      `${app.baseUrl}/sessions/${opened.sessionId}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "取消后还想说" }),
      },
    );
    expect(cancelSend.status).toBe(409);

    const injected = await fetch(
      `${app.baseUrl}/sessions/${opened.sessionId}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "来源：执行会话\n结束",
          source: "system-inject",
        }),
      },
    );
    expect(injected.status).toBe(200);
  });

  it("POST /sessions/:id/abort returns ok", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", model: "m1" }),
    }).then((r) => r.json());

    const res = await fetch(`${app.baseUrl}/sessions/${created.id}/abort`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("DELETE /sessions/:id/queued-messages/:messageId returns ok (no agent yet)", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", model: "m1" }),
    }).then((r) => r.json());

    const res = await fetch(
      `${app.baseUrl}/sessions/${created.id}/queued-messages/mq-1`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });

    const missing = await fetch(
      `${app.baseUrl}/sessions/does-not-exist/queued-messages/mq-1`,
      { method: "DELETE" },
    );
    expect(missing.status).toBe(404);
  });

  it("GET /sessions/:id/runtime returns loading and queuedMessages", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", model: "m1" }),
    }).then((r) => r.json());

    const res = await fetch(`${app.baseUrl}/sessions/${created.id}/runtime`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ loading: false, queuedMessages: [] });
  });

  it("PATCH /sessions/:id/queued-messages/:messageId returns ok", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", model: "m1" }),
    }).then((r) => r.json());

    const res = await fetch(
      `${app.baseUrl}/sessions/${created.id}/queued-messages/mq-1`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "updated" }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });

    const missing = await fetch(
      `${app.baseUrl}/sessions/does-not-exist/queued-messages/mq-1`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "updated" }),
      },
    );
    expect(missing.status).toBe(404);
  });
});

describe("sessions scenario defaults", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  it("POST /sessions 使用 session 场景默认 model 与内置 systemPrompt", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a" }),
    }).then((r) => r.json());
    expect(created.agentName).toBe("default");
    expect(created.model).toBe("deepseek-flash");
    expect(created.systemPrompt).toContain("You are Muse, an AI coding assistant");
    expect(created.systemPrompt).not.toContain("你的性格");
  });

  it("POST /sessions 传 systemPrompt → 完全接管", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", systemPrompt: "完全接管" }),
    }).then((r) => r.json());
    expect(created.systemPrompt).toBe("完全接管");
  });

  it("scenario-models.json 覆盖普通会话默认 model", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const modelsPath = scenarioModelsConfigPath(home);
    fs.mkdirSync(path.dirname(modelsPath), { recursive: true });
    fs.writeFileSync(
      modelsPath,
      JSON.stringify({
        version: 1,
        models: {
          session: "m-from-scenario",
          popo: "deepseek-flash",
          "issue-plan": "deepseek-flash",
          "issue-exec": "deepseek-flash",
        },
      }),
    );

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a" }),
    }).then((r) => r.json());
    expect(created.model).toBe("m-from-scenario");
  });
});
