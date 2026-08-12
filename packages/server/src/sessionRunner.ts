import { Agent, type AgentOptions, type PermissionDecision } from "wave-agent-sdk";
import type { GatewayResolution, ProviderRegistry } from "@muse-work/provider";
import type { SessionStore } from "./sessionStore.js";
import type { WsHub } from "./wsHub.js";
import {
  patchAgentSystemPrompt,
  MUSE_BASE_SYSTEM_PROMPT,
} from "./museSystemPrompt.js";

export interface SessionAgent {
  sendMessage(content: string): Promise<void>;
  dispose(): Promise<void>;
  /** Optional SDK message snapshot (used after compaction). */
  getMessages?: () => unknown[];
}

export type CreateAgent = (options: AgentOptions) => Promise<SessionAgent>;

export interface SessionRunner {
  sendMessage(sessionId: string, content: string): Promise<{ accepted: true }>;
  respondPermission(
    sessionId: string,
    permissionId: string,
    decision: "allow" | "deny",
  ): Promise<{ ok: true }>;
  disposeSession(sessionId: string): Promise<void>;
  getMessages(sessionId: string): Promise<unknown[]>;
}

interface PendingPermission {
  sessionId: string;
  resolve: (decision: PermissionDecision) => void;
}

export interface CreateSessionRunnerOptions {
  store: SessionStore;
  hub: WsHub;
  registry: ProviderRegistry;
  createAgent?: CreateAgent;
}

export function defaultCreateAgent(options: AgentOptions): Promise<SessionAgent> {
  return Agent.create({
    ...options,
    systemPrompt: options.systemPrompt ?? MUSE_BASE_SYSTEM_PROMPT,
  }).then((agent) => {
    patchAgentSystemPrompt(agent as unknown as Parameters<typeof patchAgentSystemPrompt>[0]);
    return {
      sendMessage: (content: string) => agent.sendMessage(content),
      // SDK exposes destroy(); brief uses dispose as our session lifecycle hook.
      dispose: () => agent.destroy(),
      getMessages: () => agent.messages,
    };
  });
}

