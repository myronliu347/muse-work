import { create } from "zustand";
import type {
  MuseAgent,
  MuseAgentScenarios,
  MuseApiClient,
} from "../muse/apiClient";

/**
 * 数字人 agent 列表 + 场景映射缓存（设置页与消息输入框选择器共用）。
 * 数据源是 server 的 GET /agents 与 /agents/scenarios（磁盘 agents.json 为准，
 * 这里只做 UI 缓存，非冗余数据源）。
 */
interface AgentsState {
  api: MuseApiClient | null;
  agents: MuseAgent[];
  scenarios: MuseAgentScenarios["scenarios"] | null;
  loading: boolean;
  error: string | null;
  init(api: MuseApiClient): void;
  refresh(): Promise<void>;
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  api: null,
  agents: [],
  scenarios: null,
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
      const [agentsRes, scenariosRes] = await Promise.all([
        api.getAgents(),
        api.getAgentScenarios(),
      ]);
      set({
        agents: agentsRes.agents,
        scenarios: scenariosRes.scenarios,
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
