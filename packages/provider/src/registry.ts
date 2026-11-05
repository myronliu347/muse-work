import { loadProvidersConfig, saveProvidersConfig, DEFAULT_ACTIVE_MODEL_ID } from "./configStore.js";
import type { AiProvider } from "./types.js";

export interface ActiveSelection {
  providerId: string;
  modelId: string | undefined;
}

export interface ProviderRegistry {
  get(id: string): AiProvider | undefined;
  list(): AiProvider[];
  getActive(): ActiveSelection;
  setActive(providerId: string, modelId: string): void;
}

export function createProviderRegistry(
  providers: AiProvider[],
  home?: string,
): ProviderRegistry {
  const byId = new Map(providers.map((p) => [p.id, p]));

  return {
    get(id) {
      return byId.get(id);
    },
    list() {
      return [...providers];
    },
    getActive() {
      const cfg = loadProvidersConfig(home);
      return {
        providerId: cfg.activeProviderId,
        modelId: cfg.activeModelId,
      };
    },
    setActive(providerId, modelId) {
      const cfg = loadProvidersConfig(home);
      cfg.activeProviderId = providerId;
      cfg.activeModelId = modelId;
      saveProvidersConfig(cfg, home);
    },
  };
}

/** Saved provider missing from the registry falls back to DeepSeek. */
export function reconcileActiveProvider(
  registry: { get(id: string): unknown },
  home?: string,
): void {
  const cfg = loadProvidersConfig(home);
  if (registry.get(cfg.activeProviderId)) return;
  if (!registry.get("deepseek")) return;
  cfg.activeProviderId = "deepseek";
  cfg.activeModelId = DEFAULT_ACTIVE_MODEL_ID;
  saveProvidersConfig(cfg, home);
}
