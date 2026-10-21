import {
  Agent,
  type AgentOptions,
  type PermissionDecision,
} from "@muse-work/agent";
import {
  loadProvidersConfig,
  type ProviderRegistry,
} from "@muse-work/provider";
import type { SessionStore } from "../sessionStore.js";
import type { WsBroadcastEvent, WsEvent, WsHub } from "../wsHub.js";
import { AGENT_MAX_LIVE } from "../../constants/agent.js";
import {
  patchAgentSystemPrompt,
  MUSE_BASE_SYSTEM_PROMPT,
} from "../museSystemPrompt.js";

/** Resolve UI label for a model id (falls back to the raw id). */
export function resolveModelDisplay(modelId: string | undefined): string {
  if (!modelId) return "unknown";
  try {
    const cfg = loadProvidersConfig();
    for (const provider of Object.values(cfg.providers ?? {})) {
      const found = provider.models?.find((m) => m.id === modelId);
      if (found?.label) return `${found.label} (${modelId})`;
    }
  } catch {
    // ignore config read errors; fall back to id
  }
  return modelId;
}

/** 系统注入消息的标记（包裹内容；webview 识别后以独立样式渲染，区别于用户气泡）。 */
export const SYSTEM_INJECT_OPEN = "<system-inject>";
export const SYSTEM_INJECT_CLOSE = "</system-inject>";

export function wrapSystemInject(content: string): string {
  return `${SYSTEM_INJECT_OPEN}${content}${SYSTEM_INJECT_CLOSE}`;
}

/** 内容是否系统注入消息。 */
export function isSystemInjectContent(content: string): boolean {
  return content.startsWith(SYSTEM_INJECT_OPEN) && content.endsWith(SYSTEM_INJECT_CLOSE);
}

export type SessionImage = { path: string; mimeType: string };

export interface SessionAgent {
  sendMessage(content: string, images?: SessionImage[]): Promise<void>;
  /** Persist a transcript note without starting a model turn. */
  appendSystemNote?(content: string): Promise<void>;
  /** Single-turn non-streaming fork (reuses system prompt / model / memory). */
  askBtw?: (question: string, abortSignal?: AbortSignal) => Promise<string>;
  dispose(): Promise<void>;
  /** Interrupt in-flight AI / tools / bash (SDK abortMessage). */
  abortMessage?: () => void;
  /**
   * Full UI transcript, including messages before the latest compact boundary.
   * The folded API context stays on the SDK and is not what hosts render.
   */
  getMessages?: () => unknown[];
  /** SDK session id when available (Agent.create or a test stub). */
  sessionId?: string;
  compact?: (instructions?: string) => Promise<void>;
  clearMessages?: () => Promise<void>;
  truncateHistory?: (index: number) => Promise<void>;
  setPermissionMode?: (mode: "acceptEdits" | "bypassPermissions") => void;
  getPermissionMode?: () => "acceptEdits" | "bypassPermissions";
  getMcpServers?: () => unknown[];
  connectMcpServer?: (name: string) => Promise<boolean>;
  disconnectMcpServer?: (name: string) => Promise<boolean>;
  getBackgroundTaskOutput?: (id: string, filter?: string) => unknown;
  stopBackgroundTask?: (id: string) => boolean;
  getWorkflowRuns?: () => Promise<unknown[]> | unknown[];
  stopWorkflowRun?: (runId: string) => void;
  /** SDK 运行时注册的斜杠命令（内置 /subtask + userInvocable 技能），含 handler 函数。 */
  getSlashCommands?: () => unknown[];
  /** 当前 workdir + 插件下的技能元数据（不含正文）。 */
  getAvailableSkills?: () => unknown[];
  latestTotalTokens?: number;
  /** Whether the SDK has messages queued (serialized send dispatch). */
  hasPendingMessages?: () => boolean;
  /** Remove a queued message by id (SDK-owned queue). */
  removeQueuedMessageById?: (id: string) => boolean;
  /** Update a queued message by id (SDK-owned queue). */
  updateQueuedMessageById?: (
    id: string,
    patch: { content?: string; images?: SessionImage[] },
  ) => boolean;
  /** SDK loading state (true while AI / tools are running). */
  isLoading?: () => boolean;
  /** 是否有运行中的后台任务/活跃 subagent（有则不应销毁 agent，否则任务被杀）。 */
  hasRunningBackgroundWork?: () => boolean;
  /** SDK queued messages snapshot (excludes background notifications). */
  queuedMessages?: () => unknown[];
}

export type CreateAgent = (options: AgentOptions) => Promise<SessionAgent>;

