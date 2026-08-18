import {
  Agent,
  loadSessionFromJsonl,
  type AgentOptions,
  type PermissionDecision,
} from "wave-agent-sdk";
import {
  loadProvidersConfig,
  type GatewayResolution,
  type ProviderRegistry,
} from "@muse-work/provider";
import type { SessionStore } from "./sessionStore.js";
import type { WsBroadcastEvent, WsEvent, WsHub } from "./wsHub.js";
import {
  appendImageSourceMarkers,
  saveBase64Images,
} from "../utils/imageSaver.js";
import {
  AGENT_IDLE_TTL_MS,
  DEFAULT_TITLE,
  EMPTY_TURN_ERROR,
  TITLE_MAX_LEN,
  TURN_STALL_MS,
} from "../constants/agent.js";
import { closeAgentLogger, createAgentLogger, getLogger } from "../utils/logger.js";
import { mapSdkMessages } from "../utils/messageMapper.js";
import {
  patchAgentSystemPrompt,
  MUSE_BASE_SYSTEM_PROMPT,
  MUSE_IDENTITY_REV,
} from "./museSystemPrompt.js";
import { AGENT_TOOL_NAME } from "wave-agent-sdk/dist/constants/tools.js";
import {
  loadMuseSettings,
  superpowersPluginDirIfPresent,
} from "./museSettings.js";

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

export {
  AGENT_IDLE_TTL_MS,
  EMPTY_TURN_ERROR,
  TURN_STALL_MS,
} from "../constants/agent.js";

export type SessionImage = { path: string; mimeType: string };

export interface SessionAgent {
  sendMessage(content: string, images?: SessionImage[]): Promise<void>;
  /** Single-turn non-streaming fork (reuses system prompt / model / memory). */
  askBtw?: (question: string, abortSignal?: AbortSignal) => Promise<string>;
  dispose(): Promise<void>;
  /** Interrupt in-flight AI / tools / bash (SDK abortMessage). */
  abortMessage?: () => void;
  /** Optional SDK message snapshot (used after compaction). */
  getMessages?: () => unknown[];
  /** Wave session id when available (SDK agent or test stub). */
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

export type OutboundImage = { data: string; mediaType: string };

export interface SessionRunner {
  sendMessage(
    sessionId: string,
    content: string,
    images?: OutboundImage[],
  ): Promise<{ accepted: true }>;
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
  disposeSession(sessionId: string): Promise<void>;
  getMessages(sessionId: string): Promise<unknown[]>;
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
  setPermissionMode(
    sessionId: string,
    mode: "acceptEdits" | "bypassPermissions",
  ): Promise<{ ok: true; mode: "acceptEdits" | "bypassPermissions" }>;
  getStatus(sessionId: string): Promise<{
    sessionId: string;
    workdir: string;
    permissionMode: "acceptEdits" | "bypassPermissions";
    latestTotalTokens: number;
    waveSessionId?: string;
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
}

interface PendingPermission {
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
  /** Idle TTL before destroying runtime (keeps store record). Default 10min. */
  idleTtlMs?: number;
  /** Abort a running turn after this long with no SDK callbacks. Default 5min. */
  stallMs?: number;
  /**
   * Load a subagent transcript for historical nesting (defaults to reading the
   * SDK's `subagent-<id>.jsonl` from disk). Returns frontend-format messages.
   */
  loadSubagentMessages?: (
    subagentId: string,
    workdir: string,
  ) => Promise<unknown[] | null>;
}

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
      askBtw: (question: string, signal?: AbortSignal) =>
        agent.askBtw(question, signal),
      abortMessage: () => agent.abortMessage(),
      // SDK exposes destroy(); brief uses dispose as our session lifecycle hook.
      dispose: () => agent.destroy(),
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

function toSdkImages(images?: OutboundImage[]): SessionImage[] | undefined {
  if (!images || images.length === 0) return undefined;
  return images.map((img) => ({
    path: img.data,
    mimeType: img.mediaType || "image/png",
  }));
}

export function createSessionRunner(
  options: CreateSessionRunnerOptions,
): SessionRunner {
  const { store, hub, registry, home } = options;
  const createAgent = options.createAgent ?? defaultCreateAgent;
  const idleTtlMs = options.idleTtlMs ?? AGENT_IDLE_TTL_MS;
  const stallMs = options.stallMs ?? TURN_STALL_MS;
  const agents = new Map<string, SessionAgent>();
  /** Gateway identity used when the session agent was created (model switch → recreate). */
  const agentIdentities = new Map<string, string>();
  const pending = new Map<string, PendingPermission>();
  /** Session IDs that were disposed; late createAgent completions must not revive them. */
  const disposed = new Set<string>();
  /** Per-session flag: current turn already received assistant stage "end". */
  const turnEnded = new Map<string, boolean>();
  /** True once this turn emitted assistant / tool / reasoning / error output. */
  const turnHadOutput = new Map<string, boolean>();
  /** True while interruptTurn is aborting the SDK (skip empty-turn errors). */
  const aborting = new Set<string>();
  /** Latest SDK onLoadingChange; used so we don't mark idle while tools still run. */
  const agentLoading = new Map<string, boolean>();
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const stallTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const agentToolBinds = new Map<string, Map<string, string>>();
  const pendingAgentToolIds = new Map<string, string[]>();
  const unboundSubagentIds = new Map<string, string[]>();
  const knownAgentToolIds = new Map<string, Set<string>>();
  const latestTasks = new Map<string, unknown[]>();
  const latestBackgroundTasks = new Map<string, unknown[]>();
  const latestWorkflowRuns = new Map<string, unknown[]>();
  const latestMcp = new Map<string, unknown[]>();
  const latestTokens = new Map<string, number>();

  async function reconcileBackgroundTasks(sessionId: string): Promise<unknown[]> {
    const cached = latestBackgroundTasks.get(sessionId) ?? [];
    const agent = agents.get(sessionId);
    if (!agent?.getBackgroundTaskOutput || cached.length === 0) {
      return cached;
    }
    const next = await Promise.all(
      cached.map(async (task) => {
        if (!task || typeof task !== "object") return task;
        const summary = task as Record<string, unknown>;
        if (summary.status !== "running" || typeof summary.id !== "string") {
          return task;
        }
        const output = await Promise.resolve(
          agent.getBackgroundTaskOutput?.(summary.id),
        );
        if (!output || typeof output !== "object") return task;
        const status = (output as { status?: unknown }).status;
        if (typeof status !== "string" || status === "running") return task;
        const exitCode = (output as { exitCode?: unknown }).exitCode;
        return {
          ...summary,
          status,
          endTime: Date.now(),
          ...(exitCode !== undefined ? { exitCode } : {}),
        };
      }),
    );
    latestBackgroundTasks.set(sessionId, next);
    return next;
  }

  function bindAgentTools(sessionId: string): void {
    const pending = pendingAgentToolIds.get(sessionId) ?? [];
    const unbound = unboundSubagentIds.get(sessionId) ?? [];
    const binds = agentToolBinds.get(sessionId) ?? new Map<string, string>();
    while (pending.length > 0 && unbound.length > 0) {
      const toolId = pending.shift()!;
      if (binds.has(toolId)) continue;
      binds.set(toolId, unbound.shift()!);
    }
    pendingAgentToolIds.set(sessionId, pending);
    unboundSubagentIds.set(sessionId, unbound);
    agentToolBinds.set(sessionId, binds);
  }

  function rememberAgentTool(
    sessionId: string,
    params: Record<string, unknown>,
  ): void {
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return;
    const known = knownAgentToolIds.get(sessionId) ?? new Set<string>();
    if (params.name === AGENT_TOOL_NAME) known.add(id);
    knownAgentToolIds.set(sessionId, known);
    if (!known.has(id)) return;
    const binds = agentToolBinds.get(sessionId) ?? new Map<string, string>();
    const pending = pendingAgentToolIds.get(sessionId) ?? [];
    if (!binds.has(id) && !pending.includes(id)) {
      pending.push(id);
      pendingAgentToolIds.set(sessionId, pending);
    }
    bindAgentTools(sessionId);
  }

  /** Record a subagent's id so the next pending Agent tool call can bind to it. */
  function rememberSubagentId(sessionId: string, subagentId: string): void {
    const boundIds = [...(agentToolBinds.get(sessionId)?.values() ?? [])];
    const unbound = unboundSubagentIds.get(sessionId) ?? [];
    if (!boundIds.includes(subagentId) && !unbound.includes(subagentId)) {
      unbound.push(subagentId);
      unboundSubagentIds.set(sessionId, unbound);
    }
    bindAgentTools(sessionId);
  }

  /** UUID shape required by the SDK for subagent session ids. */
  const SUBAGENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const loadSubagentFromDisk = async (
    subagentId: string,
    workdir: string,
  ): Promise<unknown[] | null> => {
    const data = await loadSessionFromJsonl(subagentId, workdir, "subagent");
    return data?.messages?.length ? mapSdkMessages(data.messages) : null;
  };

  /**
   * Attach subagent transcripts to Agent tool blocks for history display.
   * Transcripts are no longer cached in memory — they are loaded on demand
   * from the SDK's `subagent-<id>.jsonl`, which the SDK appends to live.
   */
  async function attachNestedMessages(
    sessionId: string,
    workdir: string,
    messages: unknown[],
  ): Promise<unknown[]> {
    const binds = agentToolBinds.get(sessionId);
    if (!binds || binds.size === 0) return messages;
    const loadTranscript = options.loadSubagentMessages ?? loadSubagentFromDisk;

    // Collect the unique subagent ids referenced by Agent blocks.
    const needed = new Set<string>();
    for (const message of messages) {
      const blocks = (message as { blocks?: unknown[] }).blocks;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        const tool = block as { type?: string; name?: string; id?: string };
        if (tool.type !== "tool" || tool.name !== AGENT_TOOL_NAME) continue;
        const subagentId = tool.id && binds.get(tool.id);
        if (subagentId && SUBAGENT_ID_RE.test(subagentId)) {
          needed.add(subagentId);
        }
      }
    }
    if (needed.size === 0) return messages;

    const transcripts = new Map<string, unknown[]>();
    await Promise.all(
      [...needed].map(async (subagentId) => {
        try {
          const loaded = await loadTranscript(subagentId, workdir);
          if (loaded?.length) transcripts.set(subagentId, loaded);
        } catch {
          // A missing/corrupt subagent file must not fail getMessages.
        }
      }),
    );
    if (transcripts.size === 0) return messages;

    return messages.map((message) => {
      if (!message || typeof message !== "object") return message;
      const blocks = (message as { blocks?: unknown[] }).blocks;
      if (!Array.isArray(blocks)) return message;
      let changed = false;
      const nextBlocks = blocks.map((block) => {
        if (!block || typeof block !== "object") return block;
        const tool = block as { type?: string; name?: string; id?: string };
        if (tool.type !== "tool" || tool.name !== AGENT_TOOL_NAME) {
          return block;
        }
        const subagentId = tool.id && binds.get(tool.id);
        const nested = subagentId ? transcripts.get(subagentId) : undefined;
        if (!nested) return block;
        changed = true;
        return { ...tool, nestedMessages: nested };
      });
      return changed ? { ...(message as Record<string, unknown>), blocks: nextBlocks } : message;
    });
  }

