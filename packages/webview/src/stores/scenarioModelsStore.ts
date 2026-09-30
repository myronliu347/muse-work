import { create } from "zustand";
import type { MuseApiClient, MuseScenarioModels } from "../muse/apiClient";

interface ScenarioModelsState {
  api: MuseApiClient | null;
  models: MuseScenarioModels["models"] | null;
  loading: boolean;
  error: string | null;
  init(api: MuseApiClient): void;
  refresh(): Promise<void>;
}

export const useScenarioModelsStore = create<ScenarioModelsState>((set, get) => ({
  api: null,
  models: null,
  loading: true,
  error: null,
  init(api) {
    set({ api });
    void get().refresh();
  },
  async refresh() {
    const api = get().api;
    if (!api) return;
    try {
      const res = await api.getScenarioModels();
      set({
        models: res.models,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