export function createSessionRunner(
  options: CreateSessionRunnerOptions,
): SessionRunner {
  const { store, hub, registry } = options;
  const createAgent = options.createAgent ?? defaultCreateAgent;
  const agents = new Map<string, SessionAgent>();
  /** Gateway identity used when the session agent was created (model switch → recreate). */
  const agentIdentities = new Map<string, string>();
  const pending = new Map<string, PendingPermission>();
  /** Session IDs that were disposed; late createAgent completions must not revive them. */
  const disposed = new Set<string>();
  /** Messages accepted while a turn is in flight (avoid HTTP 409). */
  const messageQueues = new Map<string, string[]>();
  /** Per-session flag: current turn already received assistant stage "end". */
  const turnEnded = new Map<string, boolean>();

  function gatewayIdentity(gateway: GatewayResolution): string {
    const credential =
      gateway.credentialFingerprint ?? gateway.apiKey ?? "";
    return [
      gateway.baseURL,
      gateway.model,
      credential,
      gateway.fastModel ?? "",
    ].join("\0");
  }

  function markIdle(sessionId: string): void {
    if (disposed.has(sessionId) || !store.get(sessionId)) {
      return;
    }
    if (store.get(sessionId)?.status === "running") {
      store.updateStatus(sessionId, "idle");
      hub.broadcast(sessionId, { type: "session:status", status: "idle" });
    }
  }

  function finishTurnError(sessionId: string, err: unknown): void {
    if (disposed.has(sessionId) || !store.get(sessionId)) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    store.updateStatus(sessionId, "error");
    hub.broadcast(sessionId, {
      type: "session:status",
      status: "error",
      error: message,
    });
    // Allow the next queued message after a failed turn.
    store.updateStatus(sessionId, "idle");
    hub.broadcast(sessionId, { type: "session:status", status: "idle" });
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
    await runTurn(sessionId, next);
  }

  async function ensureAgent(
    sessionId: string,
    workdir: string,
    gateway: GatewayResolution,
  ): Promise<SessionAgent> {
    const identity = gatewayIdentity(gateway);
    const existing = agents.get(sessionId);
    if (existing) {
      if (agentIdentities.get(sessionId) === identity) {
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

    // Filled after createAgent resolves; compact/subagent callbacks may run later.
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
      // Intentionally omit serverUrl to avoid Wave SSO.
      callbacks: {
        onLoadingChange: (loading) => {
          if (disposed.has(sessionId)) return;
          hub.broadcast(sessionId, { type: "loading", loading });
        },
        onAssistantMessageAdded: (messageId) => {
          if (disposed.has(sessionId)) return;
          hub.broadcast(sessionId, { type: "assistant:message", messageId });
        },
        onAssistantContentUpdated: ({ messageId, chunk, stage }) => {
          if (disposed.has(sessionId)) {
            return;
          }
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
            // Mark idle here so UI unlocks; queue drain waits until sendMessage settles.
            markIdle(sessionId);
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
          hub.broadcast(sessionId, { type: "tool:update", params });
        },
        onErrorBlockAdded: (error) => {
          if (disposed.has(sessionId)) return;
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
          hub.broadcast(sessionId, { type: "messages:replace", messages });
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
      },
      canUseTool: async (context) => {
        const permissionId = crypto.randomUUID();
        const description =
          context.toolInput !== undefined
            ? `${context.toolName}: ${safeJson(context.toolInput)}`
            : `Request to use ${context.toolName}`;

        const decisionPromise = new Promise<PermissionDecision>((resolve) => {
          pending.set(permissionId, { sessionId, resolve });
        });

        hub.broadcast(sessionId, {
          type: "permission:request",
          permissionId,
          toolName: context.toolName,
          description,
        });

        return decisionPromise;
      },
    });

    agentBox.current = agent;
    if (disposed.has(sessionId)) {
      await agent.dispose();
      throw Object.assign(new Error(`session disposed: ${sessionId}`), {
        statusCode: 404,
      });
    }

    agents.set(sessionId, agent);
    agentIdentities.set(sessionId, identity);
    return agent;
  }

  async function handleUnauthorized(sessionId: string): Promise<void> {
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
    }
  }

  async function runTurn(sessionId: string, content: string): Promise<void> {
    const session = store.get(sessionId);
    if (!session || disposed.has(sessionId)) {
      return;
    }
    if (session.status === "running") {
      // Should not happen; queue instead of overlapping turns.
      const queue = messageQueues.get(sessionId) ?? [];
      queue.push(content);
      messageQueues.set(sessionId, queue);
      return;
    }

    store.updateStatus(sessionId, "running");
    hub.broadcast(sessionId, { type: "session:status", status: "running" });
    turnEnded.set(sessionId, false);

    try {
      const active = registry.getActive();
      const provider = registry.get(active.providerId);
      if (!provider) {
        throw new Error(`active provider not found: ${active.providerId}`);
      }
      if (!active.modelId) {
        throw new Error("no active model selected");
      }

      let gateway: GatewayResolution;
      try {
        gateway = await provider.resolveGateway(active.modelId);
      } catch (err) {
        if (isUnauthorized(err)) {
          await handleUnauthorized(sessionId);
          return;
        }
        throw err;
      }

      const agent = await ensureAgent(sessionId, session.workdir, gateway);
      await agent.sendMessage(content);
      // SDK may swallow errors / return without stage "end". Release busy either way.
      if (
        !disposed.has(sessionId) &&
        store.get(sessionId)?.status === "running" &&
        !turnEnded.get(sessionId)
      ) {
        hub.broadcast(sessionId, { type: "message:completed" });
        markIdle(sessionId);
      }
    } catch (err) {
      if (disposed.has(sessionId) || !store.get(sessionId)) {
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

  return {
    async sendMessage(sessionId, content) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }

      if (session.status === "running") {
        const queue = messageQueues.get(sessionId) ?? [];
        queue.push(content);
        messageQueues.set(sessionId, queue);
        return { accepted: true };
      }

      // Fire-and-forget so HTTP can return { accepted: true } promptly.
      void runTurn(sessionId, content);

      return { accepted: true };
    },

    async respondPermission(sessionId, permissionId, decision) {
      const entry = pending.get(permissionId);
      if (!entry || entry.sessionId !== sessionId) {
        throw Object.assign(new Error(`permission not found: ${permissionId}`), {
          statusCode: 404,
        });
      }
      pending.delete(permissionId);
      entry.resolve({
        behavior: decision,
        message: decision === "deny" ? "Denied by user" : undefined,
      });
      return { ok: true };
    },

    async disposeSession(sessionId) {
      disposed.add(sessionId);
      messageQueues.delete(sessionId);
      turnEnded.delete(sessionId);
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
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const agent = agents.get(sessionId);
      return agent?.getMessages?.() ?? [];
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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
