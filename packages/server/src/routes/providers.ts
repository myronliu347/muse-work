import { Hono } from "hono";
import {
  loadProvidersConfig,
  saveDeepSeekApiKey,
  saveProvidersConfig,
  type ModelInfo,
} from "@muse-work/provider";
import type { AppContext } from "../services/appContext.js";
import type { ProvidersCatalog } from "../services/providersCatalog.js";
import type { HonoEnv } from "../honoEnv.js";

export function createProvidersRoutes(
  ctx: AppContext,
  catalog: ProvidersCatalog,
): Hono<HonoEnv> {
  const providersRoutes = new Hono<HonoEnv>();

  providersRoutes.get("/providers", async (c) => {
    const { active } = catalog.snapshot();
    // Cold cache waits once (bounded); afterwards the route only reads cache
    // and the poller keeps the active provider warm.
    if (catalog.stale(active.providerId)) {
      await catalog.refreshProvider(active.providerId);
    }
    return c.json(catalog.snapshot());
  });

providersRoutes.post("/providers/active", async (c) => {
  const ctx = c.get("ctx");
  let body: { providerId?: string; modelId?: string } | undefined;
  try {
    body = await c.req.json<{ providerId?: string; modelId?: string }>();
  } catch {
    body = undefined;
  }
  const providerId = body?.providerId;
  const modelId = body?.modelId;
  if (!providerId || !modelId) {
    return c.json({ error: "providerId and modelId are required" }, 400);
  }
  if (!ctx.registry.get(providerId)) {
    return c.json({ error: `unknown provider: ${providerId}` }, 404);
  }
  ctx.registry.setActive(providerId, modelId);
  ctx.runner.invalidateAgentIdentities();
  catalog.invalidate();
  void catalog.refreshActive();
  return c.json({
    ok: true,
    active: ctx.registry.getActive(),
  });
});

providersRoutes.post("/providers/deepseek/api-key", async (c) => {
  const ctx = c.get("ctx");
  let body: { apiKey?: string } | undefined;
  try {
    body = await c.req.json<{ apiKey?: string }>();
  } catch {
    body = undefined;
  }
  const apiKey = body?.apiKey?.trim();
  if (!apiKey) return c.json({ error: "apiKey required" }, 400);
  saveDeepSeekApiKey(apiKey, ctx.home);
  catalog.invalidate();
  return c.json({ ok: true });
});

providersRoutes.get("/providers/:providerId/quota", async (c) => {
  const ctx = c.get("ctx");
  const providerId = c.req.param("providerId");
  const provider = ctx.registry.get(providerId);
  if (!provider?.getQuota) {
    return c.json({ error: `unknown provider: ${providerId}` }, 404);
  }
  const status = await provider.getAuthStatus();
  if (status.state !== "authenticated") {
    return c.json({ error: "unauthenticated" }, 401);
  }
  try {
    return c.json(await provider.getQuota());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 502);
  }
});

providersRoutes.get("/providers/openai-compatible", (c) => {
  const ctx = c.get("ctx");
  const cfg = loadProvidersConfig(ctx.home).providers["openai-compatible"];
  const envName = cfg.apiKeyEnv ?? "MUSE_OPENAI_API_KEY";
  const hasApiKey = Boolean(cfg.apiKey || process.env[envName]);
  return c.json({
    baseURL: cfg.baseURL ?? "",
    apiKeyEnv: envName,
    hasApiKey,
    hasStoredApiKey: Boolean(cfg.apiKey),
    models: cfg.models,
  });
});

providersRoutes.patch("/providers/openai-compatible", async (c) => {
  const ctx = c.get("ctx");
  let body:
    | {
        baseURL?: string;
        apiKey?: string;
        models?: ModelInfo[];
      }
    | undefined;
  try {
    body = await c.req.json<{
      baseURL?: string;
      apiKey?: string;
      models?: ModelInfo[];
    }>();
  } catch {
    body = undefined;
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "JSON body required" }, 400);
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
      return c.json({ error: "models must contain at least one entry" }, 400);
    }
    cfg.models = models;
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
  catalog.invalidate();
  void catalog.refreshActive();
  return c.json({
    ok: true,
    active: ctx.registry.getActive(),
  });
});

  providersRoutes.get("/providers/:providerId/models", async (c) => {
    const providerId = c.req.param("providerId");
    if (!ctx.registry.get(providerId)) {
      return c.json({ error: `unknown provider: ${providerId}` }, 404);
    }
    return c.json({ models: await catalog.refreshProvider(providerId) });
  });

  return providersRoutes;
}
