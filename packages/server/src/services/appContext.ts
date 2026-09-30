import {
  createCodeMakerProvider,
  createOpenAiCompatibleProvider,
  createProviderRegistry,
  loadProvidersConfig,
  type ProviderRegistry,
} from "@muse-work/provider";
import { resolveHome } from "../utils/paths.js";
import {
  createSessionRunner,
  type CreateAgent,
  type SessionAgent,
  type SessionRunner,
} from "./sessionRunner/index.js";
import { createSessionStore, type SessionStore } from "./sessionStore.js";
import { createWsHub, type WsHub } from "./wsHub.js";
import { ensureDefaultConfigs } from "./agentConfig.js";
import { ensureDefaultMuseUserSettings } from "./museAgentSettings.js";
import { createIssueDispatcher } from "./issueDispatch.js";
import { createIssueStore, type IssueStore } from "./issueStore.js";
import {
  createAutomationStore,
  type AutomationStore,
} from "./automationStore.js";
import { createAutomationRuntime } from "./automationRuntime.js";

export { resolveHome };

export type { CreateAgent, SessionAgent };

export interface AppContext {
  home: string;
  registry: ProviderRegistry;
  store: SessionStore;
  hub: WsHub;
  runner: SessionRunner;
  issueStore: IssueStore;
  automationStore: AutomationStore;
  automationRuntime: ReturnType<typeof createAutomationRuntime>;
  issueDispatcher: ReturnType<typeof createIssueDispatcher>;
  /** POPO 机器人运行时（未启用时为 undefined） */
  popo?: import("../popo/setup.js").PopoRuntime;
}

export interface CreateAppContextOptions {
  /** User home used for `~/.muse-work` paths. Overrides `MUSE_HOME`. */
  home?: string;
  /** Injectable Agent factory for tests. */
  createAgent?: CreateAgent;
  /** Loader for subagent transcripts (tests); defaults to SDK disk read. */
  loadSubagentMessages?: (
    subagentId: string,
    workdir: string,
  ) => Promise<unknown[] | null>;
  /** Injectable clock for automation tick tests. */
  now?: () => Date;
}

export interface CreateSessionServicesOptions {
  home: string;
  registry: ProviderRegistry;
  createAgent?: CreateAgent;
  loadSubagentMessages?: CreateAppContextOptions["loadSubagentMessages"];
  isIssuePlanningSession?: (sessionId: string) => boolean;
}

export function createSessionServices(
  options: CreateSessionServicesOptions,
): Pick<AppContext, "store" | "hub" | "runner"> {
  const store = createSessionStore({ home: options.home });
  const hub = createWsHub();
  const runner = createSessionRunner({
    store,
    hub,
    registry: options.registry,
    home: options.home,
    createAgent: options.createAgent,
    loadSubagentMessages: options.loadSubagentMessages,
    isIssuePlanningSession: options.isIssuePlanningSession,
  });
  hub.setSnapshotProvider(() => runner.snapshotEvents());
  return { store, hub, runner };
}

export function createAppContext(
  options?: CreateAppContextOptions,
): AppContext {
  const home = resolveHome(options?.home);
  // 启动自动生成 agent 配置文件（agents.json / agent-scenarios.json），无则写默认内置
  ensureDefaultConfigs(home);
  ensureDefaultMuseUserSettings(home);

  const getConfig = () => loadProvidersConfig(home);

  const codemaker = createCodeMakerProvider({
    home,
    getConfig: () => getConfig().providers.codemaker,
    // Prefer returning authUrl to UI/desktop; do not auto-open here.
    openBrowser: () => {},
    fetch: globalThis.fetch.bind(globalThis),
  });

  const openai = createOpenAiCompatibleProvider({
    getConfig: () => getConfig().providers["openai-compatible"],
    getApiKey: () => {
      const cfg = getConfig().providers["openai-compatible"];
      if (cfg.apiKey) return cfg.apiKey;
      const envName = cfg.apiKeyEnv ?? "MUSE_OPENAI_API_KEY";
      return process.env[envName];
    },
  });

  const registry = createProviderRegistry([codemaker, openai], home);
  const issues = createIssueStore({ home });
  const automations = createAutomationStore({ home });
  const sessions = createSessionServices({
    home,
    registry,
    createAgent: options?.createAgent,
    loadSubagentMessages: options?.loadSubagentMessages,
    isIssuePlanningSession: (sessionId) => {
      const issue = issues.getByPlanningSession(sessionId);
      return Boolean(issue && issue.agentMode !== "single");
    },
  });
  const dispatcher = createIssueDispatcher({
    issues,
    sessions: sessions.store,
    runner: sessions.runner,
    hub: sessions.hub,
    home,
  });
  const automationRuntime = createAutomationRuntime({
    store: automations,
    hub: sessions.hub,
    sessions: sessions.store,
    runner: sessions.runner,
    home,
    now: options?.now,
    issueStore: issues,
  });
  sessions.runner.setOnTurnSettled((sessionId, result) => {
    dispatcher.handleTurnSettled(sessionId, result);
    automationRuntime.handleTurnSettled(sessionId, result);
  });
  automationRuntime.start();
  return {
    ...sessions,
    home,
    registry,
    issueStore: issues,
    automationStore: automations,
    automationRuntime,
    issueDispatcher: dispatcher,
  };
}
