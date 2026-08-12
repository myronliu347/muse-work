import { Agent, type AgentOptions, type PermissionDecision } from "wave-agent-sdk";
import type { GatewayResolution, ProviderRegistry } from "@muse-work/provider";
import type { SessionStore } from "./sessionStore.js";
import type { WsHub } from "./wsHub.js";

export interface SessionAgent {
  sendMessage(content: string): Promise<void>;
  dispose(): Promise<void>;
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
  return Agent.create(options).then((agent) => ({
    sendMessage: (content: string) => agent.sendMessage(content),
    // SDK exposes destroy(); brief uses dispose as our session lifecycle hook.
    dispose: () => agent.destroy(),
  }));
}

export function createSessionRunner(
  options: CreateSessionRunnerOptions,
): SessionRunner {
  const { store, hub, registry } = options;
  const createAgent = options.createAgent ?? defaultCreateAgent;
  const agents = new Map<string, SessionAgent>();
  const pending = new Map<string, PendingPermission>();

  async function ensureAgent(
    sessionId: string,
    workdir: string,
    gateway: GatewayResolution,
  ): Promise<SessionAgent> {
    const existing = agents.get(sessionId);
    if (existing) {
      return existing;
    }

    const agent = await createAgent({
      apiKey: gateway.apiKey,
      baseURL: gateway.baseURL,
      defaultHeaders: gateway.defaultHeaders,
      fetch: gateway.fetch,
      model: gateway.model,
      workdir,
      stream: true,
      // Intentionally omit serverUrl to avoid Wave SSO.
      callbacks: {
        onAssistantContentUpdated: ({ chunk, stage }) => {
          if (stage === "streaming") {
            if (chunk) {
              hub.broadcast(sessionId, { type: "message:delta", text: chunk });
            }
          } else if (stage === "end") {
            if (chunk) {
              hub.broadcast(sessionId, { type: "message:delta", text: chunk });
            }
            hub.broadcast(sessionId, { type: "message:completed" });
          }
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

    agents.set(sessionId, agent);
    return agent;
  }

  async function handleUnauthorized(sessionId: string): Promise<void> {
    store.updateStatus(sessionId, "error");
    hub.broadcast(sessionId, { type: "session:status", status: "error" });

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
  }

  return {
    async sendMessage(sessionId, content) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }

      store.updateStatus(sessionId, "running");
      hub.broadcast(sessionId, { type: "session:status", status: "running" });

      // Fire-and-forget agent work so HTTP can return { accepted: true } promptly.
      void (async () => {
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
          store.updateStatus(sessionId, "idle");
          hub.broadcast(sessionId, { type: "session:status", status: "idle" });
        } catch (err) {
          if (isUnauthorized(err)) {
            await handleUnauthorized(sessionId);
            return;
          }
          store.updateStatus(sessionId, "error");
          hub.broadcast(sessionId, { type: "session:status", status: "error" });
        }
      })();

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
      if (agent) {
        await agent.dispose();
      }
      store.delete(sessionId);
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
