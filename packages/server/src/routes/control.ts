import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "../createAppContext.js";
import { sendJson } from "../http.js";
import { getLogger } from "../logger.js";

export async function handleControlResume(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const result = await ctx.runner.abortRunningTurns("Interrupted after sleep");
  getLogger().info("resume recovered running turns", result);
  sendJson(res, 200, result);
}
