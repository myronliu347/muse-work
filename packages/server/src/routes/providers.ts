import type { IncomingMessage, ServerResponse } from "node:http";
import {
  fetchCodeMakerQuotaUsage,
  loadCodeMakerCredentials,
  loadProvidersConfig,
  saveProvidersConfig,
  type ModelInfo,
} from "@muse-work/provider";
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
  // Next sendMessage must rebuild agents against the new gateway.
  ctx.runner.invalidateAgentIdentities();
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

export async function handleCodeMakerQuota(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const provider = ctx.registry.get("codemaker");
  if (!provider) {
    sendError(res, 404, "unknown provider: codemaker");
    return;
  }
  // Refresh credentials if needed before reading the auth file.
  const status = await provider.getAuthStatus();
  if (status.state !== "authenticated") {
    sendError(res, 401, "CodeMaker 未登录");
    return;
  }
  const creds = loadCodeMakerCredentials(ctx.home);
  if (!creds) {
    sendError(res, 401, "CodeMaker 未登录");
    return;
  }
  try {
    const usage = await fetchCodeMakerQuotaUsage({ creds });
    sendJson(res, 200, usage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 502, message);
  }
}

export async function handleGetOpenAiCompatibleConfig(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const cfg = loadProvidersConfig(ctx.home).providers["openai-compatible"];
  const envName = cfg.apiKeyEnv ?? "MUSE_OPENAI_API_KEY";
  const hasApiKey = Boolean(cfg.apiKey || process.env[envName]);
  sendJson(res, 200, {
    baseURL: cfg.baseURL ?? "",
    apiKeyEnv: envName,
    hasApiKey,
    hasStoredApiKey: Boolean(cfg.apiKey),
    models: cfg.models,
  });
}

export async function handlePatchOpenAiCompatibleConfig(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const body = (await readJsonBody(req)) as
    | {
        baseURL?: string;
        apiKey?: string;
        models?: ModelInfo[];
      }
    | undefined;
  if (!body || typeof body !== "object") {
    sendError(res, 400, "JSON body required");
    return;
  }

  const file = loadProvidersConfig(ctx.home);
  const cfg = file.providers["openai-compatible"];

  if (typeof body.baseURL === "string") {
    cfg.baseURL = body.baseURL.trim();
  }
  if (typeof body.apiKey === "string") {
    const trimmed = body.apiKey.trim();
    if (trimmed) {
      cfg.apiKey = trimmed;
    }
  }
  if (Array.isArray(body.models)) {
    const models: ModelInfo[] = [];
    for (const m of body.models) {
      if (!m || typeof m !== "object") continue;
      const id = typeof m.id === "string" ? m.id.trim() : "";
      if (!id) continue;
      const label =
        typeof m.label === "string" && m.label.trim() ? m.label.trim() : id;
      models.push({ id, label });
    }
    if (models.length === 0) {
      sendError(res, 400, "models must contain at least one entry");
      return;
    }
    cfg.models = models;
    // Keep active model valid when editing the openai list while it is active.
    if (
      file.activeProviderId === "openai-compatible" &&
      (!file.activeModelId ||
        !models.some((m) => m.id === file.activeModelId))
    ) {
      file.activeModelId = models[0]!.id;
    }
  }

  saveProvidersConfig(file, ctx.home);
  ctx.runner.invalidateAgentIdentities();
  sendJson(res, 200, {
    ok: true,
    active: ctx.registry.getActive(),
  });
}