export function defaultCreateAgent(options: AgentOptions): Promise<SessionAgent> {
  const modelDisplay = resolveModelDisplay(options.model);
  return Agent.create({
    ...options,
    systemPrompt: options.systemPrompt ?? MUSE_BASE_SYSTEM_PROMPT,
  }).then((agent) => {
    patchAgentSystemPrompt(
      agent as unknown as Parameters<typeof patchAgentSystemPrompt>[0],
      { modelDisplay },
    );
    return {
      sendMessage: (content: string, images?: SessionImage[]) =>
        agent.sendMessage(content, images),
      appendSystemNote: (content: string) => agent.appendSystemNote(content),
      askBtw: (question: string, signal?: AbortSignal) =>
        agent.askBtw(question, signal),
      abortMessage: () => agent.abortMessage(),
      // SDK exposes destroy(); brief uses dispose as our session lifecycle hook.
      dispose: () => agent.destroy(),
      // Folded API context. The UI tail is paged from the session file.
      getMessages: () => agent.messages,
      sessionId: agent.sessionId,
      compact: (instructions) => agent.compact(instructions),
      clearMessages: () => agent.clearMessages(),
      truncateHistory: (index) => agent.truncateHistory(index),
      setPermissionMode: (mode) => agent.setPermissionMode(mode),
      getPermissionMode: () =>
        agent.getPermissionMode() === "bypassPermissions"
          ? "bypassPermissions"
          : "acceptEdits",
      getMcpServers: () => agent.getMcpServers(),
      connectMcpServer: (name) => agent.connectMcpServer(name),
      disconnectMcpServer: (name) => agent.disconnectMcpServer(name),
      getBackgroundTaskOutput: (id, filter) =>
        agent.getBackgroundTaskOutput(id, filter),
      stopBackgroundTask: (id) => agent.stopBackgroundTask(id),
      getWorkflowRuns: () => agent.getWorkflowRuns(),
      stopWorkflowRun: (runId) => agent.stopWorkflowRun(runId),
      getSlashCommands: () => agent.getSlashCommands(),
      getAvailableSkills: () => agent.getSkillMetadata(),
      hasPendingMessages: () => agent.hasPendingMessages,
      removeQueuedMessageById: (id) => agent.removeQueuedMessageById(id),
      updateQueuedMessageById: (id, patch) =>
        agent.updateQueuedMessageById(id, patch),
      isLoading: () => agent.isLoading,
      hasRunningBackgroundWork: () => agent.hasRunningBackgroundWork,
      queuedMessages: () => agent.queuedMessages,
      get latestTotalTokens() {
        return agent.latestTotalTokens;
      },
    };
  });
}

export type OutboundImage = { data: string; mediaType: string };

