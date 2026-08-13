import { Agent, type AgentOptions, type PermissionDecision } from "wave-agent-sdk";
import {
  loadProvidersConfig,
  type GatewayResolution,
  type ProviderRegistry,
} from "@muse-work/provider";
import type { SessionStore } from "./sessionStore.js";
import type { WsBroadcastEvent, WsEvent, WsHub } from "./wsHub.js";
import { getLogger } from "./logger.js";
import {
  patchAgentSystemPrompt,
  MUSE_BASE_SYSTEM_PROMPT,
  MUSE_IDENTITY_REV,
} from "./museSystemPrompt.js";
import { mapSdkMessages } from "./messageMapper.js";
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

export const AGENT_IDLE_TTL_MS = 10 * 60 * 1000;
/** Abort a running turn after this long with no SDK callbacks. */
export const TURN_STALL_MS = 5 * 60 * 1000;
const DEFAULT_TITLE = "新对话";
const TITLE_MAX_LEN = 40;

export type SessionImage = { path: string; mimeType: string };

export interface SessionAgent {
  sendMessage(content: string, images?: SessionImage[]): Promise<void>;
  dispose(): Promise<void>;
  /** Interrupt in-flight AI / tools / bash (SDK abortMessage). */
  abortMessage?: () => void;
  /** Optional SDK message snapshot (used after compaction). */
  getMessages?: () => unknown[];
  /** Wave session id when available (SDK agent or test stub). */
  sessionId?: string;
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
}

interface QueuedTurn {
  content: string;
  images?: SessionImage[];
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
      abortMessage: () => agent.abortMessage(),
      // SDK exposes destroy(); brief uses dispose as our session lifecycle hook.
      dispose: () => agent.destroy(),
      getMessages: () => agent.messages,
      sessionId: agent.sessionId,
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
  /** Messages accepted while a turn is in flight (avoid HTTP 409). */
  const messageQueues = new Map<string, QueuedTurn[]>();
  /** Per-session flag: current turn already received assistant stage "end". */
  const turnEnded = new Map<string, boolean>();
  /** Latest SDK onLoadingChange; used so we don't mark idle while tools still run. */
  const agentLoading = new Map<string, boolean>();
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const stallTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const subagentTranscripts = new Map<string, Map<string, unknown[]>>();
  const agentToolBinds = new Map<string, Map<string, string>>();
  const pendingAgentToolIds = new Map<string, string[]>();
  const unboundSubagentIds = new Map<string, string[]>();
  const knownAgentToolIds = new Map<string, Set<string>>();

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

  function rememberTranscript(
    sessionId: string,
    subagentId: string,
    messages: unknown[],
  ): void {
    const transcripts =
      subagentTranscripts.get(sessionId) ?? new Map<string, unknown[]>();
    transcripts.set(subagentId, messages);
    subagentTranscripts.set(sessionId, transcripts);
    const boundIds = [...(agentToolBinds.get(sessionId)?.values() ?? [])];
    const unbound = unboundSubagentIds.get(sessionId) ?? [];
    if (!boundIds.includes(subagentId) && !unbound.includes(subagentId)) {
      unbound.push(subagentId);
      unboundSubagentIds.set(sessionId, unbound);
    }
    bindAgentTools(sessionId);
  }