  function superpowersFlag(): "superpowers:on" | "superpowers:off" {
    const enabled = loadMuseSettings(home).plugins.superpowers;
    const dir = superpowersPluginDirIfPresent();
    return enabled && dir ? "superpowers:on" : "superpowers:off";
  }

  function gatewayIdentity(gateway: GatewayResolution): string {
    const credential =
      gateway.credentialFingerprint ?? gateway.apiKey ?? "";
    return [
      gateway.baseURL,
      gateway.model,
      credential,
      gateway.fastModel ?? "",
      MUSE_IDENTITY_REV,
      superpowersFlag(),
    ].join("\0");
  }

  function clearIdleTimer(sessionId: string): void {
    const timer = idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      idleTimers.delete(sessionId);
    }
  }

  function clearStallTimer(sessionId: string): void {
    const timer = stallTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      stallTimers.delete(sessionId);
    }
  }

  function bumpActivity(sessionId: string): void {
    clearStallTimer(sessionId);
    if (!stallMs || stallMs <= 0) return;
    if (disposed.has(sessionId) || store.get(sessionId)?.status !== "running") {
      return;
    }
    if (hasPendingPermission(sessionId)) return;
    const timer = setTimeout(() => {
      stallTimers.delete(sessionId);
      if (disposed.has(sessionId) || store.get(sessionId)?.status !== "running") {
        return;
      }
      if (hasPendingPermission(sessionId)) return;
      interruptTurn(sessionId, {
        error: `Turn stalled after ${stallMs}ms with no activity`,
      });
    }, stallMs);
    stallTimers.set(sessionId, timer);
  }

  function markTurnOutput(sessionId: string): void {
    turnHadOutput.set(sessionId, true);
  }

  function reportEmptyTurnIfNeeded(sessionId: string): void {
    if (disposed.has(sessionId) || aborting.has(sessionId)) {
      return;
    }
    if (turnEnded.get(sessionId) || turnHadOutput.get(sessionId)) {
      return;
    }
    turnHadOutput.set(sessionId, true);
    getLogger().warn("empty turn", { sessionId });
    hub.broadcast(sessionId, {
      type: "error:block",
      error: EMPTY_TURN_ERROR,
    });
  }

  function interruptTurn(
    sessionId: string,
    opts: { error?: string; denyMessage?: string } = {},
  ): void {
    aborting.add(sessionId);
    try {
      denyPendingPermissions(
        sessionId,
        opts.denyMessage ?? opts.error ?? "Aborted",
      );
      clearStallTimer(sessionId);
      agents.get(sessionId)?.abortMessage?.();
      agentLoading.set(sessionId, false);
      hub.broadcast(sessionId, { type: "loading", loading: false });
      // 中断（abort/stall/权限拒绝）时清空 sender 任务列表：任务进度只在
      // 会话执行中展示。不删除 latestTasks 缓存，后续轮次仍可复用。
      hub.broadcast(sessionId, { type: "tasks:update", tasks: [] });
      if (!turnEnded.get(sessionId)) {
        hub.broadcast(sessionId, { type: "message:completed" });
        turnEnded.set(sessionId, true);
      }
      if (opts.error) {
        finishTurnError(sessionId, new Error(opts.error));
      } else {
        markIdle(sessionId);
      }
    } finally {
      aborting.delete(sessionId);
    }
  }

  function hasPendingPermission(sessionId: string): boolean {
    for (const entry of pending.values()) {
      if (entry.sessionId === sessionId) {
        return true;
      }
    }
    return false;
  }

  function canIdleDestroy(sessionId: string): boolean {
    if (disposed.has(sessionId) || !store.get(sessionId)) {
      return false;
    }
    const session = store.get(sessionId);
    if (session?.status === "running") {
      return false;
    }
    if (hasPendingPermission(sessionId)) {
      return false;
    }
    // Queued messages live in the SDK's own queue now; keep the runtime alive
    // until they are dispatched so they are not lost on destroy.
    if (agents.get(sessionId)?.hasPendingMessages?.()) {
      return false;
    }
    return true;
  }

  /** Destroy runtime only — keep sessions.json / waveSessionId. */
  async function destroyRuntime(sessionId: string): Promise<void> {
    // Re-check immediately before dispose (TOCTOU vs runTurn / ensureAgent).
    if (!canIdleDestroy(sessionId)) {
      return;
    }
    clearIdleTimer(sessionId);
    clearStallTimer(sessionId);
    turnEnded.delete(sessionId);
    turnHadOutput.delete(sessionId);
    aborting.delete(sessionId);
    agentLoading.delete(sessionId);
    titleGenerating.delete(sessionId);
    // UI caches: latestTasks is only read while a session is running (getTasks
    // returns [] when idle) and the rest are lazily rebuilt from the SDK on the
    // next ensureAgent. agentToolBinds & friends are kept so history view can
    // still resolve subagent transcripts from disk (cleared on disposeSession).
    latestTokens.delete(sessionId);
    latestTasks.delete(sessionId);
    latestBackgroundTasks.delete(sessionId);
    latestWorkflowRuns.delete(sessionId);
    latestMcp.delete(sessionId);
    closeAgentLogger(sessionId);
    const agent = agents.get(sessionId);
    agents.delete(sessionId);
    agentIdentities.delete(sessionId);
    if (agent) {
      await agent.dispose();
    }
  }

  function scheduleIdleDestroy(sessionId: string): void {
    clearIdleTimer(sessionId);
    if (!canIdleDestroy(sessionId)) {
      return;
    }
    const timer = setTimeout(() => {
      idleTimers.delete(sessionId);
      if (!canIdleDestroy(sessionId)) {
        // Still busy — re-arm so cleanup can recover once conditions clear.
        if (!disposed.has(sessionId) && store.get(sessionId)) {
          const retry = setTimeout(() => {
            idleTimers.delete(sessionId);
            scheduleIdleDestroy(sessionId);
          }, idleTtlMs);
          idleTimers.set(sessionId, retry);
        }
        return;
      }
      void destroyRuntime(sessionId);
    }, idleTtlMs);
    idleTimers.set(sessionId, timer);
  }

  function markUnreadDoneIfInactive(sessionId: string): void {
    if (store.getActiveSessionId() === sessionId) {
      return;
    }
    if (disposed.has(sessionId) || !store.get(sessionId)) {
      return;
    }
    store.setUnreadDone(sessionId, true);
    hub.broadcast(sessionId, {
      type: "session:unread",
      sessionId,
      unreadDone: true,
    });
  }

  function markIdle(sessionId: string): void {
    clearStallTimer(sessionId);
    if (disposed.has(sessionId) || !store.get(sessionId)) {
      return;
    }
    const wasRunning = store.get(sessionId)?.status === "running";
    if (wasRunning) {
      store.updateStatus(sessionId, "idle");
      hub.broadcast(sessionId, { type: "session:status", status: "idle" });
      // Only a finished turn is unread — idle loading=false (TTL dispose,
      // ensureAgent, SDK flicker) must not light the sidebar dot.
      markUnreadDoneIfInactive(sessionId);
    }
    scheduleIdleDestroy(sessionId);
  }

  function finishTurnError(sessionId: string, err: unknown): void {
    if (disposed.has(sessionId) || !store.get(sessionId)) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    getLogger().error("turn failed", { sessionId, error: message });
    store.updateStatus(sessionId, "error");
    hub.broadcast(sessionId, {
      type: "session:status",
      status: "error",
      error: message,
    });
    // Idle lets the SDK's own queue dispatch the next message via tryDispatch.
    store.updateStatus(sessionId, "idle");
    hub.broadcast(sessionId, { type: "session:status", status: "idle" });
    markUnreadDoneIfInactive(sessionId);
    scheduleIdleDestroy(sessionId);
  }

  function rememberWaveSessionId(
    sessionId: string,
    waveSessionId: string | undefined,
  ): void {
    if (!waveSessionId || disposed.has(sessionId) || !store.get(sessionId)) {
      return;
    }
    store.setWaveSessionId(sessionId, waveSessionId);
  }

  async function resolveSessionGateway(
    sessionId: string,
    model: string,
  ): Promise<GatewayResolution> {
    const active = registry.getActive();
    const provider = registry.get(active.providerId);
    if (!provider) {
      throw new Error(`active provider not found: ${active.providerId}`);
    }
    if (!model) {
      throw new Error(`session ${sessionId} has no model`);
    }
    return provider.resolveGateway(model);
  }

  async function createAgentWithRestore(
    sessionId: string,
    workdir: string,
    gateway: GatewayResolution,
    restoreSessionId: string | undefined,
  ): Promise<SessionAgent> {
    const agentBox: { current: SessionAgent | null } = { current: null };

    const agent = await createAgent({
      apiKey: gateway.apiKey,
      baseURL: gateway.baseURL,
      defaultHeaders: gateway.defaultHeaders,
      fetch: gateway.fetch,
      model: gateway.model,
      logger: createAgentLogger({ home, sessionId }),
      // SDK requires fastModel (used for lightweight sub-tasks). Fall back to main model.
      fastModel: gateway.fastModel ?? gateway.model,
      workdir,
      stream: true,
      permissionMode:
        store.get(sessionId)?.permissionMode ?? "acceptEdits",
      restoreSessionId,
      ...(superpowersFlag() === "superpowers:on"
        ? {
            plugins: [
              {
                type: "local" as const,
                path: superpowersPluginDirIfPresent() as string,
              },
            ],
          }
        : {}),
      // Intentionally omit serverUrl to avoid Wave SSO.
      callbacks: {
        onSessionIdChange: (id) => {
          rememberWaveSessionId(sessionId, id);
        },
        onLoadingChange: (loading) => {
          if (disposed.has(sessionId)) return;
          bumpActivity(sessionId);
          agentLoading.set(sessionId, loading);
          hub.broadcast(sessionId, { type: "loading", loading });
          // Sidebar / status must track the full agent turn (including tools),
          // not the first assistant content stage "end".
          if (loading) {
            if (store.get(sessionId)?.status !== "running") {
              store.updateStatus(sessionId, "running");
              hub.broadcast(sessionId, {
                type: "session:status",
                status: "running",
              });
            }
          } else {
            reportEmptyTurnIfNeeded(sessionId);
            markIdle(sessionId);
          }
        },
        onAssistantMessageAdded: (messageId) => {
          if (disposed.has(sessionId)) return;
          markTurnOutput(sessionId);
          bumpActivity(sessionId);
          hub.broadcast(sessionId, { type: "assistant:message", messageId });
        },
        onUserMessageAdded: (params) => {
          if (disposed.has(sessionId)) return;
          // Meta messages (hook-injected system reminders) are not transcript
          // bubbles. Regular user messages surface here for queued sends whose
          // optimistic bubble was skipped while the AI was busy.
          if (params.isMeta) return;
          hub.broadcast(sessionId, {
            type: "user:message",
            content: params.content,
            images: params.images,
          });
        },
        onAssistantContentUpdated: ({ messageId, chunk, stage }) => {
          if (disposed.has(sessionId)) {
            return;
          }
          markTurnOutput(sessionId);
          bumpActivity(sessionId);
          hub.broadcast(sessionId, {
            type: "message:delta",
            messageId,
            text: chunk ?? "",
            stage,
          });
          if (stage === "end") {
            turnEnded.set(sessionId, true);
            hub.broadcast(sessionId, {
              type: "message:completed",
              messageId,
            });
            // Do not markIdle here: tools / follow-up rounds may still be loading.
          }
        },
        onAssistantReasoningUpdated: ({ messageId, chunk, stage }) => {
          if (disposed.has(sessionId)) return;
          markTurnOutput(sessionId);
          hub.broadcast(sessionId, {
            type: "reasoning:delta",
            messageId,
            text: chunk ?? "",
            stage,
          });
        },
        onToolBlockUpdated: (params) => {
          if (disposed.has(sessionId)) return;
          markTurnOutput(sessionId);
          bumpActivity(sessionId);
          rememberAgentTool(sessionId, params as Record<string, unknown>);
          hub.broadcast(sessionId, { type: "tool:update", params });
        },
        onErrorBlockAdded: (error) => {
          if (disposed.has(sessionId)) return;
          // User-initiated abort surfaces as "Request was aborted" — not a session error.
          if (isAbortError(error)) return;
          markTurnOutput(sessionId);
          // Compact / LLM errors are transcript blocks, not a dead session.
          // Ending the turn here would drop follow-up sends into the queue
          // while the SDK is still running (or hung on oversized context).
          hub.broadcast(sessionId, {
            type: "compaction:state",
            isCompacting: false,
          });
          hub.broadcast(sessionId, { type: "error:block", error });
        },
        onCompactionStateChange: (isCompacting) => {
          if (disposed.has(sessionId)) return;
          hub.broadcast(sessionId, {
            type: "compaction:state",
            isCompacting,
          });
        },
        onQueuedMessagesChange: (messages) => {
          if (disposed.has(sessionId)) return;
          hub.broadcast(sessionId, { type: "updateQueue", messages });
        },
        onCompactBlockAdded: () => {
          if (disposed.has(sessionId)) return;
          // Compaction truncates the SDK transcript; push the post-compact list.
          const messages =
            agentBox.current?.getMessages?.() ??
            agents.get(sessionId)?.getMessages?.();
          if (!messages) return;
          hub.broadcast(sessionId, {
            type: "messages:replace",
            messages: mapSdkMessages(messages),
          });
          hub.broadcast(sessionId, {
            type: "compaction:state",
            isCompacting: false,
          });
        },
        onSubagentAssistantMessageAdded: (subagentId, messageId) => {
          if (disposed.has(sessionId)) return;
          hub.broadcast(sessionId, {
            type: "subagent:assistant:message",
            subagentId,
            messageId,
          });
        },
        onSubagentAssistantContentUpdated: ({
          subagentId,
          messageId,
          chunk,
          stage,
        }) => {
          if (disposed.has(sessionId)) return;
          hub.broadcast(sessionId, {
            type: "subagent:message:delta",
            subagentId,
            messageId,
            text: chunk ?? "",
            stage,
          });
        },
        onSubagentAssistantReasoningUpdated: ({
          subagentId,
          messageId,
          chunk,
          stage,
        }) => {
          if (disposed.has(sessionId)) return;
          hub.broadcast(sessionId, {
            type: "subagent:reasoning:delta",
            subagentId,
            messageId,
            text: chunk ?? "",
            stage,
          });
        },
        onSubagentToolBlockUpdated: (subagentId, params) => {
          if (disposed.has(sessionId)) return;
          hub.broadcast(sessionId, {
            type: "subagent:tool:update",
            subagentId,
            params,
          });
        },
        onSubagentMessagesChange: (subagentId) => {
          if (disposed.has(sessionId)) return;
          // Bind the subagent id to the pending Agent tool call so history
          // view can load the transcript from disk. Live process display uses
          // the streaming callbacks (message:delta / tool:update etc), so the
          // full transcript is not broadcast anymore.
          rememberSubagentId(sessionId, subagentId);
        },
        onTasksChange: (tasks) => {
          if (disposed.has(sessionId)) return;
          latestTasks.set(sessionId, tasks);
          hub.broadcast(sessionId, { type: "tasks:update", tasks });
        },
        onBackgroundTasksChange: (tasks) => {
          if (disposed.has(sessionId)) return;
          const summaries = tasks.map(toBackgroundTaskSummary);
          latestBackgroundTasks.set(sessionId, summaries);
          hub.broadcast(sessionId, {
            type: "background-tasks:update",
            tasks: summaries,
          });
          const agent = agentBox.current ?? agents.get(sessionId);
          void Promise.resolve(agent?.getWorkflowRuns?.()).then((runs) => {
            if (disposed.has(sessionId) || !runs) return;
            const serialized = toSerializableWorkflowRuns(runs);
            latestWorkflowRuns.set(sessionId, serialized);
            hub.broadcast(sessionId, {
              type: "workflow-runs:update",
              runs: serialized,
            });
          });
        },
        onMcpServersChange: (servers) => {
          if (disposed.has(sessionId)) return;
          latestMcp.set(sessionId, servers);
          hub.broadcast(sessionId, { type: "mcp:update", servers });
        },
        onPermissionModeChange: (mode) => {
          if (disposed.has(sessionId)) return;
          const normalized =
            mode === "bypassPermissions" ? "bypassPermissions" : "acceptEdits";
          store.update(sessionId, { permissionMode: normalized });
          hub.broadcast(sessionId, {
            type: "permission-mode",
            mode: normalized,
          });
        },
        onLatestTotalTokensChange: (latestTotalTokens) => {
          if (disposed.has(sessionId)) return;
          latestTokens.set(sessionId, latestTotalTokens);
          hub.broadcast(sessionId, {
            type: "tokens:update",
            latestTotalTokens,
          });
        },
        onNotificationMessageAdded: () => {
          if (disposed.has(sessionId)) return;
          const agent = agentBox.current ?? agents.get(sessionId);
          void Promise.resolve(agent?.getWorkflowRuns?.()).then((runs) => {
            if (disposed.has(sessionId) || !runs) return;
            const serialized = toSerializableWorkflowRuns(runs);
            latestWorkflowRuns.set(sessionId, serialized);
            hub.broadcast(sessionId, {
              type: "workflow-runs:update",
              runs: serialized,
            });
          });
          void reconcileBackgroundTasks(sessionId).then((tasks) => {
            if (disposed.has(sessionId) || tasks.length === 0) return;
            hub.broadcast(sessionId, {
              type: "background-tasks:update",
              tasks,
            });
          });
        },
      },
      canUseTool: async (context) => {
        if (store.get(sessionId)?.permissionMode === "bypassPermissions") {
          return { behavior: "allow" as const };
        }
        clearIdleTimer(sessionId);
        clearStallTimer(sessionId);
        const permissionId = crypto.randomUUID();
        const toolInput =
          context.toolInput && typeof context.toolInput === "object"
            ? (context.toolInput as Record<string, unknown>)
            : undefined;
        const description =
          toolInput !== undefined
            ? `${context.toolName}: ${safeJson(toolInput)}`
            : `Request to use ${context.toolName}`;

        const request: Extract<WsEvent, { type: "permission:request" }> = {
          type: "permission:request",
          permissionId,
          toolName: context.toolName,
          description,
          toolInput,
          planContent: context.planContent,
          suggestedPrefix: context.suggestedPrefix,
          hidePersistentOption: context.hidePersistentOption,
          permissionMode: context.permissionMode,
          toolCallId: context.toolCallId,
        };
        const decisionPromise = new Promise<PermissionDecision>((resolve) => {
          pending.set(permissionId, { sessionId, resolve, request });
        });

        hub.broadcast(sessionId, request);

        const decision = await decisionPromise;
        bumpActivity(sessionId);
        return decision;
      },
    });

    agentBox.current = agent;
    return agent;
  }

  function rearmIdleIfNeeded(sessionId: string): void {
    if (canIdleDestroy(sessionId)) {
      scheduleIdleDestroy(sessionId);
    }
  }

  async function ensureAgent(sessionId: string): Promise<SessionAgent> {
    clearIdleTimer(sessionId);
    const session = store.get(sessionId);
    if (!session) {
      throw Object.assign(new Error(`session not found: ${sessionId}`), {
        statusCode: 404,
      });
    }
    if (disposed.has(sessionId)) {
      throw Object.assign(new Error(`session disposed: ${sessionId}`), {
        statusCode: 404,
      });
    }

    const gateway = await resolveSessionGateway(sessionId, session.model);
    const identity = gatewayIdentity(gateway);
    const existing = agents.get(sessionId);
    if (existing) {
      if (agentIdentities.get(sessionId) === identity) {
        // getMessages / idle ensureAgent cleared the timer — re-arm if still idle.
        rearmIdleIfNeeded(sessionId);
        return existing;
      }
      // Stale identity (provider / ~/.wave/settings.json change). Recreate only
      // when the agent is not mid-turn — an in-flight turn keeps its live agent.
      // Note: not `canIdleDestroy` (its status=running check would always veto
      // during runTurn, where status is set to "running" before ensureAgent).
      if (
        hasPendingPermission(sessionId) ||
        agentLoading.get(sessionId) === true ||
        existing.hasPendingMessages?.()
      ) {
        rearmIdleIfNeeded(sessionId);
        return existing;
      }
      agents.delete(sessionId);
      agentIdentities.delete(sessionId);
      await existing.dispose();
    }
    if (disposed.has(sessionId)) {
      throw Object.assign(new Error(`session disposed: ${sessionId}`), {
        statusCode: 404,
      });
    }

    const restoreId = store.get(sessionId)?.waveSessionId;
    let agent: SessionAgent;
    try {
      agent = await createAgentWithRestore(
        sessionId,
        session.workdir,
        gateway,
        restoreId,
      );
    } catch (err) {
      if (!restoreId) {
        throw err;
      }
      // Restore failed (missing/corrupt jsonl etc.) → create fresh agent.
      agent = await createAgentWithRestore(
        sessionId,
        session.workdir,
        gateway,
        undefined,
      );
    }

    if (disposed.has(sessionId)) {
      await agent.dispose();
      throw Object.assign(new Error(`session disposed: ${sessionId}`), {
        statusCode: 404,
      });
    }

    rememberWaveSessionId(sessionId, agent.sessionId);
    agents.set(sessionId, agent);
    agentIdentities.set(sessionId, identity);
    rearmIdleIfNeeded(sessionId);
    return agent;
  }

  async function handleUnauthorized(sessionId: string): Promise<void> {
    getLogger().warn("turn unauthorized", { sessionId });
    store.updateStatus(sessionId, "error");
    hub.broadcast(sessionId, {
      type: "session:status",
      status: "error",
      error: "Unauthorized",
    });

    const active = registry.getActive();
    const provider = registry.get(active.providerId);
    if (provider) {
      const status = await provider.getAuthStatus();
      hub.broadcast(sessionId, { type: "auth:changed", status });
    } else {
      hub.broadcast(sessionId, {
        type: "auth:changed",
        status: {
          state: "unauthenticated",
          providerId: active.providerId,
        },
      });
    }

    // Auth failures should not permanently block the session.
    if (store.get(sessionId)) {
      store.updateStatus(sessionId, "idle");
      hub.broadcast(sessionId, { type: "session:status", status: "idle" });
      markUnreadDoneIfInactive(sessionId);
      scheduleIdleDestroy(sessionId);
    }
  }

  function maybeUpdateTitle(sessionId: string, content: string): void {
    const session = store.get(sessionId);
    if (!session || session.title !== DEFAULT_TITLE) {
      return;
    }
    const trimmed = content.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      return;
    }
    const title =
      trimmed.length > TITLE_MAX_LEN
        ? `${trimmed.slice(0, TITLE_MAX_LEN)}…`
        : trimmed;
    store.update(sessionId, { title });
  }

  /** Strip surrounding quotes/punct from an AI title; clamp to TITLE_MAX_LEN. */
  function cleanAiTitle(summary: string): string {
    const trimmed = summary.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      return "";
    }
    const unquoted = trimmed
      .replace(/^["'“”‘’「『]+/, "")
      .replace(/["'“”‘’」』]+$/, "")
      .trim();
    if (!unquoted) {
      return "";
    }
    return unquoted.length > TITLE_MAX_LEN
      ? `${unquoted.slice(0, TITLE_MAX_LEN)}…`
      : unquoted;
  }

  const titleGenerating = new Set<string>();

  /**
   * Replace the truncated placeholder title with an AI-summarized one.
   * Fire-and-forget from runTurn; falls back to truncation on failure.
   */
  async function maybeGenerateAiTitle(
    sessionId: string,
    content: string,
    agent: SessionAgent,
  ): Promise<void> {
    if (titleGenerating.has(sessionId)) {
      return;
    }
    const session = store.get(sessionId);
    if (!session || session.title !== DEFAULT_TITLE) {
      return;
    }
    if (!agent.askBtw) {
      maybeUpdateTitle(sessionId, content);
      return;
    }
    titleGenerating.add(sessionId);
    try {
      const summary = await agent.askBtw(
        `根据下面的用户消息，用一句话概括这个会话的主题，作为会话标题。直接输出标题本身，使用与用户消息相同的语言，不要引号、不要解释、不要句号，不超过 ${TITLE_MAX_LEN} 字。\n\n用户消息：\n${content}`,
      );
      const title = cleanAiTitle(summary);
      if (!title) {
        return;
      }
      // Do not overwrite a title the user renamed while we were generating.
      const current = store.get(sessionId);
      if (!current || current.title !== DEFAULT_TITLE) {
        return;
      }
      store.update(sessionId, { title });
      hub.broadcast(sessionId, { type: "session:titled", sessionId, title });
    } catch {
      maybeUpdateTitle(sessionId, content);
    } finally {
      titleGenerating.delete(sessionId);
    }
  }

  async function runTurn(
    sessionId: string,
    content: string,
    images?: SessionImage[],
  ): Promise<void> {
    const session = store.get(sessionId);
    if (!session || disposed.has(sessionId)) {
      return;
    }

    clearIdleTimer(sessionId);
    store.update(sessionId, { lastActiveAt: Date.now() });
    store.updateStatus(sessionId, "running");
    hub.broadcast(sessionId, { type: "session:status", status: "running" });
    turnEnded.set(sessionId, false);
    turnHadOutput.set(sessionId, false);
    agentLoading.set(sessionId, false);
    bumpActivity(sessionId);
    getLogger().info("turn started", {
      sessionId,
      model: session.model,
      chars: content.length,
      images: images?.length ?? 0,
    });

    try {
      const agent = await ensureAgent(sessionId);
      // Fire-and-forget AI title generation on the first message; the truncation
      // fallback (maybeUpdateTitle) applies when askBtw is unavailable or fails.
      void maybeGenerateAiTitle(sessionId, content, agent);
      // Persist pasted screenshots to a temp dir so the model can read them
      // via its tools, then point at them with [Image source: ...] markers.
      // The base64 images are still forwarded unchanged for vision.
      const imagePaths = await saveBase64Images(
        images?.map((img) => ({ data: img.path, mediaType: img.mimeType })) ??
          [],
      );
      const contentWithSources = appendImageSourceMarkers(
        content,
        imagePaths,
      );
      await agent.sendMessage(contentWithSources, images);
      // Fallback when SDK never toggles onLoadingChange (tests / swallowed turns).
      // If loading is still true, tools/stream are in flight — wait for loading false.
      if (
        !disposed.has(sessionId) &&
        store.get(sessionId)?.status === "running" &&
        agentLoading.get(sessionId) !== true
      ) {
        reportEmptyTurnIfNeeded(sessionId);
        if (!turnEnded.get(sessionId)) {
          hub.broadcast(sessionId, { type: "message:completed" });
        }
        getLogger().info("turn completed", { sessionId });
        markIdle(sessionId);
      }
    } catch (err) {
      if (disposed.has(sessionId) || !store.get(sessionId)) {
        return;
      }
      if (isAbortError(err)) {
        agentLoading.set(sessionId, false);
        if (!turnEnded.get(sessionId)) {
          hub.broadcast(sessionId, { type: "message:completed" });
        }
        getLogger().info("turn aborted", { sessionId });
        markIdle(sessionId);
        return;
      }
      if (isUnauthorized(err)) {
        await handleUnauthorized(sessionId);
        return;
      }
      finishTurnError(sessionId, err);
    } finally {
      // No server-side drain: the SDK serializes queued sends via its own queue.
    }
  }

  function denyPendingPermissions(sessionId: string, message: string): void {
    for (const [id, entry] of pending) {
      if (entry.sessionId !== sessionId) continue;
      pending.delete(id);
      entry.resolve({ behavior: "deny", message });
    }
  }

  return {
    async sendMessage(sessionId, content, images) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }

      const sdkImages = toSdkImages(images);
      if (!content.trim() && !sdkImages?.length) {
        throw Object.assign(new Error("content or images is required"), {
          statusCode: 400,
        });
      }

      // Fire-and-forget so HTTP can return { accepted: true } promptly.
      // If a turn is already in flight, the SDK enqueues the message internally
      // and dispatches it once loading drops (its own serialized queue).
      void runTurn(sessionId, content, sdkImages);

      return { accepted: true };
    },

    async abortMessage(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }

      interruptTurn(sessionId, { denyMessage: "Aborted by user" });

      return { ok: true };
    },

    async deleteQueuedMessageById(sessionId, messageId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const agent = agents.get(sessionId);
      if (!agent?.removeQueuedMessageById) {
        return { ok: false };
      }
      const removed = agent.removeQueuedMessageById(messageId);
      return { ok: removed };
    },

    async updateQueuedMessage(sessionId, messageId, patch) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const agent = agents.get(sessionId);
      if (!agent?.updateQueuedMessageById) {
        return { ok: false };
      }
      const sdkPatch: { content?: string; images?: SessionImage[] } = {};
      if (typeof patch.content === "string") {
        sdkPatch.content = patch.content;
      }
      const sdkImages = toSdkImages(patch.images);
      if (sdkImages) {
        sdkPatch.images = sdkImages;
      }
      const updated = agent.updateQueuedMessageById(messageId, sdkPatch);
      return { ok: updated };
    },

    async getRuntimeState(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const agent = agents.get(sessionId);
      return {
        loading: agent?.isLoading?.() ?? agentLoading.get(sessionId) ?? false,
        queuedMessages: agent?.queuedMessages?.() ?? [],
      };
    },

    async respondPermission(sessionId, permissionId, decision) {
      const entry = pending.get(permissionId);
      if (!entry || entry.sessionId !== sessionId) {
        throw Object.assign(new Error(`permission not found: ${permissionId}`), {
          statusCode: 404,
        });
      }
      pending.delete(permissionId);
      const behavior =
        decision.behavior === "deny" || decision.behavior === "allow"
          ? decision.behavior
          : "deny";
      entry.resolve({
        behavior,
        message:
          decision.message ??
          (behavior === "deny" ? "Denied by user" : undefined),
        newPermissionMode: decision.newPermissionMode,
        newPermissionRule: decision.newPermissionRule,
      });
      return { ok: true };
    },

    async disposeSession(sessionId) {
      disposed.add(sessionId);
      clearIdleTimer(sessionId);
      clearStallTimer(sessionId);
      turnEnded.delete(sessionId);
      turnHadOutput.delete(sessionId);
      aborting.delete(sessionId);
      agentLoading.delete(sessionId);
      titleGenerating.delete(sessionId);
      closeAgentLogger(sessionId);
      agentToolBinds.delete(sessionId);
      pendingAgentToolIds.delete(sessionId);
      unboundSubagentIds.delete(sessionId);
      knownAgentToolIds.delete(sessionId);
      latestTasks.delete(sessionId);
      latestBackgroundTasks.delete(sessionId);
      latestWorkflowRuns.delete(sessionId);
      latestMcp.delete(sessionId);
      latestTokens.delete(sessionId);
      for (const [id, entry] of pending) {
        if (entry.sessionId === sessionId) {
          pending.delete(id);
          entry.resolve({
            behavior: "deny",
            message: "Session disposed",
          });
        }
      }
      const agent = agents.get(sessionId);
      agents.delete(sessionId);
      agentIdentities.delete(sessionId);
      if (agent) {
        await agent.dispose();
      }
      store.delete(sessionId);
    },

    async getMessages(sessionId) {
      clearIdleTimer(sessionId);
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const agent = await ensureAgent(sessionId);
      // ensureAgent re-arms on success; re-arm again in case only clearIdleTimer ran.
      rearmIdleIfNeeded(sessionId);
      return attachNestedMessages(
        sessionId,
        session.workdir,
        mapSdkMessages(agent.getMessages?.() ?? []),
      );
    },

    async compact(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      if (session.status === "running") {
        interruptTurn(sessionId, { denyMessage: "Aborted for compact" });
      }
      const agent = await ensureAgent(sessionId);
      if (!agent.compact) {
        throw Object.assign(new Error("compact is not supported"), {
          statusCode: 501,
        });
      }
      try {
        await agent.compact();
        return { ok: true as const };
      } finally {
        hub.broadcast(sessionId, {
          type: "compaction:state",
          isCompacting: false,
        });
      }
    },

    async clear(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      if (session.status === "running") {
        throw Object.assign(new Error("session is running"), {
          statusCode: 409,
        });
      }
      const agent = await ensureAgent(sessionId);
      if (!agent.clearMessages) {
        throw Object.assign(new Error("clear is not supported"), {
          statusCode: 501,
        });
      }
      await agent.clearMessages();
      hub.broadcast(sessionId, {
        type: "messages:replace",
        messages: [],
      });
      return { ok: true as const };
    },

    async listRewindCheckpoints(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const agent = await ensureAgent(sessionId);
      const messages = agent.getMessages?.() ?? [];
      return messages.flatMap((message) => {
        if (!isRewindTargetMessage(message)) return [];
        const id = (message as { id: string }).id;
        return [{ id, content: userMessageText(message) }];
      });
    },

    async rewind(sessionId, messageId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      if (session.status === "running") {
        interruptTurn(sessionId, { denyMessage: "Aborted for rewind" });
      }
      const agent = await ensureAgent(sessionId);
      const messages = agent.getMessages?.() ?? [];
      const index = messages.findIndex(
        (message) =>
          isRewindTargetMessage(message) &&
          (message as { id: string }).id === messageId,
      );
      if (index < 0) {
        throw Object.assign(new Error(`checkpoint not found: ${messageId}`), {
          statusCode: 404,
        });
      }
      if (!agent.truncateHistory) {
        throw Object.assign(new Error("rewind is not supported"), {
          statusCode: 501,
        });
      }
      const inputContent = userMessageText(messages[index]);
      await agent.truncateHistory(index);
      const next = mapSdkMessages(agent.getMessages?.() ?? []);
      hub.broadcast(sessionId, { type: "messages:replace", messages: next });
      return { ok: true as const, inputContent };
    },

    async setPermissionMode(sessionId, mode) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const normalized =
        mode === "bypassPermissions" ? "bypassPermissions" : "acceptEdits";
      store.update(sessionId, { permissionMode: normalized });
      const existing = agents.get(sessionId);
      existing?.setPermissionMode?.(normalized);
      hub.broadcast(sessionId, {
        type: "permission-mode",
        mode: normalized,
      });
      return { ok: true as const, mode: normalized };
    },

    async getStatus(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const agent = agents.get(sessionId);
      const latestTotalTokens =
        latestTokens.get(sessionId) ?? agent?.latestTotalTokens ?? 0;
      return {
        sessionId: session.id,
        workdir: session.workdir,
        permissionMode: session.permissionMode,
        latestTotalTokens,
        waveSessionId: session.waveSessionId,
      };
    },

    async getMcpServers(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const cached = latestMcp.get(sessionId);
      if (cached) return cached;
      const existing = agents.get(sessionId);
      if (existing?.getMcpServers) {
        const servers = existing.getMcpServers() ?? [];
        latestMcp.set(sessionId, servers);
        return servers;
      }
      try {
        const agent = await ensureAgent(sessionId);
        const servers = agent.getMcpServers?.() ?? [];
        latestMcp.set(sessionId, servers);
        return servers;
      } catch {
        return [];
      }
    },

    async connectMcpServer(sessionId, name) {
      const agent = await ensureAgent(sessionId);
      const ok = (await agent.connectMcpServer?.(name)) ?? false;
      const servers = agent.getMcpServers?.() ?? [];
      latestMcp.set(sessionId, servers);
      hub.broadcast(sessionId, { type: "mcp:update", servers });
      return { ok };
    },

    async disconnectMcpServer(sessionId, name) {
      const agent = await ensureAgent(sessionId);
      const ok = (await agent.disconnectMcpServer?.(name)) ?? false;
      const servers = agent.getMcpServers?.() ?? [];
      latestMcp.set(sessionId, servers);
      hub.broadcast(sessionId, { type: "mcp:update", servers });
      return { ok };
    },

    async getBackgroundTaskOutput(sessionId, taskId) {
      const agent = await ensureAgent(sessionId);
      return agent.getBackgroundTaskOutput?.(taskId) ?? null;
    },

    async getBackgroundTasks(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      return reconcileBackgroundTasks(sessionId);
    },

    // 任务列表只在会话执行中展示：idle 会话返回空，避免切换回已结束的会话时
    // 展示历史遗留任务。活跃判断与 snapshotEvents 保持一致。
    async getTasks(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const loadingNow = agentLoading.get(sessionId) === true;
      const pendingReq = [...pending.values()].some(
        (entry) => entry.sessionId === sessionId,
      );
      if (session.status === "idle" && !loadingNow && !pendingReq) {
        return [];
      }
      return latestTasks.get(sessionId) ?? [];
    },

    async stopBackgroundTask(sessionId, taskId) {
      const agent = await ensureAgent(sessionId);
      const ok = agent.stopBackgroundTask?.(taskId) ?? false;
      return { ok };
    },

    async getWorkflowRuns(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const existing = agents.get(sessionId);
      if (existing?.getWorkflowRuns) {
        const raw = (await existing.getWorkflowRuns()) ?? [];
        const runs = toSerializableWorkflowRuns(raw);
        latestWorkflowRuns.set(sessionId, runs);
        return runs;
      }
      const cached = latestWorkflowRuns.get(sessionId);
      if (cached) return cached;
      const agent = await ensureAgent(sessionId);
      const raw = (await agent.getWorkflowRuns?.()) ?? [];
      const runs = toSerializableWorkflowRuns(raw);
      latestWorkflowRuns.set(sessionId, runs);
      return runs;
    },

    async stopWorkflowRun(sessionId, runId) {
      const agent = await ensureAgent(sessionId);
      agent.stopWorkflowRun?.(runId);
      return { ok: true as const };
    },

    invalidateAgentIdentities() {
      agentIdentities.clear();
    },

    snapshotEvents() {
      const events: WsBroadcastEvent[] = [];
      for (const session of store.list()) {
        if (disposed.has(session.id)) continue;
        const loadingNow = agentLoading.get(session.id) === true;
        const pendingReq = [...pending.values()].find(
          (entry) => entry.sessionId === session.id,
        );
        if (session.status === "idle" && !loadingNow && !pendingReq) {
          continue;
        }
        if (session.status !== "idle") {
          events.push({
            type: "session:status",
            status: session.status,
            sessionId: session.id,
          });
        }
        if (loadingNow) {
          events.push({
            type: "loading",
            loading: true,
            sessionId: session.id,
          });
        }
        if (pendingReq) {
          events.push({ ...pendingReq.request, sessionId: session.id });
        }
        const tasks = latestTasks.get(session.id);
        if (tasks && tasks.length > 0) {
          events.push({ type: "tasks:update", tasks, sessionId: session.id });
        }
        const background = latestBackgroundTasks.get(session.id);
        if (background && background.length > 0) {
          events.push({
            type: "background-tasks:update",
            tasks: background,
            sessionId: session.id,
          });
        }
        const runs = latestWorkflowRuns.get(session.id);
        if (runs && runs.length > 0) {
          events.push({
            type: "workflow-runs:update",
            runs,
            sessionId: session.id,
          });
        }
        const mcp = latestMcp.get(session.id);
        if (mcp && mcp.length > 0) {
          events.push({ type: "mcp:update", servers: mcp, sessionId: session.id });
        }
        const tokens = latestTokens.get(session.id);
        if (typeof tokens === "number") {
          events.push({
            type: "tokens:update",
            latestTotalTokens: tokens,
            sessionId: session.id,
          });
        }
        events.push({
          type: "permission-mode",
          mode: session.permissionMode,
          sessionId: session.id,
        });
      }
      return events;
    },

    async abortRunningTurns(reason) {
      let aborted = 0;
      for (const session of store.list()) {
        if (session.status !== "running") continue;
        if (hasPendingPermission(session.id)) continue;
        interruptTurn(session.id, { error: reason });
        aborted += 1;
      }
      return { aborted };
    },

    async shutdown() {
      let aborted = 0;
      for (const session of store.list()) {
        if (session.status !== "running") continue;
        interruptTurn(session.id, {
          error: "Server shutting down",
          denyMessage: "Server shutting down",
        });
        aborted += 1;
      }
      return { aborted };
    },

    getAgentCount() {
      return agents.size;
    },
  };
}

