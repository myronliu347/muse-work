import {
  createCodeMakerProvider,
  createCodexProvider,
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
import { createAssistantMessageLog } from "./assistant/messages.js";
import { createAssistantQueue } from "./assistant/queue.js";
import { createAssistantRuntime } from "./assistant/runtime.js";
import { createAssistantTools } from "./assistant/tools.js";
import { enqueueIssuePermission, enqueueIssueSessionTurn } from "./assistant/observe.js";
import { loadPopoConfig } from "../popo/popoConfig.js";
import type { PopoTextAt } from "../popo/sender.js";
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
  popoSend: {
    current?: (receiver: string, content: string, at?: PopoTextAt) => Promise<string[]>;
    sendLocalFile?: (receiver: string, filePath: string) => Promise<string>;
    recall?: (args: { msgId: string; sessionId: string; sessionType: 1 | 3 }) => Promise<void>;
  };
  /** POPO 回调运行时（未配置时为未就绪的 runtime，而不是 undefined）。 */
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

  const codemaker = createCodeMakerProvider({
    home,
    getConfig: () => getConfig().providers.codemaker,
    // Prefer returning authUrl to UI/desktop; do not auto-open here.
    openBrowser: () => {},
    fetch: globalThis.fetch.bind(globalThis),
  });

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

  const registry = createProviderRegistry([codemaker, codex, openai], home);
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
  const assistantQueue = createAssistantQueue({ home });
  const popoSend: AppContext["popoSend"] = {};
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
  const assistantRuntime = createAssistantRuntime({
    home,
    sessions: sessions.store,
    runner: sessions.runner,
    queue: assistantQueue,
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
    sendText: (receiver, content, at) => {
      const send = popoSend.current;
      if (!send) return Promise.reject(new Error("POPO 未配置"));
      return send(receiver, content, at);
    },
    sendLocalFile: (receiver, filePath) => {
      const send = popoSend.sendLocalFile;
      if (!send) return Promise.reject(new Error("POPO 未配置"));
      return send(receiver, filePath);
    },
    recallPopo: (args) => {
      const recall = popoSend.recall;
      if (!recall) return Promise.reject(new Error("POPO 未配置"));
      return recall(args);
    },
    popoMasterUid: () => {
      try {
        const uid = loadPopoConfig(home).masterUid.trim();
        return uid || undefined;
      } catch {
        return undefined;
      }
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
  return {
    ...sessions,
    home,
    registry,
    issueStore: issues,
    automationStore: automations,
    automationRuntime,
    issueDispatcher: dispatcher,
    assistantLog,
    assistantRuntime,
    popoSend,
  };
}