  function attachNestedMessages(
    sessionId: string,
    messages: unknown[],
  ): unknown[] {
    const transcripts = subagentTranscripts.get(sessionId);
    if (!transcripts) return messages;
    const binds = agentToolBinds.get(sessionId);
    return messages.map((message) => {
      if (!message || typeof message !== "object") return message;
      const blocks = (message as { blocks?: unknown[] }).blocks;
      if (!Array.isArray(blocks)) return message;
      return {
        ...(message as Record<string, unknown>),
        blocks: blocks.map((block) => {
          if (!block || typeof block !== "object") return block;
          const tool = block as { type?: string; name?: string; id?: string };
          if (tool.type !== "tool" || tool.name !== AGENT_TOOL_NAME) {
            return block;
          }
          const subagentId = (tool.id && binds?.get(tool.id)) || tool.id;
          const nested =
            (subagentId ? transcripts.get(subagentId) : undefined) ||
            (tool.id ? transcripts.get(tool.id) : undefined);
          if (!nested) return block;
          return { ...tool, nestedMessages: nested };
        }),
      };
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

  function interruptTurn(
    sessionId: string,
    opts: { error?: string; denyMessage?: string } = {},
  ): void {
    denyPendingPermissions(
      sessionId,
      opts.denyMessage ?? opts.error ?? "Aborted",
    );
    clearStallTimer(sessionId);
    agents.get(sessionId)?.abortMessage?.();
    agentLoading.set(sessionId, false);
    hub.broadcast(sessionId, { type: "loading", loading: false });
    if (!turnEnded.get(sessionId)) {
      hub.broadcast(sessionId, { type: "message:completed" });
      turnEnded.set(sessionId, true);
    }
    if (opts.error) {
      finishTurnError(sessionId, new Error(opts.error));
    } else {
      markIdle(sessionId);
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
    const queue = messageQueues.get(sessionId);
    if (queue && queue.length > 0) {
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
    agentLoading.delete(sessionId);
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
    if (store.get(sessionId)?.status === "running") {
      store.updateStatus(sessionId, "idle");
      hub.broadcast(sessionId, { type: "session:status", status: "idle" });
    }

    markUnreadDoneIfInactive(sessionId);
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
    // Allow the next queued message after a failed turn.
    store.updateStatus(sessionId, "idle");
    hub.broadcast(sessionId, { type: "session:status", status: "idle" });
    markUnreadDoneIfInactive(sessionId);
    scheduleIdleDestroy(sessionId);
  }

  async function drainQueue(sessionId: string): Promise<void> {
    if (disposed.has(sessionId)) {
      messageQueues.delete(sessionId);
      return;
    }
    const session = store.get(sessionId);
    if (!session || session.status === "running") {
      return;
    }
    const queue = messageQueues.get(sessionId);
    if (!queue || queue.length === 0) {
      return;
    }
    const next = queue.shift()!;
    if (queue.length === 0) {
      messageQueues.delete(sessionId);
    }
    await runTurn(sessionId, next.content, next.images);
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
      // SDK requires fastModel (used for lightweight sub-tasks). Fall back to main model.
      fastModel: gateway.fastModel ?? gateway.model,
      workdir,
      stream: true,
      // MVP: auto-accept file edits; UI selector is hidden for now.
      permissionMode: "acceptEdits",
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
            markIdle(sessionId);
          }
        },
        onAssistantMessageAdded: (messageId) => {
          if (disposed.has(sessionId)) return;
          bumpActivity(sessionId);
          hub.broadcast(sessionId, { type: "assistant:message", messageId });
        },
        onAssistantContentUpdated: ({ messageId, chunk, stage }) => {
          if (disposed.has(sessionId)) {
            return;
          }
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
          hub.broadcast(sessionId, {
            type: "reasoning:delta",
            messageId,
            text: chunk ?? "",
            stage,
          });
        },
        onToolBlockUpdated: (params) => {
          if (disposed.has(sessionId)) return;
          bumpActivity(sessionId);
          rememberAgentTool(sessionId, params as Record<string, unknown>);
          hub.broadcast(sessionId, { type: "tool:update", params });
        },
        onErrorBlockAdded: (error) => {
          if (disposed.has(sessionId)) return;
          // User-initiated abort surfaces as "Request was aborted" — not a session error.
          if (isAbortError(error)) return;
          hub.broadcast(sessionId, {
            type: "session:status",
            status: "error",
            error,
          });
        },
        onCompactionStateChange: (isCompacting) => {
          if (disposed.has(sessionId)) return;
          hub.broadcast(sessionId, {
            type: "compaction:state",
            isCompacting,
          });
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
        onSubagentMessagesChange: (subagentId, messages) => {
          if (disposed.has(sessionId)) return;
          const snapshot = mapSdkMessages(messages);
          rememberTranscript(sessionId, subagentId, snapshot);
          hub.broadcast(sessionId, {
            type: "subagent:messages",
            subagentId,
            messages: snapshot,
          });
        },
      },
      canUseTool: async (context) => {
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

  async function runTurn(
    sessionId: string,
    content: string,
    images?: SessionImage[],
  ): Promise<void> {
    const session = store.get(sessionId);
    if (!session || disposed.has(sessionId)) {
      return;
    }
    if (session.status === "running") {
      // Should not happen; queue instead of overlapping turns.
      const queue = messageQueues.get(sessionId) ?? [];
      queue.push({ content, images });
      messageQueues.set(sessionId, queue);
      return;
    }

    clearIdleTimer(sessionId);
    store.update(sessionId, { lastActiveAt: Date.now() });
    maybeUpdateTitle(sessionId, content);
    store.updateStatus(sessionId, "running");
    hub.broadcast(sessionId, { type: "session:status", status: "running" });
    turnEnded.set(sessionId, false);
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
      await agent.sendMessage(content, images);
      // Fallback when SDK never toggles onLoadingChange (tests / swallowed turns).
      // If loading is still true, tools/stream are in flight — wait for loading false.
      if (
        !disposed.has(sessionId) &&
        store.get(sessionId)?.status === "running" &&
        agentLoading.get(sessionId) !== true
      ) {
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
      // Drain only after this turn's sendMessage has settled (avoids overlapping turns).
      void drainQueue(sessionId);
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

      if (session.status === "running") {
        const queue = messageQueues.get(sessionId) ?? [];
        queue.push({ content, images: sdkImages });
        messageQueues.set(sessionId, queue);
        clearIdleTimer(sessionId);
        return { accepted: true };
      }

      // Fire-and-forget so HTTP can return { accepted: true } promptly.
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
      messageQueues.delete(sessionId);
      turnEnded.delete(sessionId);
      agentLoading.delete(sessionId);
      subagentTranscripts.delete(sessionId);
      agentToolBinds.delete(sessionId);
      pendingAgentToolIds.delete(sessionId);
      unboundSubagentIds.delete(sessionId);
      knownAgentToolIds.delete(sessionId);
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
        mapSdkMessages(agent.getMessages?.() ?? []),
      );
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
  };
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
