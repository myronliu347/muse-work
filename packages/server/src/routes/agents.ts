import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import {
  loadScenarioModels,
  saveScenarioModelsFile,
} from "../services/agentConfig.js";

export const agentsRoutes = new Hono<HonoEnv>();

/** GET /scenarios/models：各场景默认 model id（已回落解析）。 */
agentsRoutes.get("/scenarios/models", (c) => {
  const ctx = c.get("ctx");
  return c.json({ models: loadScenarioModels(ctx.home) });
});

/** PUT /scenarios/models：写盘 scenario-models.json。 */
agentsRoutes.put("/scenarios/models", async (c) => {
  const ctx = c.get("ctx");
  let body: { version?: unknown; models?: unknown } | undefined;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  if (!body || !body.models) {
    return c.json({ error: "models is required" }, 400);
  }
  try {
    const models = saveScenarioModelsFile(
      body as { version?: unknown; models: unknown },
      ctx.home,
    );
    return c.json({ models });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

/** 404 旧 agent API（数字人/agent 管理已移除）。 */
agentsRoutes.all("/agents", (c) =>
  c.json({ error: "agent management removed; use /scenarios/models" }, 404),
);
agentsRoutes.all("/agents/*", (c) =>
  c.json({ error: "agent management removed; use /scenarios/models" }, 404),
);