function toSerializableWorkflowRuns(runs: unknown): unknown[] {
  const list = Array.isArray(runs) ? runs : [];
  return list.map((run) => {
    if (!run || typeof run !== "object") return run;
    const { completionPromise: _drop, ...rest } = run as Record<
      string,
      unknown
    >;
    const phases = Array.isArray(rest.phases) ? rest.phases : [];
    const meta =
      rest.meta && typeof rest.meta === "object"
        ? rest.meta
        : { name: "", description: "" };
    return { ...rest, phases, meta };
  });
}

function toBackgroundTaskSummary(task: {
  id?: string;
  type?: string;
  status?: string;
  startTime?: number;
  endTime?: number;
  command?: string;
  description?: string;
  exitCode?: number;
  runtime?: number;
  outputPath?: string;
}): Record<string, unknown> {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    startTime: task.startTime,
    ...(task.endTime !== undefined ? { endTime: task.endTime } : {}),
    ...(task.command !== undefined ? { command: task.command } : {}),
    ...(task.description !== undefined ? { description: task.description } : {}),
    ...(task.exitCode !== undefined ? { exitCode: task.exitCode } : {}),
    ...(task.runtime !== undefined ? { runtime: task.runtime } : {}),
    ...(task.outputPath !== undefined ? { outputPath: task.outputPath } : {}),
  };
}

function isRewindTargetMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const m = message as {
    role?: string;
    isMeta?: boolean;
    id?: string;
    blocks?: Array<{ type?: string; source?: string }>;
  };
  if (m.role !== "user" || m.isMeta || typeof m.id !== "string" || !m.id) {
    return false;
  }
  const blocks = Array.isArray(m.blocks) ? m.blocks : [];
  if (blocks.some((block) => block.type === "bang")) return false;
  if (blocks.some((block) => block.type === "task_notification")) return false;
  if (blocks.some((block) => block.type === "text" && block.source === "hook")) {
    return false;
  }
  return true;
}

function userMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const blocks = (message as { blocks?: Array<{ type?: string; content?: string }> })
    .blocks;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => block.type === "text" || block.type === "compact")
    .map((block) => block.content || "")
    .join("")
    .trim();
}

function isUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as {
    status?: number;
    statusCode?: number;
    message?: string;
  };
  if (e.status === 401 || e.statusCode === 401) {
    return true;
  }
  if (typeof e.message === "string" && /\b401\b|unauthorized/i.test(e.message)) {
    return true;
  }
  return false;
}

function isAbortError(err: unknown): boolean {
  if (typeof err === "string") {
    return /aborted/i.test(err);
  }
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as { name?: string; message?: string };
  if (e.name === "AbortError") {
    return true;
  }
  return typeof e.message === "string" && /aborted/i.test(e.message);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