export interface SessionRunner {
  sendMessage(
    sessionId: string,
    content: string,
    images?: OutboundImage[],
    source?: "user" | "system-inject",
  ): Promise<{ accepted: true }>;
  /** Persist a system note on the session transcript without starting a model turn. */
  appendSystemNote(sessionId: string, content: string): Promise<void>;
  /**
   * 旁路提问（SDK askBtw）：单轮 fork 复用会话的 system prompt/模型/内存注入，
   * 不写消息、不落盘、不广播、不打断主对话、无工具。返回 AI 答案文本。
   */
  askBtw?(
    sessionId: string,
    question: string,
    abortSignal?: AbortSignal,
  ): Promise<string>;
  abortMessage(sessionId: string): Promise<{ ok: true }>;
  /** Remove a queued message from the SDK-owned queue. */
  deleteQueuedMessageById(
    sessionId: string,
    messageId: string,
  ): Promise<{ ok: boolean }>;
  /** Update a queued message's content/images in the SDK-owned queue. */
  updateQueuedMessage(
    sessionId: string,
    messageId: string,
    patch: { content?: string; images?: OutboundImage[] },
  ): Promise<{ ok: boolean }>;
  /** Runtime snapshot for session restore: SDK loading + queued messages. */
  getRuntimeState(
    sessionId: string,
  ): Promise<{ loading: boolean; queuedMessages: unknown[] }>;
  respondPermission(
    sessionId: string,
    permissionId: string,
    decision: PermissionDecision,
  ): Promise<{ ok: true }>;
  /** Replace the permission-request callback (runner ↔ assistant wiring). */
  setOnPermissionRequest(
    cb: (
      sessionId: string,
      request: { permissionId: string; toolName: string; description: string },
    ) => void,
  ): void;
  /** Replace the turn-settled callback (runner ↔ scheduler wiring). */
  setOnTurnSettled(
    cb: (sessionId: string, result: { ok: boolean; error?: string }) => void,
  ): void;
  /** 会话是否正在压缩。压缩期间不能中止这一轮。 */
  isCompacting(sessionId: string): boolean;
  setOnCompactionChange(
    cb: (sessionId: string, isCompacting: boolean) => void,
  ): void;
  disposeSession(sessionId: string): Promise<void>;
  /** 释放会话的 live agent（不动会话记录/消息）；agent 变更后调用，下次 ensureAgent 重建。 */
  disposeAgent(sessionId: string): Promise<{ ok: true }>;
  getMessages(sessionId: string): Promise<unknown[]>;
  /** Chronological UI window. `before` pages older disk messages; nothing is kept on the agent. */
  getMessagePage(
    sessionId: string,
    opts?: { before?: string; limit?: number },
  ): Promise<{ messages: unknown[]; hasMore: boolean }>;
  /**
   * Drop cached agent identity fingerprints so the next ensureAgent recreates
   * agents with the current provider gateway settings.
   */
  invalidateAgentIdentities(): void;
  /** Runtime events a newly connected WS client should replay. */
  snapshotEvents(): WsBroadcastEvent[];
  /** Abort running turns that are not waiting on a permission prompt. */
  abortRunningTurns(reason: string): Promise<{ aborted: number }>;
  /** Abort every in-flight turn, including permission waiters. */
  shutdown(): Promise<{ aborted: number }>;
  /** Number of live session agents (for runtime stats). */
  getAgentCount(): number;
  compact(sessionId: string): Promise<{ ok: true }>;
  clear(sessionId: string): Promise<{ ok: true }>;
  listRewindCheckpoints(
    sessionId: string,
  ): Promise<Array<{ id: string; content: string }>>;
  rewind(
    sessionId: string,
    messageId: string,
  ): Promise<{ ok: true; inputContent: string }>;
  /** Restore files captured by a turn's file_history blocks (undo). */
  revertFileHistory(
    sessionId: string,
    messageIds: string[],
  ): Promise<{ ok: true; revertedCount: number }>;
  setPermissionMode(
    sessionId: string,
    mode: "acceptEdits" | "bypassPermissions",
  ): Promise<{ ok: true; mode: "acceptEdits" | "bypassPermissions" }>;
  getStatus(sessionId: string): Promise<{
    sessionId: string;
    workdir: string;
    permissionMode: "acceptEdits" | "bypassPermissions";
    latestTotalTokens: number;
    museSessionId?: string;
  }>;
  getMcpServers(sessionId: string): Promise<unknown[]>;
  connectMcpServer(sessionId: string, name: string): Promise<{ ok: boolean }>;
  disconnectMcpServer(sessionId: string, name: string): Promise<{ ok: boolean }>;
  getBackgroundTaskOutput(
    sessionId: string,
    taskId: string,
  ): Promise<unknown>;
  getBackgroundTasks(sessionId: string): Promise<unknown[]>;
  getTasks(sessionId: string): Promise<unknown[]>;
  stopBackgroundTask(sessionId: string, taskId: string): Promise<{ ok: boolean }>;
  getWorkflowRuns(sessionId: string): Promise<unknown[]>;
  stopWorkflowRun(sessionId: string, runId: string): Promise<{ ok: true }>;
  getSlashCommands(sessionId: string): Promise<unknown[]>;
  getSkillsForWorkdir(workdir: string): Promise<unknown[]>;
}

export interface PendingPermission {
  sessionId: string;
  resolve: (decision: PermissionDecision) => void;
  request: Extract<WsEvent, { type: "permission:request" }>;
}

export interface CreateSessionRunnerOptions {
  store: SessionStore;
  hub: WsHub;
  registry: ProviderRegistry;
  home: string;
  createAgent?: CreateAgent;
  /** Max live SDK agents; LRU-evict idle ones over this. Default 20. */
  maxLiveAgents?: number;
  /**
   * When heapUsed exceeds this, LRU-evict idle agents (except the session
   * being ensured). 0 / omitted disables heap eviction.
   */
  heapEvictBytes?: number;
  /** Injectable heap sampler for tests. Defaults to process.memoryUsage. */
  memoryUsage?: () => { heapUsed: number };
  /**
   * Load a subagent transcript for historical nesting (defaults to reading the
   * SDK's `subagent-<id>.jsonl` from disk). Returns frontend-format messages.
   */
  loadSubagentMessages?: (
    subagentId: string,
    workdir: string,
  ) => Promise<unknown[] | null>;
  /**
   * Load a main session's persisted messages when no agent runtime exists
   * (defaults to reading the SDK's `<sessionId>.jsonl` from disk). Returns raw
   * SDK messages or null when the session file is missing. Lets the messages
   * endpoint serve history without forcing agent creation on session switch.
   */
  loadMainSessionFromDisk?: (
    sessionId: string,
    workdir: string,
  ) => Promise<{ messages: unknown[] } | null>;
  /**
   * Called when a turn settles for sessions whose status was running. Lets
   * external schedulers react to turn completion without
   * reaching into runner internals. ok=false when the turn aborted or errored.
   */
  onTurnSettled?: (sessionId: string, result: { ok: boolean; error?: string }) => void;
  /** True when this session is an Issue planning session (deny source-code writes). */
  isIssuePlanningSession?: (sessionId: string) => boolean;
  /** Tools injected only into the assistant session. */
  getAssistantTools?: () => import("@muse-work/agent").ToolPlugin[];
}

