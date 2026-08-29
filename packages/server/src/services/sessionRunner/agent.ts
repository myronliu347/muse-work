import {
  loadSessionFromJsonl,
  type PermissionDecision,
} from "wave-agent-sdk";
import type { GatewayResolution } from "@muse-work/provider";
import { AGENT_TOOL_NAME } from "wave-agent-sdk/dist/constants/tools.js";
import { loadMuseSettings, pluginDirIfPresent } from "../museSettings.js";
import { MUSE_IDENTITY_REV } from "../museSystemPrompt.js";
import type { WsEvent } from "../wsHub.js";
import { createAgentLogger, getLogger } from "../../utils/logger.js";
import { mapSdkMessages } from "../../utils/messageMapper.js";
import {
  appendImageSourceMarkers,
  saveBase64Images,
} from "../../utils/imageSaver.js";
import { DEFAULT_TITLE, TITLE_MAX_LEN } from "../../constants/agent.js";
import {
  isAbortError,
  isUnauthorized,
  safeJson,
  toBackgroundTaskSummary,
  toSerializableWorkflowRuns,
} from "./serialization.js";
import { wrapSystemInject } from "./ctx.js";
import type {
  AgentLayer,
  RunnerContext,
  SessionAgent,
  SessionImage,
} from "./ctx.js";

/**
 * Agent-runtime layer: agent creation/restore, SDK callback wiring, disk
 * loading, title generation, and the runTurn send pipeline. Depends only on
 * core (via ctx.core) + ctx + serialization — never on actions.
 */
