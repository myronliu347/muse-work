import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "../createAppContext.js";
import { readJsonBody, sendError, sendJson } from "../http.js";

function getActiveProvider(ctx: AppContext) {
  const { providerId } = ctx.registry.getActive();
  const provider = ctx.registry.get(providerId);
  if (!provider) {
    return undefined;
  }
  return provider;
}

export async function handleAuthStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const provider = getActiveProvider(ctx);
  if (!provider) {
    sendError(res, 404, "active provider not found");
    return;
  }
  sendJson(res, 200, await provider.getAuthStatus());
}

export async function handleAuthLogin(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const provider = getActiveProvider(ctx);
  if (!provider) {
    sendError(res, 404, "active provider not found");
    return;
  }

  const body = (await readJsonBody(req)) as
    | { wait?: boolean; complete?: boolean }
    | undefined;
  const wait = Boolean(body?.wait || body?.complete);

  // Desktop/UI opens the browser; server only returns authUrl.
  const start = await provider.beginLogin({ openBrowser: () => {} });
  if (wait) {
    if ("reused" in start && start.reused) {
      sendJson(res, 200, await provider.getAuthStatus());
      return;
    }
    sendJson(res, 200, await provider.completeLogin({}));
    return;
  }
  sendJson(res, 200, start);
}

export async function handleAuthLogout(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const provider = getActiveProvider(ctx);
  if (!provider) {
    sendError(res, 404, "active provider not found");
    return;
  }
  await provider.logout();
  sendJson(res, 200, { ok: true });
}
