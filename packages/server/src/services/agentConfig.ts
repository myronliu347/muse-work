/**
 * agent（数字人）预设配置体系。
 *
 * 两份配置文件（均位于 `<museHome>/.muse-work/`）：
 * - `agents.json`：命名 agent 定义。内置 default/plan/execute/popo 四个，
 *   文件里同名 key 覆盖内置；未出现的 key 只读内置。文件缺失/损坏 → 仅内置。
 * - `agent-scenarios.json`：场景 → agent key 映射。场景 key：
 *   session/todo/task/popo，未列出的场景一律回落 default。
 *
 * 读取容错风格参考 museSettings.ts：try/catch + getLogger().warn。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { getLogger } from "../utils/logger.js";
import { POPO_SYSTEM_PROMPT } from "../popo/popoPrompt.js";

export const AGENTS_FILE = "agents.json";
export const AGENT_SCENARIOS_FILE = "agent-scenarios.json";

/** 场景 key（agent-scenarios.json 的键）。 */
export type AgentScenarioKey = "session" | "todo" | "task" | "popo";

export const AGENT_SCENARIO_KEYS: AgentScenarioKey[] = [
  "session",
  "todo",
  "task",
  "popo",
];

/** 性格 key（内置 10 选一；非法 key 回落 professional）。 */
export type PersonalityKey = string;

/** 性格常量表：key → 显示名 → 语气描述（供人格合成与 UI 列表复用）。 */
export const PERSONALITIES: Array<{
  key: PersonalityKey;
  label: string;
  description: string;
}> = [
  { key: "professional", label: "专业严谨", description: "用语规范、逻辑严密、直奔重点，不过度寒暄" },
  { key: "warm-patient", label: "温和耐心", description: "语气柔和、详细解释、循循善诱" },
  { key: "lively", label: "活泼热情", description: "轻快积极、爱用语气词、乐于鼓励" },
  { key: "humorous", label: "幽默风趣", description: "轻松搞笑、偶尔调侃、活跃气氛" },
  { key: "concise", label: "简洁干练", description: "惜字如金、只给结论、不绕弯" },
  { key: "rational", label: "理性冷静", description: "客观中立、克制情绪、就事论事" },
  { key: "energetic", label: "元气满满", description: "精力充沛、热血鼓励、行动力强" },
  { key: "wise-terse", label: "高冷睿智", description: "话少但精、一针见血、气场沉稳" },
  { key: "scholarly", label: "学术严谨", description: "引经据典、结构严谨、深入全面" },
  { key: "friendly", label: "亲切贴心", description: "像朋友、考虑感受、细致周到" },
];

const PERSONALITY_KEYS = new Set(PERSONALITIES.map((p) => p.key));

export function isValidPersonality(key: unknown): key is PersonalityKey {
  return typeof key === "string" && PERSONALITY_KEYS.has(key);
}

/** 非法/缺省性格回落 professional。 */
export function normalizePersonality(key: unknown): PersonalityKey {
  return isValidPersonality(key) ? key : "professional";
}

/** 性格显示名（UI 列表用）。 */
export function personalityLabel(key: PersonalityKey): string {
  return PERSONALITIES.find((p) => p.key === key)?.label ?? key;
}

/** 性格语气描述（人格合成用）。 */
export function personalityDescription(key: PersonalityKey): string {
  return PERSONALITIES.find((p) => p.key === key)?.description ?? "";
}

/** 展开后的 agent 定义（含内置回落，均为有效值）。 */
export interface Agent {
  key: string;
  name: string;
  personality: PersonalityKey;
  systemPrompt?: string;
  model?: string;
  fastModel?: string;
  /** 允许工具列表（不设=全部）。 */
  tools?: string[];
  /** 权限规则：无 `!` 前缀 → 拒绝；`!` 开头 → 豁免。 */
  permission?: string[];
}

export type AgentsFile = {
  version: 1;
  agents: Record<string, Partial<Agent>>;
};

export type AgentScenariosFile = {
  version: 1;
  scenarios: Partial<Record<AgentScenarioKey, string>>;
};

/** 内置默认 agent（default/plan/execute 的 systemPrompt 留空：静态部分内置在代码、动态部分运行时合并）。 */
export function defaultAgents(): Record<string, Agent> {
  return {
    default: {
      key: "default",
      name: "Muse",
      personality: "professional",
      systemPrompt: "",
      model: "deepseek-v4-flash",
    },
    plan: {
      key: "plan",
      name: "规划助手",
      personality: "professional",
      systemPrompt: "",
      model: "deepseek-v4-flash",
    },
    execute: {
      key: "execute",
      name: "执行助手",
      personality: "professional",
      systemPrompt: "",
      model: "deepseek-v4-flash",
    },
    popo: {
      key: "popo",
      name: "Muse",
      personality: "professional",
      systemPrompt: POPO_SYSTEM_PROMPT,
      model: "deepseek-v4-flash",
    },
  };
}