export function createAgentLayer(ctx: RunnerContext): AgentLayer {
  const {
    store,
    hub,
    registry,
    home,
    agents,
    agentIdentities,
    disposed,
    agentLoading,
    loadingSeen,
    turnEnded,
    turnHadOutput,
    pending,
    agentToolBinds,
    pendingAgentToolIds,
    unboundSubagentIds,
    knownAgentToolIds,
    latestTasks,
    latestBackgroundTasks,
    latestWorkflowRuns,
    latestMcp,
    latestTokens,
    titleGenerating,
    createAgent,
    options,
  } = ctx;
  const core = ctx.core;

  /** Paths of built-in plugins enabled in settings whose dirs are present,
   *  plus the always-on todo plugin (内置能力，非 settings 开关). */
  function enabledPluginDirs(): string[] {
    const plugins = loadMuseSettings(home).plugins;
    const dirs = ["superpowers", "mattpocock"].flatMap((name) => {
      if (!plugins[name as keyof typeof plugins]) return [];
      const dir = pluginDirIfPresent(name);
      return dir ? [dir] : [];
    });
    const todoDir = pluginDirIfPresent("todo");
    if (todoDir) dirs.push(todoDir);
    return dirs;
  }

  function pluginsFlag(): string {
    return enabledPluginDirs().join(",") || "none";
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
      pluginsFlag(),
    ].join("\0");
  }

  /** agent 身份签名：agentName/systemPrompt/tools/权限 变更时纳入，驱动 ensureAgent 重建。 */
  function agentIdentity(sessionId: string): string {
    const s = store.get(sessionId);
    if (!s) return "none";
    return JSON.stringify({
      agentName: s.agentName ?? "",
      systemPrompt: s.systemPrompt ?? "",
      fastModel: s.fastModel ?? "",
      tools: s.tools ?? [],
      disallowedTools: s.disallowedTools ?? [],
      allowedTools: s.allowedTools ?? [],
    });
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

  async function loadMainSessionFromDisk(
    sessionId: string,
    workdir: string,
  ): Promise<{ messages: unknown[] } | null> {
    return (
      options.loadMainSessionFromDisk ??
      (async (id: string, dir: string) => {
        try {
          const data = await loadSessionFromJsonl(id, dir, "main");
          return data?.messages?.length ? { messages: data.messages } : null;
        } catch {
          // A missing/corrupt session file must not fail getMessages — the UI
          // shows an empty history instead of an error.
          return null;
        }
      })
    )(sessionId, workdir);
  }

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

    const session = store.get(sessionId);
    const agent = await createAgent({
      apiKey: gateway.apiKey,
      baseURL: gateway.baseURL,
      defaultHeaders: gateway.defaultHeaders,
      fetch: gateway.fetch,
      model: gateway.model,
      logger: createAgentLogger({ home, sessionId }),
      // SDK requires fastModel (used for lightweight sub-tasks). Fall back to main model.
      // agents.json 显式给 fastModel（存进 Session.fastModel）才覆盖。
      fastModel: session?.fastModel ?? gateway.fastModel ?? gateway.model,
      workdir,
      stream: true,
      // 会话可携带自定义 system prompt（todo 规划会话注入 todo 上下文）；
      // 缺省时 SDK 用 MUSE_BASE_SYSTEM_PROMPT。
      systemPrompt: session?.systemPrompt,
      permissionMode: session?.permissionMode ?? "acceptEdits",
      restoreSessionId,
      // agent 的 tools（允许列表）与 permission（拒绝/豁免）展开后存在会话里，透传 SDK
      ...(session?.tools && session.tools.length > 0 ? { tools: session.tools } : {}),
      ...(session?.disallowedTools && session.disallowedTools.length > 0
        ? { disallowedTools: session.disallowedTools }
        : {}),
      ...(session?.allowedTools && session.allowedTools.length > 0
        ? { allowedTools: session.allowedTools }
        : {}),
      ...(enabledPluginDirs().length > 0
        ? {
            plugins: enabledPluginDirs().map((path) => ({
              type: "local" as const,
              path,
            })),
          }
        : {}),
      // Intentionally omit serverUrl to avoid Wave SSO.
      callbacks: {
        onSessionIdChange: (id) => {
          rememberWaveSessionId(sessionId, id);
        },
        onLoadingChange: (loading) => {
          if (disposed.has(sessionId)) return;
          core.bumpActivity(sessionId);
          agentLoading.set(sessionId, loading);
          loadingSeen.set(sessionId, true);
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
            core.reportEmptyTurnIfNeeded(sessionId);
            // Push only the turn's file_history blocks so the webview's card
            // renders right after the turn — delta events carry text/tool
            // chunks but never the file_history block, and re-sending the whole
            // transcript over the socket is wasteful for large sessions.
            core.broadcastFileHistory(sessionId);
            core.markIdle(sessionId);
          }
        },
        onAssistantMessageAdded: (messageId) => {
          if (disposed.has(sessionId)) return;
          core.markTurnOutput(sessionId);
          core.bumpActivity(sessionId);
          hub.broadcast(sessionId, { type: "assistant:message", messageId });
        },
        onUserMessageAdded: (params) => {
          if (disposed.has(sessionId)) return;
          // Meta messages (hook-injected system reminders) are not transcript
          // bubbles. Regular user messages surface here for queued sends whose
          // optimistic bubble was skipped while the AI was busy.
          if (params.isMeta) return;
          // 用户消息正式派发（进入 SDK 转录）＝新一轮真正开始：清掉上一轮
          // 遗留的 turn 状态，保证本轮真空 turn 仍能被 reportEmptyTurnIfNeeded
          // 捕获（入队场景下 runTurn 保留了上一轮状态，故在此复位）。
          turnEnded.set(sessionId, false);
          turnHadOutput.set(sessionId, false);
          // SDK 的 onUserMessageAdded 回调不携带新消息 id；从 agent 消息里取
          // 最近一条非 meta 的 user 消息 id 下发。webview 用它把乐观气泡的
          // 客户端临时 id 对齐成 SDK 真实 id——否则 rewind 等按 id 操作会
          // 报 checkpoint not found（乐观 id 从未持久化，agent 消息里没有）。
          let id: string | undefined;
          const agent = agents.get(sessionId);
          const agentMessages = agent?.getMessages?.() ?? [];
          for (let i = agentMessages.length - 1; i >= 0; i--) {
            const m = agentMessages[i] as {
              role?: string;
              id?: unknown;
              isMeta?: boolean;
            };
            if (m.role !== "user" || m.isMeta) continue;
            if (typeof m.id === "string") id = m.id;
            break;
          }
          hub.broadcast(sessionId, {
            type: "user:message",
            id,
            content: params.content,
            images: params.images,
          });
        },
        onAssistantContentUpdated: ({ messageId, chunk, stage }) => {
          if (disposed.has(sessionId)) {
            return;
          }
          core.markTurnOutput(sessionId);
          core.bumpActivity(sessionId);
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
          core.markTurnOutput(sessionId);
          hub.broadcast(sessionId, {
            type: "reasoning:delta",
            messageId,
            text: chunk ?? "",
            stage,
          });
        },
        onToolBlockUpdated: (params) => {
          if (disposed.has(sessionId)) return;
          core.markTurnOutput(sessionId);
          core.bumpActivity(sessionId);
          rememberAgentTool(sessionId, params as Record<string, unknown>);
          hub.broadcast(sessionId, { type: "tool:update", params });
        },
        onErrorBlockAdded: (error) => {
          if (disposed.has(sessionId)) return;
          // User-initiated abort surfaces as "Request was aborted" — not a session error.
          if (isAbortError(error)) return;
          core.markTurnOutput(sessionId);
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
          if (!agents.get(sessionId)?.getMessages) return;
          core.broadcastMessages(sessionId);
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
        if (
          store.get(sessionId)?.permissionMode === "bypassPermissions" &&
          context.toolName !== "AskUserQuestion"
        ) {
          return { behavior: "allow" as const };
        }
        core.clearIdleTimer(sessionId);
        core.clearStallTimer(sessionId);
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
        core.bumpActivity(sessionId);
        return decision;
      },
    });

    agentBox.current = agent;
    return agent;
  }

  async function ensureAgent(sessionId: string): Promise<SessionAgent> {
    core.clearIdleTimer(sessionId);
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
    // 合并网关 + agent 身份签名：model/provider 或 agentName/systemPrompt/tools 变更都驱动重建
    const identity = `${gatewayIdentity(gateway)}\0${agentIdentity(sessionId)}`;
    const existing = agents.get(sessionId);
    if (existing) {
      if (agentIdentities.get(sessionId) === identity) {
        // getMessages / idle ensureAgent cleared the timer — re-arm if still idle.
        core.rearmIdleIfNeeded(sessionId);
        return existing;
      }
      // Stale identity (provider / ~/.wave/settings.json change). Recreate only
      // when the agent is not mid-turn — an in-flight turn keeps its live agent.
      // Note: not `canIdleDestroy` (its status=running check would always veto
      // during runTurn, where status is set to "running" before ensureAgent).
      if (
        core.hasPendingPermission(sessionId) ||
        agentLoading.get(sessionId) === true ||
        existing.hasPendingMessages?.()
      ) {
        core.rearmIdleIfNeeded(sessionId);
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
    core.rearmIdleIfNeeded(sessionId);
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
      core.markUnreadDoneIfInactive(sessionId);
      core.scheduleIdleDestroy(sessionId);
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
    source?: "user" | "system-inject",
  ): Promise<void> {
    const session = store.get(sessionId);
    if (!session || disposed.has(sessionId)) {
      return;
    }

    core.clearIdleTimer(sessionId);
    store.update(sessionId, { lastActiveAt: Date.now() });
    store.updateStatus(sessionId, "running");
    hub.broadcast(sessionId, { type: "session:status", status: "running" });
    // 仅当 agent 当前空闲（本消息将开启新一轮）才重置轮次状态。若 agent 仍
    // 在忙（SDK 会把本消息入队、等上一轮结束才派发），保留上一轮的
    // turnHadOutput/loadingSeen 等——否则上一轮收尾时的 onLoadingChange(false)
    // 或本 runTurn 的 setImmediate 回退会把这轮"入队中"的消息误判成空 turn，
    // 广播假的"模型没有产生输出"，进而导致 webview 重复渲染用户气泡。
    if (agentLoading.get(sessionId) !== true) {
      turnEnded.set(sessionId, false);
      turnHadOutput.set(sessionId, false);
      agentLoading.set(sessionId, false);
      loadingSeen.set(sessionId, false);
    }
    core.bumpActivity(sessionId);
    getLogger().info("turn started", {
      sessionId,
      model: session.model,
      chars: content.length,
      images: images?.length ?? 0,
      source: source ?? "user",
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
      // 系统注入消息包上标记：落盘 + 广播自然携带，webview 据此以独立样式渲染
      const finalContent =
        source === "system-inject" ? wrapSystemInject(contentWithSources) : contentWithSources;
      await agent.sendMessage(finalContent, images);
      // Fallback when SDK never toggles onLoadingChange (tests / swallowed turns).
      // Defer the check to the next macrotask: the SDK's async callbacks
      // (onLoadingChange(true), assistant content) fire after sendMessage
      // settles, and treating that in-flight window as a finished empty turn
      // would broadcast a bogus "模型没有产生输出" error block. Only report when
      // loading was never reported (loadingSeen) — a genuinely swallowed turn.
      setImmediate(() => {
        if (
          !disposed.has(sessionId) &&
          store.get(sessionId)?.status === "running" &&
          agentLoading.get(sessionId) !== true &&
          !loadingSeen.get(sessionId)
        ) {
          core.reportEmptyTurnIfNeeded(sessionId);
          if (!turnEnded.get(sessionId)) {
            hub.broadcast(sessionId, { type: "message:completed" });
          }
          getLogger().info("turn completed", { sessionId });
          core.markIdle(sessionId);
        }
      });
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
        core.markIdle(sessionId);
        return;
      }
      if (isUnauthorized(err)) {
        await handleUnauthorized(sessionId);
        return;
      }
      core.finishTurnError(sessionId, err);
    } finally {
      // No server-side drain: the SDK serializes queued sends via its own queue.
    }
  }

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

  return {
    ensureAgent,
    runTurn,
    attachNestedMessages,
    loadMainSessionFromDisk,
    reconcileBackgroundTasks,
  };
}
