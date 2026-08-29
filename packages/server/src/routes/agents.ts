import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import {
  AGENT_SCENARIO_KEYS,
  loadAgents,
  resolveScenarioAgent,
  saveAgentScenariosFile,
  saveAgentsFile,
  type Agent,
} from "../services/agentConfig.js";

export const agentsRoutes = new Hono<HonoEnv>();

function toAgentDto(agent: Agent) {
  return {
    key: agent.key,
    name: agent.name,
    personality: agent.personality,
    systemPrompt: agent.systemPrompt ?? "",
    model: agent.model ?? "",
    fastModel: agent.fastModel ?? "",
    tools: agent.tools ?? [],
    permission: agent.permission ?? [],
  };
}

/** GET /agents：返回全部 agent（含内置展开）。 */
agentsRoutes.get("/agents", (c) => {
  const ctx = c.get("ctx");
  const agents = [...loadAgents(ctx.home).values()].map(toAgentDto);
  return c.json({ version: 1, agents });
});

/** GET /agents/scenarios：返回 4 场景实际 key（已回落解析，与 resolveScenarioAgent 一致）。 */
agentsRoutes.get("/agents/scenarios", (c) => {
  const ctx = c.get("ctx");
  const resolved: Record<string, string> = {};
  for (const key of AGENT_SCENARIO_KEYS) {
    resolved[key] = resolveScenarioAgent(key, ctx.home);
  }
  return c.json({ scenarios: resolved });
});

/** PUT /agents：完整写盘 agents.json（校验 key/name 非空、personality 合法）。 */
agentsRoutes.put("/agents", async (c) => {
  const ctx = c.get("ctx");
  let body: { version?: unknown; agents?: unknown } | undefined;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  if (!body || !body.agents) {
    return c.json({ error: "agents is required" }, 400);
  }
  try {
    const agents = saveAgentsFile(
      body as { version?: unknown; agents: unknown },
      ctx.home,
    ).map(toAgentDto);
    // 场景映射引用了已删除的 agent → 写盘校验失败时由调用方处理；这里无残留风险
    return c.json({ version: 1, agents });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

/** PUT /agents/scenarios：完整写盘 agent-scenarios.json（校验 agent key 存在）。 */
agentsRoutes.put("/agents/scenarios", async (c) => {
  const ctx = c.get("ctx");
  let body: { version?: unknown; scenarios?: unknown } | undefined;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  if (!body || !body.scenarios) {
    return c.json({ error: "scenarios is required" }, 400);
  }
  try {
    const scenarios = saveAgentScenariosFile(
      body as { version?: unknown; scenarios: unknown },
      ctx.home,
    );
    return c.json({ scenarios });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});
