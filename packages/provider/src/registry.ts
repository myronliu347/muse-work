import { loadProvidersConfig, saveProvidersConfig } from "./configStore.js";
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
      const cfg = loadProvidersConfig();
      return {
        providerId: cfg.activeProviderId,
        modelId: cfg.activeModelId,
      };
    },
    setActive(providerId, modelId) {
      const cfg = loadProvidersConfig();
      cfg.activeProviderId = providerId;
      cfg.activeModelId = modelId;
      saveProvidersConfig(cfg);
    },
  };
}
