import { Hono } from "hono";
import {
  loadProvidersConfig,
  saveDeepSeekApiKey,
  saveProvidersConfig,
  type ModelInfo,
} from "@muse-work/provider";
import type { AppContext } from "../services/appContext.js";
import type { HonoEnv } from "../honoEnv.js";

/**
 * Provider metadata is fetched over the network (DeepSeek /models, Codex token
 * refresh). The UI polls this route, so it must never wait on a slow upstream:
 * answer from cache immediately and refresh in the background, with a hard
 * per-provider timeout so one hung call cannot pin the whole list.
 */
const PROVIDERS_TTL_MS = 30_000;
const MODELS_TIMEOUT_MS = 5_000;

type ProviderPayload = {
  id: string;
  displayName: string;
  models: unknown[];
};

async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createProvidersRoutes(ctx: AppContext): Hono<HonoEnv> {
  const providersRoutes = new Hono<HonoEnv>();
  // Per-provider model cache. Only the active provider is refreshed in the
  // background: the model picker needs it, and nothing should pay DeepSeek's
  // /models round trip just because that provider is installed.
  const modelsById = new Map<string, unknown[]>();
  const modelsAt = new Map<string, number>();
  const inflight = new Map<string, Promise<unknown[]>>();

  function refreshProvider(providerId: string): Promise<unknown[]> {
    const running = inflight.get(providerId);
    if (running) return running;
    const provider = ctx.registry.get(providerId);
    if (!provider) return Promise.resolve([]);
    const work = withTimeout(
      provider.listModels() as Promise<unknown[]>,
      MODELS_TIMEOUT_MS,
      modelsById.get(providerId) ?? [],
    )
      .then((models) => {
        modelsById.set(providerId, models);
        modelsAt.set(providerId, Date.now());
        return models;
      })
      .catch(() => modelsById.get(providerId) ?? [])
      .finally(() => {
        inflight.delete(providerId);
      });
    inflight.set(providerId, work);
    return work;
  }

  const stale = (providerId: string): boolean => {
    const at = modelsAt.get(providerId);
    return at === undefined || Date.now() - at >= PROVIDERS_TTL_MS;
  };

  const invalidate = (): void => {
    modelsById.clear();
    modelsAt.clear();
  };

  providersRoutes.get("/providers", async (c) => {
    const active = ctx.registry.getActive();
    if (stale(active.providerId)) {
      // Cold cache waits once (bounded by MODELS_TIMEOUT_MS); afterwards the
      // poll only ever reads the cache and refreshes behind the response.
      if (modelsById.has(active.providerId)) void refreshProvider(active.providerId);
      else await refreshProvider(active.providerId);
    }
    const providers = ctx.registry.list().map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      models: modelsById.get(provider.id) ?? [],
    }));
    return c.json({ providers, active });
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
  invalidate();
  void refreshProvider(providerId);
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
  invalidate();
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
  invalidate();
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
    return c.json({ models: await refreshProvider(providerId) });
  });

  return providersRoutes;
}
