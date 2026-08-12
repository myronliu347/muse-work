import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "../createAppContext.js";
import { readJsonBody, sendError, sendJson } from "../http.js";

export async function handleListProviders(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const providers = await Promise.all(
    ctx.registry.list().map(async (provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      models: await provider.listModels(),
    })),
  );
  sendJson(res, 200, {
    providers,
    active: ctx.registry.getActive(),
  });
}

export async function handleSetActive(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const body = (await readJsonBody(req)) as
    | { providerId?: string; modelId?: string }
    | undefined;
  const providerId = body?.providerId;
  const modelId = body?.modelId;
  if (!providerId || !modelId) {
    sendError(res, 400, "providerId and modelId are required");
    return;
  }
  if (!ctx.registry.get(providerId)) {
    sendError(res, 404, `unknown provider: ${providerId}`);
    return;
  }
  ctx.registry.setActive(providerId, modelId);
  sendJson(res, 200, {
    ok: true,
    active: ctx.registry.getActive(),
  });
}

export async function handleListModels(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  providerId: string,
): Promise<void> {
  const provider = ctx.registry.get(providerId);
  if (!provider) {
    sendError(res, 404, `unknown provider: ${providerId}`);
    return;
  }
  sendJson(res, 200, { models: await provider.listModels() });
}
