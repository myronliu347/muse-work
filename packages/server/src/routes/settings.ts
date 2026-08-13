import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "../createAppContext.js";
import { readJsonBody, sendError, sendJson } from "../http.js";
import { loadMuseSettings, patchMuseSettings } from "../museSettings.js";

export async function handleGetSettings(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  sendJson(res, 200, loadMuseSettings(ctx.home));
}

export async function handlePatchSettings(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const body = (await readJsonBody(req)) as
    | { plugins?: { superpowers?: unknown } }
    | undefined;
  const superpowers = body?.plugins?.superpowers;
  if (typeof superpowers !== "boolean") {
    sendError(res, 400, "plugins.superpowers is required and must be boolean");
    return;
  }
  const settings = patchMuseSettings(
    { plugins: { superpowers } },
    ctx.home,
  );
  ctx.runner.invalidateAgentIdentities();
  sendJson(res, 200, settings);
}
