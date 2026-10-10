/**
 * 内置场景角色（default/plan/execute）+ 用户可配置的「场景默认模型」。
 *
 * 配置文件（`<museHome>/.muse-work/scenario-models.json`）仅保存各场景的 model id；
 * 场景 → 内置角色的映射固定于代码，不再支持自定义 agent / 数字人配置。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { getLogger } from "../utils/logger.js";
import { MUSE_BASE_SYSTEM_PROMPT } from "../constants/musePrompt.js";

export const SCENARIO_MODELS_FILE = "scenario-models.json";

export type AgentScenarioKey =
  | "session"
  | "issue-plan"
  | "issue-exec"
  | "assistant";

export const AGENT_SCENARIO_KEYS: AgentScenarioKey[] = [
  "session",
  "issue-plan",
  "issue-exec",
  "assistant",
];

export type PersonalityKey = string;

/** 展开后的内置角色定义（运行时合成 prompt / 工具权限）。 */
export interface Agent {
  key: string;
  name: string;
  personality: PersonalityKey;
  systemPrompt?: string;
  model?: string;
  fastModel?: string;
  tools?: string[];
  permission?: string[];
}

export type ScenarioModelsFile = {
  version: 1;
  models: Partial<Record<AgentScenarioKey, string>>;
};

export function defaultAgents(): Record<string, Agent> {
  return {
    default: {
      key: "default",
      name: "Muse",
      personality: "professional",
      systemPrompt: MUSE_BASE_SYSTEM_PROMPT,
      model: "deepseek-flash",
    },
    plan: {
      key: "plan",
      name: "规划助手",
      personality: "professional",
      systemPrompt: MUSE_BASE_SYSTEM_PROMPT,
      model: "deepseek-flash",
    },
    execute: {
      key: "execute",
      name: "执行助手",
      personality: "professional",
      systemPrompt: MUSE_BASE_SYSTEM_PROMPT,
      model: "deepseek-flash",
    },
  };
}

/** 固定场景 → 内置角色 key。 */
export function defaultScenarios(): Record<AgentScenarioKey, string> {
  return {
    session: "default",
    "issue-plan": "plan",
    "issue-exec": "execute",
    assistant: "default",
  };
}

export function defaultScenarioModels(): Record<AgentScenarioKey, string> {
  const builtins = defaultAgents();
  const mapping = defaultScenarios();
  const out = {} as Record<AgentScenarioKey, string>;
  for (const key of AGENT_SCENARIO_KEYS) {
    const agentKey = mapping[key];
    out[key] = builtins[agentKey]?.model ?? "deepseek-flash";
  }
  return out;
}

export function scenarioModelsConfigPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), SCENARIO_MODELS_FILE);
}

export function loadAgents(_home = os.homedir()): Map<string, Agent> {
  return new Map(Object.entries(defaultAgents()));
}

export function resolveScenarioAgent(
  scenario: AgentScenarioKey,
  _home = os.homedir(),
): string {
  return defaultScenarios()[scenario];
}

export function resolveAgent(key: string, home = os.homedir()): Agent {
  return loadAgents(home).get(key) ?? loadAgents(home).get("default")!;
}

function parseScenarioModelsFile(home: string): Partial<Record<AgentScenarioKey, string>> {
  const file = scenarioModelsConfigPath(home);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      getLogger().warn("scenario-models.json unreadable, using defaults", {
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const models = (parsed as { models?: unknown }).models;
  if (!models || typeof models !== "object") return {};
  const out: Partial<Record<AgentScenarioKey, string>> = {};
  for (const key of AGENT_SCENARIO_KEYS) {
    const value = (models as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

/** 读盘后的场景默认 model（未配置项回落内置 defaultScenarioModels）。 */
export function loadScenarioModels(
  home = os.homedir(),
): Record<AgentScenarioKey, string> {
  const merged = defaultScenarioModels();
  const fromFile = parseScenarioModelsFile(home);
  for (const key of AGENT_SCENARIO_KEYS) {
    if (fromFile[key]) merged[key] = fromFile[key]!;
  }
  return merged;
}

export function resolveScenarioModel(
  scenario: AgentScenarioKey,
  home = os.homedir(),
): string {
  return loadScenarioModels(home)[scenario];
}

/** 某场景对应的内置角色，model 来自 scenario-models.json。 */
export function resolveAgentForScenario(
  scenario: AgentScenarioKey,
  home = os.homedir(),
): Agent {
  const key = resolveScenarioAgent(scenario, home);
  const agent = { ...resolveAgent(key, home) };
  agent.model = resolveScenarioModel(scenario, home);
  return agent;
}

export function defaultSystemPromptFor(key: string): string | undefined {
  switch (key) {
    case "default":
    case "plan":
    case "execute":
      return MUSE_BASE_SYSTEM_PROMPT;
    default:
      return undefined;
  }
}

export function buildSystemPrompt(
  agent: Agent,
  extra?: string,
  explicitSystemPrompt?: string,
): string {
  if (explicitSystemPrompt !== undefined && explicitSystemPrompt !== "") {
    return explicitSystemPrompt;
  }
  const systemPrompt =
    agent.systemPrompt || defaultSystemPromptFor(agent.key) || "";
  const parts = [systemPrompt, extra].filter(Boolean);
  return parts.join("\n\n");
}

export interface ResolvedPermission {
  disallowedTools: string[];
  allowedTools: string[];
}

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

export function ensureDefaultConfigs(home = os.homedir()): void {
  const homeDir = getMuseHomeDir(home);
  fs.mkdirSync(homeDir, { recursive: true });
  writeIfMissing(scenarioModelsConfigPath(home), {
    version: 1,
    models: defaultScenarioModels(),
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
    getLogger().warn("failed to write scenario models config", {
      file,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function saveScenarioModelsFile(
  payload: { version?: unknown; models: unknown },
  home = os.homedir(),
): Record<AgentScenarioKey, string> {
  const models = payload.models;
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    throw new Error("models must be an object");
  }
  const out: Partial<Record<AgentScenarioKey, string>> = {};
  for (const key of AGENT_SCENARIO_KEYS) {
    const value = (models as Record<string, unknown>)[key];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) {
      throw new Error(`scenario ${key}: model id must be a non-empty string`);
    }
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }
  const resolved = loadScenarioModels(home);
  for (const key of AGENT_SCENARIO_KEYS) {
    if (out[key]) resolved[key] = out[key]!;
  }
  const file = scenarioModelsConfigPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, models: resolved }, null, 2) + "\n",
    { encoding: "utf-8", mode: 0o600 },
  );
  return resolved;
}
