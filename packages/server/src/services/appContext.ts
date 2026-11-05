import {
  createCodexProvider,
  createDeepSeekProvider,
  createOpenAiCompatibleProvider,
  createProviderRegistry,
  DEEPSEEK_API_KEY_ENV,
  loadProvidersConfig,
  reconcileActiveProvider,
  type AiProvider,
  type ProviderRegistry,
} from "@muse-work/provider";
import type { AssistantApp, AssistantTool, SettingsPanel } from "@muse-work/plugin-sdk";
import type { AssistantBridge } from "../plugins/hostPlugins.js";
import {
  loadHostPlugins,
  prepareHostPlugins,
  startPreparedPlugins,
  createAssistantBridge,
  type PreparedPlugin,
} from "../plugins/hostPlugins.js";
import { getLogger } from "../utils/logger.js";
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
import { buildAssistantSystemPrompt } from "./assistant/prompt.js";
import { ASSISTANT_TOOLS } from "./assistant/session.js";
import { createAssistantMessageLog } from "./assistant/messages.js";
import { collectQueueLabels } from "./assistant/events.js";
import { createAssistantQueue } from "./assistant/queue.js";
import { createAssistantRuntime } from "./assistant/runtime.js";
import { createAssistantTools } from "./assistant/tools.js";
import { enqueueIssuePermission, enqueueIssueSessionTurn } from "./assistant/observe.js";
import { lastAssistantText } from "./issueDispatch.js";

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
  assistantLog: ReturnType<typeof createAssistantMessageLog>;
  assistantRuntime: ReturnType<typeof createAssistantRuntime>;
  pluginRoutes: import("../plugins/hostPlugins.js").PluginRoute[];
  settingsPanels: SettingsPanel[];
  /** Bind plugin listeners after the logger is configured and before the main server listens. */
  startHostPlugins(requestedMainPort: number): Promise<void>;
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
  /** Providers contributed by host plugins. Later ids override built-ins. */
  extraProviders?: AiProvider[];
  pluginRoutes?: import("../plugins/hostPlugins.js").PluginRoute[];
  preparedPlugins?: PreparedPlugin[];
  apps?: AssistantApp[];
  extraTools?: AssistantTool[];
  settingsPanels?: SettingsPanel[];
  assistantBridge?: AssistantBridge;
}

export interface CreateSessionServicesOptions {
  home: string;
  registry: ProviderRegistry;
  createAgent?: CreateAgent;
  loadSubagentMessages?: CreateAppContextOptions["loadSubagentMessages"];
  isIssuePlanningSession?: (sessionId: string) => boolean;
  getAssistantTools?: () => import("@muse-work/agent").ToolPlugin[];
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
    getAssistantTools: options.getAssistantTools,
  });
  hub.setSnapshotProvider(() => runner.snapshotEvents());
  return { store, hub, runner };
}

