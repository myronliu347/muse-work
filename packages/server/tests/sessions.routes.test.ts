import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { closeTestApp, listenTestApp } from "./helpers.js";

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

  it("POST /sessions without model uses deepseek-v4-flash not the global active", async () => {
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
    expect(created.model).toBe("deepseek-v4-flash");
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

  it("grouped carries todoGroups (planning + execution sessions) and filters them from recent", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const normal = app.ctx.store.create({
      workdir: "/tmp/n",
      model: "m1",
      title: "普通会话",
    });
    const planning = app.ctx.store.create({
      workdir: "/tmp/t",
      model: "m1",
      title: "设计评审",
    });
    const exec = app.ctx.store.create({
      workdir: "/tmp/t",
      model: "m1",
      title: "写评审文档",
    });

    const todo = app.ctx.todoStore.createTodo({
      title: "设计评审",
      description: "",
      priority: "p1",
      source: "session",
    });
    app.ctx.todoStore.setPlanningSessionId(todo.id, planning.id);
    const task = app.ctx.todoStore.createTask(todo.id, {
      title: "写评审文档",
      workdir: "/tmp/t",
    });
    app.ctx.todoStore.enqueueTask(task.id);
    app.ctx.todoStore.markRunning(task.id, exec.id);

    const grouped = await fetch(`${app.baseUrl}/sessions?grouped=1`).then((r) =>
      r.json(),
    );
    expect(grouped.todoGroups).toHaveLength(1);
    const g = grouped.todoGroups[0];
    expect(g.todoId).toBe(todo.id);
    expect(g.todoTitle).toBe("设计评审");
    expect(g.priority).toBe("p1");
    expect(g.sessions.map((s: { id: string }) => s.id)).toEqual([
      planning.id,
      exec.id,
    ]);
    // 执行会话标题 = task 标题，规划会话标题 = todo 标题（侧栏一眼认出）
    expect(g.sessions.map((s: { title: string }) => s.title)).toEqual([
      "设计评审",
      "写评审文档",
    ]);

    const recentIds = grouped.recent.map((s: { id: string }) => s.id);
    expect(recentIds).toContain(normal.id);
    expect(recentIds).not.toContain(planning.id);
    expect(recentIds).not.toContain(exec.id);
  });

  it("grouped 剔除已完成 todo 的规划会话（不回流 recent/任务分组）", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const normal = app.ctx.store.create({
      workdir: "/tmp/n",
      model: "m1",
      title: "普通会话",
    });
    const planning = app.ctx.store.create({
      workdir: "/tmp/t",
      model: "m1",
      title: "设计评审",
    });

    const todo = app.ctx.todoStore.createTodo({
      title: "设计评审",
      description: "",
      priority: "p1",
      source: "session",
    });
    app.ctx.todoStore.setPlanningSessionId(todo.id, planning.id);
    // todo 全部完成（如最后一个 task 审核通过）
    app.ctx.todoStore.updateTodoStatus(todo.id, "completed");

    const grouped = await fetch(`${app.baseUrl}/sessions?grouped=1`).then((r) =>
      r.json(),
    );
    // 已完成 todo 不再出现在 todoGroups
    expect(grouped.todoGroups).toEqual([]);
    // 其规划会话也不回流 recent（避免左侧任务 section 残留）
    const recentIds = grouped.recent.map((s: { id: string }) => s.id);
    expect(recentIds).toContain(normal.id);
    expect(recentIds).not.toContain(planning.id);
  });

  it("grouped omits todoGroups when the todo has no live sessions", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const todo = app.ctx.todoStore.createTodo({
      title: "无会话 todo",
      description: "",
      priority: "p2",
      source: "manual",
    });
    // 未打开规划会话、无执行会话 → 不出现分组
    const grouped = await fetch(`${app.baseUrl}/sessions?grouped=1`).then((r) =>
      r.json(),
    );
    expect(grouped.todoGroups).toEqual([]);
    expect(grouped.todoGroups).not.toContainEqual(
      expect.objectContaining({ todoId: todo.id }),
    );
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