/** 内置默认场景映射。 */
export function defaultScenarios(): Record<AgentScenarioKey, string> {
  return { session: "default", todo: "plan", task: "execute", popo: "popo" };
}

export function agentsConfigPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), AGENTS_FILE);
}

export function agentScenariosConfigPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), AGENT_SCENARIOS_FILE);
}

/** 合法 agent key（内置 + 文件定义）集合，供场景映射校验。 */
function knownAgentKeys(home: string): Set<string> {
  return new Set([...loadAgents(home).keys()]);
}

/** 解析文件里单个 agent 定义（宽松：非法字段忽略/回落，不抛错）。 */
function parseAgent(key: string, raw: unknown): Agent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : undefined;
  if (!name) return undefined; // 无有效 name 视作非法，不合并
  const agent: Agent = {
    key,
    name,
    personality: normalizePersonality(rec.personality),
  };
  if (typeof rec.systemPrompt === "string") agent.systemPrompt = rec.systemPrompt;
  if (typeof rec.model === "string" && rec.model) agent.model = rec.model;
  if (typeof rec.fastModel === "string" && rec.fastModel) {
    agent.fastModel = rec.fastModel;
  }
  if (Array.isArray(rec.tools)) {
    const tools = rec.tools.filter((t): t is string => typeof t === "string" && t.length > 0);
    if (tools.length > 0) agent.tools = tools;
  }
  if (Array.isArray(rec.permission)) {
    const permission = rec.permission.filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (permission.length > 0) agent.permission = permission;
  }
  return agent;
}

