import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { closeTestApp, listenTestApp } from "./helpers.js";
import { AGENT_SCENARIOS_FILE, AGENTS_FILE } from "../src/services/agentConfig.js";

describe("agents HTTP routes", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  it("GET /agents 返回内置 4 个 agent（含展开）", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/agents`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    const keys = body.agents.map((a: { key: string }) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["default", "plan", "execute", "popo"]));
    const def = body.agents.find((a: { key: string }) => a.key === "default");
    expect(def.name).toBe("Muse");
    expect(def.personality).toBe("professional");
    // 性格显示名由 server PERSONALITIES 导出（单一数据源）
    expect(def.personalityLabel).toBe("专业严谨");
    expect(def.model).toBe("deepseek-v4-flash");
    const popo = body.agents.find((a: { key: string }) => a.key === "popo");
    expect(popo.systemPrompt).toContain("你是 Muse 机器人");
  });

  it("GET /agents/scenarios 返回场景实际 key", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/agents/scenarios`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scenarios).toEqual({
      session: "default",
      popo: "popo",
      "issue-plan": "plan",
      "issue-exec": "execute",
    });
  });

  it("PUT /agents 写盘并返回新值；非法 personality 400", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/agents`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        agents: {
          default: { name: "新默认", personality: "concise" },
          xiaomei: { name: "小美", personality: "warm-patient", model: "mm" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const keys = body.agents.map((a: { key: string }) => a.key);
    expect(keys).toContain("xiaomei");
    expect(keys).toContain("plan");

    // 落盘生效：GET 反映新值
    const after = await fetch(`${app.baseUrl}/agents`).then((r) => r.json());
    const def = after.agents.find((a: { key: string }) => a.key === "default");
    expect(def.name).toBe("新默认");
    expect(def.personality).toBe("concise");
    expect(after.agents.find((a: { key: string }) => a.key === "xiaomei")).toBeTruthy();

    // 非法 personality → 400
    const bad = await fetch(`${app.baseUrl}/agents`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        agents: { default: { name: "x", personality: "not-real" } },
      }),
    });
    expect(bad.status).toBe(400);
  });

  it("PUT /agents/scenarios 写盘并返回；引用不存在 agent 400", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/agents/scenarios`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        scenarios: {
          session: "default",
          popo: "default",
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scenarios.popo).toBe("default");

    // 引用不存在的 agent → 400
    const bad = await fetch(`${app.baseUrl}/agents/scenarios`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        scenarios: { session: "ghost" },
      }),
    });
    expect(bad.status).toBe(400);
  });

  it("启动自动生成 agents.json 与 agent-scenarios.json（默认内置）", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const agentsPath = path.join(getMuseHomeDir(home), AGENTS_FILE);
    const scenPath = path.join(getMuseHomeDir(home), AGENT_SCENARIOS_FILE);
    expect(fs.existsSync(agentsPath)).toBe(true);
    expect(fs.existsSync(scenPath)).toBe(true);
    const agents = JSON.parse(fs.readFileSync(agentsPath, "utf8"));
    expect(Object.keys(agents.agents)).toEqual([
      "default",
      "plan",
      "execute",
      "popo",
    ]);
  });

  it("GET /agents 读时回落：内置空串 systemPrompt → 返回基座；自定义空串 → 返回空", async () => {
    // 预写旧版 agents.json（内置 systemPrompt 空串 + 自定义 agent 空串），
    // 再启动 server（ensureDefaultConfigs 仅在文件缺失时写入，不会覆盖）
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-server-"));
    const agentsPath = path.join(getMuseHomeDir(homeDir), AGENTS_FILE);
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    fs.writeFileSync(
      agentsPath,
      JSON.stringify({
        version: 1,
        agents: {
          default: { name: "Muse", systemPrompt: "" },
          plan: { name: "规划助手", systemPrompt: "" },
          execute: { name: "执行助手", systemPrompt: "" },
          popo: { name: "Muse", systemPrompt: "" },
          xiaomei: { name: "小美", systemPrompt: "" },
        },
      }),
    );

    const app = await listenTestApp({ home: homeDir });
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/agents`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const byKey = Object.fromEntries(
      body.agents.map((a: { key: string }) => [a.key, a]),
    );

    // 内置 key：空串回落基座（default/plan/execute 含 Muse 编码助手基座，popo 含 POPO 指令）
    expect(byKey.default.systemPrompt).toContain(
      "You are Muse, an AI coding assistant",
    );
    expect(byKey.plan.systemPrompt).toContain("You are Muse, an AI coding assistant");
    expect(byKey.execute.systemPrompt).toContain("You are Muse, an AI coding assistant");
    expect(byKey.popo.systemPrompt).toContain("你是 Muse 机器人");
    // 自定义 agent：空串就是空（行为不变）
    expect(byKey.xiaomei.systemPrompt).toBe("");
  });

  it("GET /agents 读时回落：内置填自定义 systemPrompt → 用自定义（不回落）", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-server-"));
    const agentsPath = path.join(getMuseHomeDir(homeDir), AGENTS_FILE);
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    fs.writeFileSync(
      agentsPath,
      JSON.stringify({
        version: 1,
        agents: {
          default: { name: "Muse", systemPrompt: "自定义指令" },
        },
      }),
    );

    const app = await listenTestApp({ home: homeDir });
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/agents`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const def = body.agents.find((a: { key: string }) => a.key === "default");
    expect(def.systemPrompt).toBe("自定义指令");
  });
});
