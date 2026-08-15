import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import { getLogger } from "../utils/logger.js";

export const controlRoutes = new Hono<HonoEnv>();

controlRoutes.post("/control/resume", async (c) => {
  const ctx = c.get("ctx");
  const result = await ctx.runner.abortRunningTurns("Interrupted after sleep");
  getLogger().info("resume recovered running turns", result);
  return c.json(result);
});