/**
 * Lifecycle cross-cutting functions assembled by core.ts. Agent/actions layers
 * reach them via ctx.core so core never imports upward.
 */
export interface CoreLayer {
  markTurnOutput(sessionId: string): void;
  broadcastMessages(sessionId: string): void;
  broadcastFileHistory(sessionId: string): void;
  reportEmptyTurnIfNeeded(sessionId: string): void;
  interruptTurn(sessionId: string, opts?: { error?: string; denyMessage?: string }): void;
  hasPendingPermission(sessionId: string): boolean;
  canIdleDestroy(sessionId: string): boolean;
  destroyRuntime(sessionId: string): Promise<void>;
  markUnreadDoneIfInactive(sessionId: string): void;
  markIdle(sessionId: string): void;
  finishTurnError(sessionId: string, err: unknown): void;
  denyPendingPermissions(sessionId: string, message: string): void;
  touchAgent(sessionId: string): void;
  maybeEvictLiveAgents(keepSessionId: string): Promise<void>;
}

/**
 * Agent-runtime functions assembled by agent.ts. Actions reach them via
 * ctx.agent so the dependency direction stays agent → core → ctx.
 */
export interface AgentLayer {
  ensureAgent(sessionId: string): Promise<SessionAgent>;
  runTurn(
    sessionId: string,
    content: string,
    images?: SessionImage[],
    source?: "user" | "system-inject",
  ): Promise<void>;
  attachNestedMessages(
    sessionId: string,
    workdir: string,
    messages: unknown[],
  ): Promise<unknown[]>;
  loadMainSessionFromDisk(
    sessionId: string,
    workdir: string,
  ): Promise<{ messages: unknown[] } | null>;
  reconcileBackgroundTasks(sessionId: string): Promise<unknown[]>;
  getSkillsForWorkdir(workdir: string): Promise<unknown[]>;
}

/**
 * Shared mutable state + injected dependencies for one SessionRunner instance.
 * All cross-module calls in the sessionRunner/ tree flow through this object;
 * module factories are (ctx) => function group and static deps stay acyclic.
 */
