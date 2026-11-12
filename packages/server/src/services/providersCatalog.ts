import type { AppContext } from "./appContext.js";

/**
 * Provider model lists are remote (DeepSeek /models, Codex refresh). Instead of
 * making the model picker poll the network, the server keeps them warm for the
 * active provider and pushes `providers:changed` when they differ.
 */
const REFRESH_INTERVAL_MS = 30_000;
const MODELS_TIMEOUT_MS = 5_000;

export type ProviderModels = {
  id: string;
  displayName: string;
  models: unknown[];
};

export type ProvidersCatalog = ReturnType<typeof createProvidersCatalog>;

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

export function createProvidersCatalog(ctx: AppContext) {
  const modelsById = new Map<string, unknown[]>();
  const modelsAt = new Map<string, number>();
  const inflight = new Map<string, Promise<unknown[]>>();
  let timer: NodeJS.Timeout | undefined;
  let lastPushed = "";

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
    return at === undefined || Date.now() - at >= REFRESH_INTERVAL_MS;
  };

  function snapshot(): { providers: ProviderModels[]; active: { providerId: string; modelId?: string } } {
    return {
      providers: ctx.registry.list().map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        models: modelsById.get(provider.id) ?? [],
      })),
      active: ctx.registry.getActive(),
    };
  }

  /** Refresh the active provider and tell the panes when the list moved. */
  async function refreshActive(): Promise<void> {
    const { active } = snapshot();
    await refreshProvider(active.providerId);
    const signature = JSON.stringify(snapshot().providers);
    if (signature === lastPushed) return;
    lastPushed = signature;
    ctx.hub.broadcastAll({ type: "providers:changed" });
  }

  function invalidate(): void {
    modelsById.clear();
    modelsAt.clear();
    lastPushed = "";
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => void refreshActive(), REFRESH_INTERVAL_MS);
    timer.unref?.();
  }

  function stop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  }

  return {
    refreshProvider,
    refreshActive,
    stale,
    snapshot,
    invalidate,
    start,
    stop,
  };
}
