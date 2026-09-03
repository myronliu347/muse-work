import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { closeTestApp, listenTestApp } from "./helpers.js";
import { agentsConfigPath } from "../src/services/agentConfig.js";

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
    expect(grouped.recent.map((s: { id: string }) => s.id)).not.toContain(
      grouped.issueGroups[0].sessions[0].id,
    );
    expect(grouped.recent.map((s: { id: string }) => s.id)).toContain(normal.id);

    await fetch(`${app.baseUrl}/issues/${issue.id}/complete`, {
      method: "POST",
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

describe("sessions agent resolution", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  it("POST /sessions 不传 agent → default agent：model=deepseek-v4-flash + 人格段 + Muse 基座 systemPrompt", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a" }),
    }).then((r) => r.json());
    expect(created.agentName).toBe("default");
    expect(created.model).toBe("deepseek-v4-flash");
    expect(created.systemPrompt).toContain("你是Muse。你的性格：用语规范、逻辑严密、直奔重点，不过度寒暄。");
    // default 内置 systemPrompt = Muse 基座 → 人格合成含基座指令
    expect(created.systemPrompt).toContain("You are Muse, an AI coding assistant");
  });

  it("POST /sessions 传自定义 agents.json 里的 agent → agentName 落库 + 人格段 + 自定义 systemPrompt", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    // 自定义 agents.json 定义 xiaomei
    const agentsPath = agentsConfigPath(home);
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    fs.writeFileSync(
      agentsPath,
      JSON.stringify({
        version: 1,
        agents: {
          xiaomei: {
            name: "小美",
            personality: "warm-patient",
            systemPrompt: "请用中文回复",
          },
        },
      }),
    );

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", agent: "xiaomei" }),
    }).then((r) => r.json());
    expect(created.agentName).toBe("xiaomei");
    expect(created.systemPrompt).toContain("你是小美。你的性格：语气柔和、详细解释、循循善诱。");
    expect(created.systemPrompt).toContain("请用中文回复");
  });

  it("POST /sessions 传 systemPrompt → 完全接管（不拼人格）", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", systemPrompt: "完全接管" }),
    }).then((r) => r.json());
    expect(created.systemPrompt).toBe("完全接管");
    expect(created.systemPrompt).not.toContain("你是Muse");
  });

  it("POST /sessions 传非法 agent key → 忽略，回落 default", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", agent: "ghost" }),
    }).then((r) => r.json());
    expect(created.agentName).toBe("default");
  });

  it("POST /sessions 场景映射：session 默认是 default", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    // session 场景默认映射 default
    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a" }),
    }).then((r) => r.json());
    expect(created.agentName).toBe("default");
  });

  it("PATCH /sessions/:id agent → 更新 agentName 并重算展开字段（systemPrompt/model/fastModel/tools/权限）", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const agentsPath = agentsConfigPath(home);
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    fs.writeFileSync(
      agentsPath,
      JSON.stringify({
        version: 1,
        agents: {
          xiaomei: {
            name: "小美",
            personality: "warm-patient",
            systemPrompt: "请用中文回复",
            model: "m-xiaomei",
            fastModel: "fast-xiaomei",
            permission: ["Bash", "!Read"],
          },
        },
      }),
    );

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a" }),
    }).then((r) => r.json());
    expect(created.agentName).toBe("default");
    // default agent 展开：model=deepseek、无 fastModel/tools/权限
    expect(created.model).toBe("deepseek-v4-flash");
    expect(created.fastModel).toBeUndefined();
    expect(created.tools).toBeUndefined();
    expect(created.disallowedTools).toBeUndefined();

    const patched = await fetch(`${app.baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "xiaomei" }),
    }).then((r) => r.json());
    expect(patched.agentName).toBe("xiaomei");
    // 展开字段按新 agent 重算：systemPrompt = 人格段 + 自定义 systemPrompt
    expect(patched.systemPrompt).toContain("你是小美。你的性格：语气柔和、详细解释、循循善诱。");
    expect(patched.systemPrompt).toContain("请用中文回复");
    // model 回落新 agent.model；fastModel / tools / 权限 随 agent 切换
    expect(patched.model).toBe("m-xiaomei");
    expect(patched.fastModel).toBe("fast-xiaomei");
    expect(patched.disallowedTools).toEqual(["Bash"]);
    expect(patched.allowedTools).toEqual(["Read"]);

    // 非法 agent key → 忽略，保持原 agent
    const ignored = await fetch(`${app.baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "ghost" }),
    }).then((r) => r.json());
    expect(ignored.agentName).toBe("xiaomei");
    expect(ignored.model).toBe("m-xiaomei");
  });

  it("PATCH agent 保留会话显式 model/systemPrompt 覆盖（字段级显式赢）", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const agentsPath = agentsConfigPath(home);
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    fs.writeFileSync(
      agentsPath,
      JSON.stringify({
        version: 1,
        agents: {
          xiaomei: { name: "小美", personality: "warm-patient", model: "m-xiaomei" },
        },
      }),
    );

    // 会话创建时显式 model + systemPrompt
    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workdir: "/tmp/a",
        model: "m-explicit",
        systemPrompt: "完全接管",
      }),
    }).then((r) => r.json());
    expect(created.model).toBe("m-explicit");
    expect(created.systemPrompt).toBe("完全接管");

    // 切换 agent → 显式 model/systemPrompt 保留，不回落新 agent
    const patched = await fetch(`${app.baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "xiaomei" }),
    }).then((r) => r.json());
    expect(patched.agentName).toBe("xiaomei");
    expect(patched.model).toBe("m-explicit"); // 显式 model 保留
    expect(patched.systemPrompt).toBe("完全接管"); // 显式 systemPrompt 保留（不拼人格）
    expect(patched.systemPrompt).not.toContain("你是小美");
  });

  it("PATCH 同次请求带 model + agent → 显式 model 优先于新 agent.model", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const agentsPath = agentsConfigPath(home);
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    fs.writeFileSync(
      agentsPath,
      JSON.stringify({
        version: 1,
        agents: {
          xiaomei: { name: "小美", personality: "warm-patient", model: "m-xiaomei" },
        },
      }),
    );

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a" }),
    }).then((r) => r.json());

    const patched = await fetch(`${app.baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "xiaomei", model: "m-inline" }),
    }).then((r) => r.json());
    expect(patched.agentName).toBe("xiaomei");
    expect(patched.model).toBe("m-inline");

    // 再次切回 default：此时 model 已是显式（m-inline），保留
    const back = await fetch(`${app.baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "default" }),
    }).then((r) => r.json());
    expect(back.agentName).toBe("default");
    expect(back.model).toBe("m-inline");
  });
});