export function createAppContext(
  options?: CreateAppContextOptions,
): AppContext {
  const home = resolveHome(options?.home);
  // 启动时若无 scenario-models.json 则写默认场景模型
  ensureDefaultConfigs(home);
  ensureDefaultMuseUserSettings(home);

  const getConfig = () => loadProvidersConfig(home);

  const codex = createCodexProvider({
    home,
    getConfig: () => getConfig().providers.codex,
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

  const deepseek = createDeepSeekProvider({
    getConfig: () => getConfig().providers.deepseek,
    getApiKey: () => {
      const cfg = getConfig().providers.deepseek;
      if (cfg.apiKey?.trim()) return cfg.apiKey.trim();
      const envName = cfg.apiKeyEnv ?? DEEPSEEK_API_KEY_ENV;
      const value = process.env[envName];
      return value?.trim() || undefined;
    },
  });

  const registry = createProviderRegistry(
    [deepseek, codex, openai, ...(options?.extraProviders ?? [])],
    home,
  );
  reconcileActiveProvider(registry, home);
  const issues = createIssueStore({ home });
  const automations = createAutomationStore({ home });
  let assistantTools: ReturnType<typeof createAssistantTools> | undefined;
  const sessions = createSessionServices({
    home,
    registry,
    createAgent: options?.createAgent,
    loadSubagentMessages: options?.loadSubagentMessages,
    isIssuePlanningSession: (sessionId) => {
      const issue = issues.getByPlanningSession(sessionId);
      return Boolean(issue && issue.agentMode !== "single");
    },
    getAssistantTools: () => assistantTools ?? [],
  });
  const assistantLog = createAssistantMessageLog({ home });
  const apps = options?.apps ?? [];
  const assistantQueue = createAssistantQueue({
    home,
    queueLabels: collectQueueLabels(apps),
  });
  const assistantSessionId = () =>
    sessions.store.list().find((session) => session.origin === "assistant")?.id;
  const publishAssistantStatus = (working: boolean) => {
    const sessionId = assistantSessionId();
    sessions.hub.broadcastAll({
      type: "assistant:status",
      working,
      compacting: sessionId
        ? sessions.runner.isCompacting(sessionId)
        : false,
    });
  };
  const extraTools = options?.extraTools ?? [];
  const assistantRuntime = createAssistantRuntime({
    home,
    sessions: sessions.store,
    runner: sessions.runner,
    queue: assistantQueue,
    systemPrompt: buildAssistantSystemPrompt(
      apps.map((app) => app.prompt ?? "").filter(Boolean),
    ),
    toolNames: [...ASSISTANT_TOOLS, ...extraTools.map((entry) => entry.name)],
    onActivity: (working) => {
      publishAssistantStatus(working);
    },
    onQueue: (items) => {
      sessions.hub.broadcastAll({ type: "assistant:queue", items });
    },
  });
  assistantTools = createAssistantTools({
    home,
    issues,
    sessions: sessions.store,
    runner: sessions.runner,
    automations,
    log: assistantLog,
    hub: sessions.hub,
    apps,
    extraTools,
  });
  if (options?.assistantBridge) {
    options.assistantBridge.recordInbound = (event) => {
      if (!event.message.trim()) return;
      const line = assistantLog.append("user", event.message, undefined, event.app);
      sessions.hub.broadcastAll({ type: "assistant:chat", line });
    };
    options.assistantBridge.enqueue = (event) => {
      assistantRuntime.enqueue({
        type: "chat",
        from: event.from,
        message: event.message,
        ...(event.user ? { user: event.user } : {}),
        ...(event.groupId ? { groupId: event.groupId } : {}),
      });
    };
  }
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
    onRunSettled: (run, automation) => {
      void (async () => {
        let summary: string | undefined;
        if (run.sessionId) {
          try {
            const text = lastAssistantText(
              await sessions.runner.getMessages(run.sessionId),
            );
            summary = text || undefined;
          } catch {
            summary = undefined;
          }
        }
        if (
          run.status !== "succeeded" &&
          run.status !== "failed" &&
          run.status !== "stopped" &&
          run.status !== "skipped"
        ) {
          return;
        }
        assistantRuntime.enqueue({
          type: "automation",
          automationId: automation.id,
          name: automation.name,
          runId: run.id,
          workdir: automation.workdir,
          status: run.status,
          trigger: run.trigger.type,
          mode: automation.mode === "remind" ? "remind" : "agent",
          instruction: automation.assistantHint.trim() || undefined,
          error: run.error,
          summary,
        });
      })();
    },
  });
  sessions.runner.setOnPermissionRequest((sessionId, request) => {
    enqueueIssuePermission({
      issues,
      enqueue: (event) => assistantRuntime.enqueue(event),
      sessionId,
      permissionId: request.permissionId,
      toolName: request.toolName,
      description: request.description,
    });
  });
  sessions.runner.setOnCompactionChange((sessionId, isCompacting) => {
    if (!isCompacting) assistantRuntime.onCompactionSettled(sessionId);
    if (sessionId !== assistantSessionId()) return;
    sessions.hub.broadcastAll({
      type: "assistant:status",
      working: assistantRuntime.working(),
      compacting: isCompacting,
    });
  });
  sessions.runner.setOnTurnSettled((sessionId, result) => {
    dispatcher.handleTurnSettled(sessionId, result);
    automationRuntime.handleTurnSettled(sessionId, result);
    assistantRuntime.onAssistantTurnSettled(sessionId, result);
    void enqueueIssueSessionTurn({
      issues,
      runner: sessions.runner,
      enqueue: (event) => assistantRuntime.enqueue(event),
      assistantSessionId: sessions.store
        .list()
        .find((session) => session.origin === "assistant")?.id,
      sessionId,
    });
  });
  automationRuntime.start();
  void assistantRuntime.start();
  const preparedPlugins = options?.preparedPlugins ?? [];
  return {
    ...sessions,
    home,
    registry,
    pluginRoutes: options?.pluginRoutes ?? [],
    settingsPanels: options?.settingsPanels ?? [],
    startHostPlugins(requestedMainPort: number) {
      return startPreparedPlugins(preparedPlugins, requestedMainPort, getLogger());
    },
    issueStore: issues,
    automationStore: automations,
    automationRuntime,
    issueDispatcher: dispatcher,
    assistantLog,
    assistantRuntime,
  };
}

/** Load host plugins, register them, then build the app context. */
export async function openHostedAppContext(
  options?: CreateAppContextOptions,
): Promise<AppContext> {
  const home = resolveHome(options?.home);
  const logger = getLogger();
  const bridge = createAssistantBridge();
  const plugins = await loadHostPlugins(home, logger);
  const prepared = await prepareHostPlugins({ home, plugins, logger, bridge });
  return createAppContext({
    ...options,
    home,
    extraProviders: [
      ...(options?.extraProviders ?? []),
      ...prepared.contributions.providers,
    ],
    pluginRoutes: [
      ...(options?.pluginRoutes ?? []),
      ...prepared.contributions.routes,
    ],
    preparedPlugins: prepared.prepared,
    apps: prepared.contributions.apps,
    extraTools: prepared.contributions.tools,
    settingsPanels: prepared.contributions.panels,
    assistantBridge: bridge,
  });
}
