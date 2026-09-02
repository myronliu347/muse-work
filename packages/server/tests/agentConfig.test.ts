import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMuseHomeDir } from "@muse-work/provider";
import {
  AGENT_SCENARIOS_FILE,
  AGENTS_FILE,
  agentsConfigPath,
  buildSystemPrompt,
  defaultAgents,
  ensureDefaultConfigs,
  loadAgents,
  loadScenarios,
  resolveAgent,
  resolvePermission,
  resolveScenarioAgent,
  saveAgentScenariosFile,
  saveAgentsFile,
} from "../src/services/agentConfig.js";
import { POPO_SYSTEM_PROMPT } from "../src/popo/popoPrompt.js";
import { MUSE_BASE_SYSTEM_PROMPT } from "../src/constants/musePrompt.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-agents-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("agentConfig", () => {
  it("ensureDefaultConfigs 生成 agents.json（含 4 内置）与 agent-scenarios.json（4 场景映射）", () => {
    ensureDefaultConfigs(home);
    const agentsPath = agentsConfigPath(home);
    const scenariosPath = path.join(getMuseHomeDir(home), AGENT_SCENARIOS_FILE);
    expect(fs.existsSync(agentsPath)).toBe(true);
    expect(fs.existsSync(scenariosPath)).toBe(true);

    const agents = JSON.parse(fs.readFileSync(agentsPath, "utf8"));
    expect(agents.version).toBe(1);
    expect(Object.keys(agents.agents)).toEqual([
      "default",
      "plan",
      "execute",
      "popo",
    ]);
    expect(agents.agents.default.name).toBe("Muse");
    expect(agents.agents.plan.name).toBe("规划助手");
    expect(agents.agents.execute.name).toBe("执行助手");

    const scenarios = JSON.parse(fs.readFileSync(scenariosPath, "utf8"));
    expect(scenarios.scenarios).toEqual({
      session: "default",
      popo: "popo",
      "issue-plan": "plan",
      "issue-exec": "execute",
    });
    // 已存在时不覆盖（文件为准）
    fs.writeFileSync(
      agentsPath,
      JSON.stringify({ version: 1, agents: { default: { name: "自定义" } } }),
    );
    ensureDefaultConfigs(home);
    const again = JSON.parse(fs.readFileSync(agentsPath, "utf8"));
    expect(again.agents.default.name).toBe("自定义");
  });

  it("loadAgents 无文件 → 仅内置；同名覆盖内置；非法 personality 回落 professional", () => {
    const loaded = loadAgents(home);
    expect(loaded.get("default")?.name).toBe("Muse");
    expect(loaded.get("popo")?.systemPrompt).toBe(POPO_SYSTEM_PROMPT);
    expect(loaded.size).toBe(4);

    const agentsPath = agentsConfigPath(home);
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    fs.writeFileSync(
      agentsPath,
      JSON.stringify({
        version: 1,
        agents: {
          default: { name: "小美", personality: "warm-patient", model: "m2" },
          xiaomei: { name: "小美二号", personality: "bad-key", model: "m3" },
        },
      }),
    );
    const merged = loadAgents(home);
    expect(merged.get("default")?.name).toBe("小美");
    expect(merged.get("default")?.personality).toBe("warm-patient");
    expect(merged.get("default")?.model).toBe("m2");
    // 非法 personality 回落 professional；自定义 agent 追加
    expect(merged.get("xiaomei")?.personality).toBe("professional");
    expect(merged.size).toBe(5);
    // 未覆盖的内置仍保留
    expect(merged.get("plan")?.name).toBe("规划助手");
  });

  it("loadAgents 文件损坏 → 仅内置，不抛错", () => {
    const agentsPath = agentsConfigPath(home);
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    fs.writeFileSync(agentsPath, "{ not json");
    const loaded = loadAgents(home);
    expect(loaded.get("default")?.name).toBe("Muse");
    expect(loaded.size).toBe(4);
  });

  it("loadScenarios 未列场景回落 default；非法 agent key 忽略", () => {
    ensureDefaultConfigs(home);
    expect(loadScenarios(home)).toEqual({
      session: "default",
      popo: "popo",
      "issue-plan": "plan",
      "issue-exec": "execute",
    });
    fs.writeFileSync(
      path.join(getMuseHomeDir(home), AGENT_SCENARIOS_FILE),
      JSON.stringify({
        version: 1,
        scenarios: { session: "nope", popo: "popo" },
      }),
    );
    expect(resolveScenarioAgent("session", home)).toBe("default");
    expect(resolveScenarioAgent("popo", home)).toBe("popo");
  });

  it("resolveScenarioAgent 未列场景回落 default", () => {
    ensureDefaultConfigs(home);
    expect(resolveScenarioAgent("popo", home)).toBe("popo");
  });

  it("resolveAgent 引用不存在 key 回落内置 default", () => {
    ensureDefaultConfigs(home);
    const agent = resolveAgent("ghost", home);
    expect(agent.key).toBe("default");
    expect(agent.name).toBe("Muse");
    expect(agent.model).toBe("deepseek-v4-flash");
  });

  it("buildSystemPrompt 人格合成：人格段 + agent.systemPrompt + extra", () => {
    const agent = {
      key: "xiaomei",
      name: "小美",
      personality: "warm-patient",
      systemPrompt: "请用中文回复",
    };
    const prompt = buildSystemPrompt(agent, "这是额外上下文");
    expect(prompt).toContain("你是小美。你的性格：语气柔和、详细解释、循循善诱。");
    expect(prompt).toContain("请用中文回复");
    expect(prompt).toContain("这是额外上下文");
  });

  it("buildSystemPrompt 空 systemPrompt（自定义 agent）→ 跳过，只含人格段", () => {
    const agent = {
      key: "xiaomei",
      name: "小美",
      personality: "professional",
      systemPrompt: "",
    };
    const prompt = buildSystemPrompt(agent);
    expect(prompt).toBe("你是小美。你的性格：用语规范、逻辑严密、直奔重点，不过度寒暄。");
  });

  it("buildSystemPrompt 内置 agent 空 systemPrompt → 回落 Muse 基座；popo 回落 POPO 指令", () => {
    // 模拟旧版 agents.json 写盘：内置 key 的 systemPrompt 为空串
    const base = {
      key: "default",
      name: "Muse",
      personality: "professional",
      systemPrompt: "",
    };
    expect(buildSystemPrompt(base)).toBe(
      `你是Muse。你的性格：用语规范、逻辑严密、直奔重点，不过度寒暄。\n\n${MUSE_BASE_SYSTEM_PROMPT}`,
    );
    expect(buildSystemPrompt({ ...base, key: "plan" })).toContain(
      MUSE_BASE_SYSTEM_PROMPT,
    );
    expect(buildSystemPrompt({ ...base, key: "execute" })).toContain(
      MUSE_BASE_SYSTEM_PROMPT,
    );
    const popo = buildSystemPrompt({
      ...base,
      key: "popo",
      name: "Muse",
      systemPrompt: "",
    });
    expect(popo).toContain("你是Muse。你的性格：");
    expect(popo).toContain(POPO_SYSTEM_PROMPT);
  });

  it("buildSystemPrompt 显式 systemPrompt 完全接管（不拼人格）", () => {
    const agent = {
      key: "default",
      name: "Muse",
      personality: "professional",
      systemPrompt: "agent 提示",
    };
    const prompt = buildSystemPrompt(agent, "extra", "完全接管");
    expect(prompt).toBe("完全接管");
    expect(prompt).not.toContain("你是Muse");
    expect(prompt).not.toContain("agent 提示");
  });

  it("resolvePermission 拒绝/豁免拆分：无 ! 前缀 → disallowed；! 开头 → allowed", () => {
    const { disallowedTools, allowedTools } = resolvePermission([
      "Bash",
      "Bash(npm run build)",
      "!Read",
      "!Edit(/src/**)",
      "",
    ]);
    expect(disallowedTools).toEqual(["Bash", "Bash(npm run build)"]);
    expect(allowedTools).toEqual(["Read", "Edit(/src/**)"]);
    expect(resolvePermission(undefined)).toEqual({
      disallowedTools: [],
      allowedTools: [],
    });
  });

  it("saveAgentsFile 整份写盘：校验 key/name 非空、personality 合法，非法 400 语义（抛错）", () => {
    const agents = saveAgentsFile(
      {
        version: 1,
        agents: {
          default: { name: "新默认", personality: "concise" },
          xiaomei: { name: "小美", personality: "warm-patient", model: "mm" },
        },
      },
      home,
    );
    expect(agents.map((a) => a.key)).toEqual(expect.arrayContaining(["default", "xiaomei", "plan", "execute", "popo"]));
    const onDisk = JSON.parse(fs.readFileSync(agentsConfigPath(home), "utf8"));
    expect(onDisk.agents.default.name).toBe("新默认");

    // 非法 personality → 抛错
    expect(() =>
      saveAgentsFile(
        { version: 1, agents: { default: { name: "x", personality: "not-real" } } },
        home,
      ),
    ).toThrow(/personality/);
    // 空 name → 抛错
    expect(() =>
      saveAgentsFile(
        { version: 1, agents: { default: { name: "" } } },
        home,
      ),
    ).toThrow(/name/);
  });

  it("saveAgentScenariosFile 校验 agent key 存在，未列场景回落 default；返回已回落映射", () => {
    const resolved = saveAgentScenariosFile(
      {
        version: 1,
        scenarios: {
          session: "default",
          popo: "popo",
        },
      },
      home,
    );
    expect(resolved).toEqual({
      session: "default",
      popo: "popo",
      "issue-plan": "plan",
      "issue-exec": "execute",
    });
    // 引用不存在的 key → 抛错
    expect(() =>
      saveAgentScenariosFile(
        { version: 1, scenarios: { session: "ghost" } },
        home,
      ),
    ).toThrow(/unknown agent key/);
  });

  it("defaultAgents 4 内置的 systemPrompt：default/plan/execute 为 Muse 基座，popo 为 POPO 指令", () => {
    const agents = defaultAgents();
    expect(agents.default.systemPrompt).toBe(MUSE_BASE_SYSTEM_PROMPT);
    expect(agents.plan.systemPrompt).toBe(MUSE_BASE_SYSTEM_PROMPT);
    expect(agents.execute.systemPrompt).toBe(MUSE_BASE_SYSTEM_PROMPT);
    expect(agents.popo.systemPrompt).toBe(POPO_SYSTEM_PROMPT);
  });

  it("loadAgents 读时回落：内置 key 文件 systemPrompt 空串 → 回落基座（与运行一致）", () => {
    // 模拟旧版 agents.json 写盘：内置 key 的 systemPrompt 为空串
    const agentsPath = agentsConfigPath(home);
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
        },
      }),
    );
    const loaded = loadAgents(home);
    expect(loaded.get("default")?.systemPrompt).toBe(MUSE_BASE_SYSTEM_PROMPT);
    expect(loaded.get("plan")?.systemPrompt).toBe(MUSE_BASE_SYSTEM_PROMPT);
    expect(loaded.get("execute")?.systemPrompt).toBe(MUSE_BASE_SYSTEM_PROMPT);
    expect(loaded.get("popo")?.systemPrompt).toBe(POPO_SYSTEM_PROMPT);
    // GET /agents 语义（toAgentDto: systemPrompt ?? ""）：读时回落后返回基座
    expect(loaded.get("default")?.systemPrompt ?? "").toContain(
      "You are Muse, an AI coding assistant",
    );
  });

  it("loadAgents 读时回落：内置 key 填了自定义 systemPrompt → 用自定义（不回落）", () => {
    const agentsPath = agentsConfigPath(home);
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
    const loaded = loadAgents(home);
    expect(loaded.get("default")?.systemPrompt).toBe("自定义指令");
  });

  it("loadAgents 读时回落：自定义 agent 空串 → 保持空（getAgents 返回 \"\"）", () => {
    const agentsPath = agentsConfigPath(home);
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    fs.writeFileSync(
      agentsPath,
      JSON.stringify({
        version: 1,
        agents: {
          xiaomei: { name: "小美", systemPrompt: "" },
        },
      }),
    );
    const loaded = loadAgents(home);
    // 自定义 agent 没填就是没有：GET /agents 语义返回 ""
    expect(loaded.get("xiaomei")?.systemPrompt ?? "").toBe("");
  });
});