function parseAgentsFile(home: string): Record<string, Agent> {
  const builtins = defaultAgents();
  const file = agentsConfigPath(home);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      getLogger().warn("agents.json unreadable, using builtins", {
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return builtins;
  }
  if (!parsed || typeof parsed !== "object") {
    getLogger().warn("agents.json invalid shape, using builtins", { file });
    return builtins;
  }
  const agents = (parsed as { agents?: unknown }).agents;
  if (!agents || typeof agents !== "object") return builtins;
  const out: Record<string, Agent> = { ...builtins };
  for (const [key, raw] of Object.entries(agents as Record<string, unknown>)) {
    if (!key) continue;
    const agent = parseAgent(key, raw);
    if (agent) out[key] = agent; // 同名覆盖内置；非法定义不合并（沿用内置/已有）
  }
  return out;
}

/** 合并解析后的 agent（内置为底，文件覆盖同名），返回 Map<key, Agent>。 */
export function loadAgents(home = os.homedir()): Map<string, Agent> {
  const agents = parseAgentsFile(home);
  return new Map(Object.entries(agents));
}

function parseScenariosFile(home: string): Partial<Record<AgentScenarioKey, string>> {
  const file = agentScenariosConfigPath(home);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    // 文件缺失/损坏 → 内置默认映射（不写配置文件时各场景行为与现状一致：
    // session=default / todo=plan / task=execute / popo=popo）
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      getLogger().warn("agent-scenarios.json unreadable, using defaults", {
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return defaultScenarios();
  }
  if (!parsed || typeof parsed !== "object") return defaultScenarios();
  const scenarios = (parsed as { scenarios?: unknown }).scenarios;
  if (!scenarios || typeof scenarios !== "object") return defaultScenarios();
  const known = knownAgentKeys(home);
  const out: Partial<Record<AgentScenarioKey, string>> = {};
  for (const key of AGENT_SCENARIO_KEYS) {
    const value = (scenarios as Record<string, unknown>)[key];
    if (typeof value === "string" && value && known.has(value)) {
      out[key] = value; // 引用不存在的 key 忽略（回落 default）
    }
  }
  return out;
}

/** 场景 → agent key（未列出的场景默认 "default"）。 */
export function loadScenarios(home = os.homedir()): Partial<Record<AgentScenarioKey, string>> {
  return parseScenariosFile(home);
}

/** 返回该场景的 agent key（含回落：文件映射 → 内置默认映射）。 */
export function resolveScenarioAgent(
  scenario: AgentScenarioKey,
  home = os.homedir(),
): string {
  return loadScenarios(home)[scenario] ?? defaultScenarios()[scenario];
}

/** 返回展开后的 agent（含内置回落）。 */
export function resolveAgent(
  key: string,
  home = os.homedir(),
): Agent {
  return loadAgents(home).get(key) ?? loadAgents(home).get("default")!;
}

/**
 * 人格合成：最终 systemPrompt = 人格段 + agent.systemPrompt + 场景动态上下文。
 * 例外：显式 systemPrompt 完全接管（不拼人格、不拼 agent.systemPrompt）。
 */
export function buildSystemPrompt(
  agent: Agent,
  extra?: string,
  explicitSystemPrompt?: string,
): string {
  if (explicitSystemPrompt !== undefined && explicitSystemPrompt !== "") {
    return explicitSystemPrompt;
  }
  const lines = [`你是${agent.name}。你的性格：${personalityDescription(agent.personality)}。`];
  if (agent.systemPrompt) lines.push(agent.systemPrompt);
  if (extra) lines.push(extra);
  return lines.join("\n\n");
}

export interface ResolvedPermission {
  disallowedTools: string[];
  allowedTools: string[];
}

/** 解析 permission 数组：无 `!` 前缀 → disallowedTools；`!` 开头去掉 `!` → allowedTools。 */
export function resolvePermission(permission: string[] | undefined): ResolvedPermission {
  const disallowedTools: string[] = [];
  const allowedTools: string[] = [];
  for (const rule of permission ?? []) {
    const trimmed = rule.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("!")) {
      const allow = trimmed.slice(1).trim();
      if (allow) allowedTools.push(allow);
    } else {
      disallowedTools.push(trimmed);
    }
  }
  return { disallowedTools, allowedTools };
}

/** 启动时若无 agents.json / agent-scenarios.json 则生成内置默认写盘。 */
export function ensureDefaultConfigs(home = os.homedir()): void {
  const homeDir = getMuseHomeDir(home);
  fs.mkdirSync(homeDir, { recursive: true });
  writeIfMissing(agentsConfigPath(home), {
    version: 1,
    agents: defaultAgents(),
  });
  writeIfMissing(agentScenariosConfigPath(home), {
    version: 1,
    scenarios: defaultScenarios(),
  });
}

function writeIfMissing(file: string, data: unknown): void {
  if (fs.existsSync(file)) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch (err) {
    getLogger().warn("failed to write agent config", {
      file,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 校验并整份写盘 agents.json；返回写盘后的完整展开列表（含内置）。 */
export function saveAgentsFile(
  payload: { version?: unknown; agents: unknown },
  home = os.homedir(),
): Agent[] {
  const agents = payload.agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    throw new Error("agents must be an object keyed by agent name");
  }
  const entries = Object.entries(agents as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error("agents must not be empty");
  }
  const parsed: Record<string, Agent> = {};
  for (const [key, raw] of entries) {
    if (!key.trim()) throw new Error("agent key must not be empty");
    const agent = parseAgent(key, raw);
    if (!agent) {
      throw new Error(`agent ${key}: name is required`);
    }
    // personality 非法（非 10 选一）→ 400
    const rec = raw as Record<string, unknown>;
    if (rec.personality !== undefined && !isValidPersonality(rec.personality)) {
      throw new Error(
        `agent ${key}: invalid personality "${String(rec.personality)}"`,
      );
    }
    parsed[key] = agent;
  }
  const file = agentsConfigPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ version: 1, agents: parsed }, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  return [...loadAgents(home).values()];
}

/** 校验并整份写盘 agent-scenarios.json；返回写盘后的完整映射（含回落）。 */
export function saveAgentScenariosFile(
  payload: { version?: unknown; scenarios: unknown },
  home = os.homedir(),
): Record<AgentScenarioKey, string> {
  const scenarios = payload.scenarios;
  if (!scenarios || typeof scenarios !== "object" || Array.isArray(scenarios)) {
    throw new Error("scenarios must be an object");
  }
  const known = knownAgentKeys(home);
  const out: Partial<Record<AgentScenarioKey, string>> = {};
  for (const key of AGENT_SCENARIO_KEYS) {
    const value = (scenarios as Record<string, unknown>)[key];
    if (value !== undefined && (typeof value !== "string" || !value)) {
      throw new Error(`scenario ${key}: agent key must be a non-empty string`);
    }
    if (value && !known.has(value)) {
      throw new Error(`scenario ${key}: unknown agent key "${value}"`);
    }
    if (value) out[key] = value;
  }
  const file = agentScenariosConfigPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, scenarios: out }, null, 2) + "\n",
    { encoding: "utf-8", mode: 0o600 },
  );
  // 读回时做回落（未列场景 → default）
  const resolved = defaultScenarios();
  for (const [k, v] of Object.entries(out) as Array<[AgentScenarioKey, string]>) {
    resolved[k] = v;
  }
  return resolved;
}
