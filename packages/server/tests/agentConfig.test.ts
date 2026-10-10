import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMuseHomeDir } from "@muse-work/provider";
import {
  SCENARIO_MODELS_FILE,
  buildSystemPrompt,
  defaultScenarioModels,
  ensureDefaultConfigs,
  loadAgents,
  loadScenarioModels,
  resolveAgent,
  resolveAgentForScenario,
  resolveScenarioAgent,
  saveScenarioModelsFile,
  scenarioModelsConfigPath,
} from "../src/services/agentConfig.js";
import { MUSE_BASE_SYSTEM_PROMPT } from "../src/constants/musePrompt.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-agents-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("agentConfig", () => {
  it("ensureDefaultConfigs 生成 scenario-models.json", () => {
    ensureDefaultConfigs(home);
    const modelsPath = scenarioModelsConfigPath(home);
    expect(fs.existsSync(modelsPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
    expect(parsed.models).toEqual(defaultScenarioModels());
  });

  it("loadAgents 仅返回 3 个内置角色", () => {
    const loaded = loadAgents(home);
    expect(loaded.size).toBe(3);
    expect(loaded.get("default")?.name).toBe("Muse");
  });

  it("resolveScenarioAgent 固定映射", () => {
    expect(resolveScenarioAgent("session", home)).toBe("default");
    expect(resolveScenarioAgent("issue-plan", home)).toBe("plan");
    expect(resolveScenarioAgent("assistant", home)).toBe("default");
  });

  it("resolveAgentForScenario 应用 scenario-models 覆盖 model", () => {
    ensureDefaultConfigs(home);
    saveScenarioModelsFile(
      { version: 1, models: { session: "custom-model" } },
      home,
    );
    const agent = resolveAgentForScenario("session", home);
    expect(agent.key).toBe("default");
    expect(agent.model).toBe("custom-model");
  });

  it("buildSystemPrompt 仅拼接 systemPrompt 与 extra", () => {
    const agent = {
      key: "default",
      name: "Muse",
      personality: "professional",
      systemPrompt: "",
    };
    expect(buildSystemPrompt(agent)).toBe(MUSE_BASE_SYSTEM_PROMPT);
    expect(buildSystemPrompt(agent, "extra")).toContain("extra");
  });

  it("loadScenarioModels 文件损坏时回落内置默认", () => {
    const file = path.join(getMuseHomeDir(home), SCENARIO_MODELS_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{");
    expect(loadScenarioModels(home).session).toBe(
      defaultScenarioModels().session,
    );
  });

  it("resolveAgent 未知 key 回落 default", () => {
    const agent = resolveAgent("ghost", home);
    expect(agent.key).toBe("default");
  });
});
