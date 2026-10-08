import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import {
  runnerErrorMessage,
  runnerErrorStatus,
} from "../utils/runnerError.js";

export const skillsRoutes = new Hono<HonoEnv>();

/**
 * GET /skills?workdir=/path
 * 草稿新对话尚无 sessionId 时，按 workdir 预览技能列表（与 Agent 运行时发现规则一致）。
 */
skillsRoutes.get("/skills", async (c) => {
  const ctx = c.get("ctx");
  const workdir = c.req.query("workdir")?.trim() ?? "";
  if (!workdir) {
    return c.json({ error: "workdir query parameter is required" }, 400);
  }
  try {
    const skills = await ctx.runner.getSkillsForWorkdir(workdir);
    return c.json({ skills });
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});