export interface RunnerContext {
  // --- injections ---
  store: SessionStore;
  hub: WsHub;
  registry: ProviderRegistry;
  home: string;
  options: CreateSessionRunnerOptions;
  createAgent: CreateAgent;
  maxLiveAgents: number;
  heapEvictBytes: number;
  memoryUsage: () => { heapUsed: number };
  // --- shared mutable state ---
  /** Turn-settled callback (runner ↔ scheduler wiring; settable after creation). */
  onTurnSettled:
    | ((sessionId: string, result: { ok: boolean; error?: string }) => void)
    | undefined;
  /** Issue-session permission requests, so the assistant can approve them. */
  onPermissionRequest:
    | ((
        sessionId: string,
        request: { permissionId: string; toolName: string; description: string },
      ) => void)
    | undefined;
  /** 压缩状态变化。只在 true/false 切换时调用。 */
  onCompactionChange:
    | ((sessionId: string, isCompacting: boolean) => void)
    | undefined;
  compacting: Set<string>;
  agents: Map<string, SessionAgent>;
  /** Last ensure/activity time for LRU live-agent eviction. */
  agentLastUsed: Map<string, number>;
  /** Gateway identity used when the session agent was created (model switch → recreate). */
  agentIdentities: Map<string, string>;
  pending: Map<string, PendingPermission>;
  /** Session IDs that were disposed; late createAgent completions must not revive them. */
  disposed: Set<string>;
  /** Per-session flag: current turn already received assistant stage "end". */
  turnEnded: Map<string, boolean>;
  /** True once this turn emitted assistant / tool / reasoning / error output. */
  turnHadOutput: Map<string, boolean>;
  /** Nested runTurn `sendMessage` awaits; loading=false must not idle while > 0. */
  turnSendDepth: Map<string, number>;
  /**
   * Session sent a message while the SDK was still loading (queued). The next
   * onUserMessageAdded is that queued turn actually dispatching.
   */
  queuedDispatch: Set<string>;
  /**
   * After a queued dispatch, the next loading(false)→(true) edge starts the new
   * turn's output tracking. Mid-turn loading flicker must not clear
   * turnHadOutput (that broadcasts a bogus empty-turn error under live tools).
   */
  pendingTurnOutputReset: Set<string>;
  /** True while interruptTurn is aborting the SDK (skip empty-turn errors). */
  aborting: Set<string>;
  /** Latest SDK onLoadingChange; used so we don't mark idle while tools still run. */
  agentLoading: Map<string, boolean>;
  /**
   * True once the SDK fired onLoadingChange for this turn. The runTurn fallback
   * (tests / swallowed turns) must only report an empty turn when loading was
   * NEVER reported — right after sendMessage the async onLoadingChange(true)
   * may not have arrived yet, and mistaking that window for a finished empty
   * turn shows a bogus "模型没有产生输出" error block.
   */
  loadingSeen: Map<string, boolean>;
  agentToolBinds: Map<string, Map<string, string>>;
  pendingAgentToolIds: Map<string, string[]>;
  unboundSubagentIds: Map<string, string[]>;
  knownAgentToolIds: Map<string, Set<string>>;
  latestTasks: Map<string, unknown[]>;
  latestBackgroundTasks: Map<string, unknown[]>;
  latestWorkflowRuns: Map<string, unknown[]>;
  latestMcp: Map<string, unknown[]>;
  latestTokens: Map<string, number>;
  titleGenerating: Set<string>;
  // --- assembled layers (filled by createSessionRunner after each factory) ---
  core: CoreLayer;
  agent: AgentLayer;
}

/** 记下压缩状态，状态变化时通知，并推给界面。 */
export function publishCompaction(
  ctx: RunnerContext,
  sessionId: string,
  isCompacting: boolean,
): void {
  const was = ctx.compacting.has(sessionId);
  if (isCompacting) ctx.compacting.add(sessionId);
  else ctx.compacting.delete(sessionId);
  if (was !== isCompacting) ctx.onCompactionChange?.(sessionId, isCompacting);
  ctx.hub.broadcast(sessionId, { type: "compaction:state", isCompacting });
}

export function createRunnerContext(
  options: CreateSessionRunnerOptions,
): RunnerContext {
  const { store, hub, registry, home } = options;
  const ctx: RunnerContext = {
    store,
    hub,
    registry,
    home,
    options,
    createAgent: options.createAgent ?? defaultCreateAgent,
    maxLiveAgents: options.maxLiveAgents ?? AGENT_MAX_LIVE,
    heapEvictBytes: options.heapEvictBytes ?? 0,
    memoryUsage: options.memoryUsage ?? (() => process.memoryUsage()),
    onTurnSettled: options.onTurnSettled,
    onPermissionRequest: undefined,
    onCompactionChange: undefined,
    compacting: new Set<string>(),
    agents: new Map<string, SessionAgent>(),
    agentLastUsed: new Map<string, number>(),
    agentIdentities: new Map<string, string>(),
    pending: new Map<string, PendingPermission>(),
    disposed: new Set<string>(),
    turnEnded: new Map<string, boolean>(),
    turnHadOutput: new Map<string, boolean>(),
    turnSendDepth: new Map<string, number>(),
    queuedDispatch: new Set<string>(),
    pendingTurnOutputReset: new Set<string>(),
    aborting: new Set<string>(),
    agentLoading: new Map<string, boolean>(),
    loadingSeen: new Map<string, boolean>(),
    agentToolBinds: new Map<string, Map<string, string>>(),
    pendingAgentToolIds: new Map<string, string[]>(),
    unboundSubagentIds: new Map<string, string[]>(),
    knownAgentToolIds: new Map<string, Set<string>>(),
    latestTasks: new Map<string, unknown[]>(),
    latestBackgroundTasks: new Map<string, unknown[]>(),
    latestWorkflowRuns: new Map<string, unknown[]>(),
    latestMcp: new Map<string, unknown[]>(),
    latestTokens: new Map<string, number>(),
    titleGenerating: new Set<string>(),
    // Assembled in createSessionRunner: ctx.core = createCore(ctx) first, then
    // ctx.agent = createAgentLayer(ctx). Factories only *read* these at call
    // time (after assembly), so the placeholder is never observed.
    core: undefined as unknown as CoreLayer,
    agent: undefined as unknown as AgentLayer,
  };
  return ctx;
}
