import {
  listSkillMetadataForWorkdir,
  loadSessionFromJsonl,
  type PermissionDecision,
  type ToolPlugin,
} from "@muse-work/agent";
import type { GatewayResolution } from "@muse-work/provider";
import path from "node:path";
import { AGENT_TOOL_NAME } from "@muse-work/agent/constants";
import { resolveScenarioAgent } from "../agentConfig.js";
import { createWebSearchTool } from "../assistant/webSearchTool.js";
import { planningCodeWriteDecision } from "../issuePlanning.js";
import { pluginDirIfPresent } from "../museSettings.js";
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
import { publishCompaction, wrapSystemInject } from "./ctx.js";
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
    turnSendDepth,
    queuedDispatch,
    pendingTurnOutputReset,
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
  /** 一轮真正开始时递增。被打断的旧 send 收尾不得把后一轮标成结束。 */
  const turnSerial = new Map<string, number>();

  const skillsListCache = new Map<
    string,
    { at: number; skills: unknown[] }
  >();
  const SKILLS_LIST_CACHE_MS = 30_000;
  const SKILLS_LIST_CACHE_MAX = 64;

  function pruneSkillsListCache(now: number): void {
    for (const [key, entry] of skillsListCache) {
      if (now - entry.at >= SKILLS_LIST_CACHE_MS) {
        skillsListCache.delete(key);
      }
    }
    while (skillsListCache.size > SKILLS_LIST_CACHE_MAX) {
      let oldestKey: string | undefined;
      let oldestAt = Infinity;
      for (const [key, entry] of skillsListCache) {
        if (entry.at < oldestAt) {
          oldestAt = entry.at;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      skillsListCache.delete(oldestKey);
    }
  }

  async function getSkillsForWorkdir(workdir: string): Promise<unknown[]> {
    const trimmed = workdir.trim();
    if (!trimmed) {
      throw Object.assign(new Error("workdir is required"), { statusCode: 400 });
    }
    const workdirKey = path.resolve(trimmed);
    const now = Date.now();
    const cacheKey = `${workdirKey}\0${pluginsFlag()}`;
    const cached = skillsListCache.get(cacheKey);
    if (cached && now - cached.at < SKILLS_LIST_CACHE_MS) {
      return cached.skills;
    }
    const pluginDirs = enabledPluginDirs();
    const skills = await listSkillMetadataForWorkdir(workdirKey, pluginDirs);
    skillsListCache.set(cacheKey, { at: now, skills });
    pruneSkillsListCache(now);
    return skills;
  }

  function invalidateSkillsListCache(): void {
    skillsListCache.clear();
  }

  /**
   * Paths of built-in plugins whose dirs are present.
   * issue and automation mount for all sessions except issue-exec and
   * origin=automation (unattended runs and execution turns cannot manage
   * issues or nested automations). The assistant mounts automation only,
   * so it can schedule rules.
   */
  function enabledPluginDirs(session?: {
    agentName?: string;
    origin?: "user" | "automation" | "assistant";
  }): string[] {
    if (session?.origin === "assistant") {
      const automation = pluginDirIfPresent("automation");
      return automation ? [automation] : [];
    }
    if (session?.origin === "automation") return [];
    if (session?.agentName === resolveScenarioAgent("issue-exec", home)) return [];
    const dirs: string[] = [];
    for (const name of ["issue", "automation"]) {
      const dir = pluginDirIfPresent(name);
      if (dir) dirs.push(dir);
    }
    return dirs;
  }

  function pluginsFlag(session?: {
    agentName?: string;
    origin?: "user" | "automation" | "assistant";
  }): string {
    return enabledPluginDirs(session).join(",") || "none";
  }

  function gatewayIdentity(
    gateway: GatewayResolution,
    session?: { agentName?: string; origin?: "user" | "automation" | "assistant" },
  ): string {
    const credential =
      gateway.credentialFingerprint ?? gateway.apiKey ?? "";
    return [
      gateway.baseURL,
      gateway.model,
      credential,
      gateway.fastModel ?? "",
      MUSE_IDENTITY_REV,
      pluginsFlag(session),
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
      // 分析会话后来换上 worktree 时，下一轮按新目录拉起。正在跑的这一轮对不上也不会中途拆掉。
      workdir: s.workdir,
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

  function rememberMuseSessionId(
    sessionId: string,
    museSessionId: string | undefined,
  ): void {
    if (!museSessionId || disposed.has(sessionId) || !store.get(sessionId)) {
      return;
    }
    store.setMuseSessionId(sessionId, museSessionId);
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

  /** 助手带着自己的协调工具；其余会话只加 WebSearch。助手列表里已有则不重复挂。 */
  function sessionCustomTools(session: {
    origin?: "user" | "automation" | "assistant";
  } | undefined): ToolPlugin[] {
    const assistant =
      session?.origin === "assistant" && options.getAssistantTools
        ? options.getAssistantTools()
        : [];
    if (assistant.some((entry) => entry.name === "WebSearch")) return assistant;
    return [...assistant, createWebSearchTool({ home })];
  }

  async function createAgentWithRestore(
    sessionId: string,
    workdir: string,
    gateway: GatewayResolution,
    restoreSessionId: string | undefined,
  ): Promise<SessionAgent> {
    const agentBox: { current: SessionAgent | null } = { current: null };

    const session = store.get(sessionId);
    const pluginDirs = enabledPluginDirs(session);
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
      // 会话可携带自定义 system prompt；
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
      customTools: sessionCustomTools(session),
      ...(pluginDirs.length > 0
        ? {
            plugins: pluginDirs.map((path) => ({
              type: "local" as const,
              path,
            })),
          }
        : {}),
      callbacks: {
        onSessionIdChange: (id) => {
          rememberMuseSessionId(sessionId, id);
        },
        onLoadingChange: (loading) => {
          if (disposed.has(sessionId)) return;
          core.touchAgent(sessionId);
          const wasLoading = agentLoading.get(sessionId) === true;
          agentLoading.set(sessionId, loading);
          loadingSeen.set(sessionId, true);
          hub.broadcast(sessionId, { type: "loading", loading });
          // Sidebar / status must track the full agent turn (including tools),
          // not the first assistant content stage "end".
          if (loading) {
            // Only the loading rise that starts a queued turn may clear
            // turnHadOutput. A mid-turn flicker (tools → next model round)
            // must keep it, or loading=false broadcasts a bogus empty turn
            // under the Agent row while 思考中... is still showing.
            // Queued turns cannot reset on onUserMessageAdded: the previous
            // turn's trailing loading=false may land after that dispatch.
            if (
              !wasLoading &&
              pendingTurnOutputReset.has(sessionId)
            ) {
              turnHadOutput.set(sessionId, false);
              pendingTurnOutputReset.delete(sessionId);
            }
            if (store.get(sessionId)?.status !== "running") {
              store.updateStatus(sessionId, "running");
              hub.broadcast(sessionId, {
                type: "session:status",
                status: "running",
              });
            }
          } else {
            // sendMessage still in flight: SDK often drops loading before the
            // first reasoning token. Reporting empty here pins a false
            // "模型没有产生输出" above 思考中...
            if ((turnSendDepth.get(sessionId) ?? 0) === 0) {
              core.reportEmptyTurnIfNeeded(sessionId);
            }
            // Push only the turn's file_history blocks so the webview's card
            // renders right after the turn — delta events carry text/tool
            // chunks but never the file_history block, and re-sending the whole
            // transcript over the socket is wasteful for large sessions.
            core.broadcastFileHistory(sessionId);
            // SDK may drop loading between tools and the next model round
            // while sendMessage is still in flight. Idling here fires
            // onTurnSettled and tells Issue planning the exec turn finished.
            if ((turnSendDepth.get(sessionId) ?? 0) === 0) {
              core.markIdle(sessionId);
            }
          }
        },
        onAssistantMessageAdded: (messageId) => {
          if (disposed.has(sessionId)) return;
          core.markTurnOutput(sessionId);
          core.touchAgent(sessionId);
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
          if (queuedDispatch.has(sessionId)) {
            pendingTurnOutputReset.add(sessionId);
            queuedDispatch.delete(sessionId);
          }
          // 注意：turnHadOutput 不在派发时重置。上一轮若有真实输出，其残留的
          // onLoadingChange(false) 收尾可能晚于本条派发到达（同毫秒竞态，实测
          // 08:24:11.742 派发 / .743 误报）；若在此清掉 turnHadOutput，那次
          // 收尾会把刚派发的新一轮误判成「模型没有产生输出」。
          // turnHadOutput 改为在 loading(true)（新一轮真正开始）时重置（见
          // onLoadingChange），轮次归属正确且不残留。
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
          core.touchAgent(sessionId);
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
          core.touchAgent(sessionId);
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
          // Mid-turn CodeMaker 403 (token expired) arrives as an error block,
          // not a thrown sendMessage — still prompt re-login.
          if (isUnauthorized(error)) {
            void handleUnauthorized(sessionId);
          }
        },
        onCompactionStateChange: (isCompacting) => {
          if (disposed.has(sessionId)) return;
          publishCompaction(ctx, sessionId, isCompacting);
        },
        onQueuedMessagesChange: (messages) => {
          if (disposed.has(sessionId)) return;
          hub.broadcast(sessionId, { type: "updateQueue", messages });
        },
        onCompactBlockAdded: () => {
          if (disposed.has(sessionId)) return;
          // The client already has the pre-compact transcript from streaming.
          // Append only the summary so that history stays on screen, and the
          // agent does not have to resend it.
          const live = agents.get(sessionId)?.getMessages?.() ?? [];
          const compact = live.find(
            (message) =>
              Array.isArray((message as { blocks?: unknown[] }).blocks) &&
              (message as { blocks: Array<{ type?: string }> }).blocks.some(
                (block) => block.type === "compact",
              ),
          );
          if (compact) {
            hub.broadcast(sessionId, {
              type: "messages:append",
              messages: mapSdkMessages([compact]),
            });
          }
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
        if (options.isIssuePlanningSession?.(sessionId)) {
          const toolInput =
            context.toolInput && typeof context.toolInput === "object"
              ? (context.toolInput as Record<string, unknown>)
              : undefined;
          const blocked = planningCodeWriteDecision(context.toolName, toolInput);
          if (blocked) return blocked;
        }
        if (
          store.get(sessionId)?.permissionMode === "bypassPermissions" &&
          context.toolName !== "AskUserQuestion"
        ) {
          return { behavior: "allow" as const };
        }
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
          suggestedPrefix: context.suggestedPrefix,
          hidePersistentOption: context.hidePersistentOption,
          permissionMode: context.permissionMode,
          toolCallId: context.toolCallId,
        };
        const decisionPromise = new Promise<PermissionDecision>((resolve) => {
          pending.set(permissionId, { sessionId, resolve, request });
        });

        hub.broadcast(sessionId, request);
        try {
          ctx.onPermissionRequest?.(sessionId, {
            permissionId,
            toolName: context.toolName,
            description,
          });
        } catch (err: unknown) {
          getLogger().error("permission request notify failed", {
            sessionId,
            permissionId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const decision = await decisionPromise;
        core.touchAgent(sessionId);
        return decision;
      },
    });

    agentBox.current = agent;
    return agent;
  }

  async function ensureAgent(sessionId: string): Promise<SessionAgent> {
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
    const identity = `${gatewayIdentity(gateway, session)}\0${agentIdentity(sessionId)}`;
    const existing = agents.get(sessionId);
    if (existing) {
      if (agentIdentities.get(sessionId) === identity) {
        core.touchAgent(sessionId);
        await core.maybeEvictLiveAgents(sessionId);
        return existing;
      }
      // Stale identity (provider / ~/.muse-work/settings.json change). Recreate only
      // when the agent is not mid-turn — an in-flight turn keeps its live agent.
      // Note: not `canIdleDestroy` (its status=running check would always veto
      // during runTurn, where status is set to "running" before ensureAgent).
      if (
        core.hasPendingPermission(sessionId) ||
        agentLoading.get(sessionId) === true ||
        existing.hasPendingMessages?.()
      ) {
        core.touchAgent(sessionId);
        await core.maybeEvictLiveAgents(sessionId);
        return existing;
      }
      agents.delete(sessionId);
      ctx.agentLastUsed.delete(sessionId);
      agentIdentities.delete(sessionId);
      await existing.dispose();
    }
    if (disposed.has(sessionId)) {
      throw Object.assign(new Error(`session disposed: ${sessionId}`), {
        statusCode: 404,
      });
    }

    const restoreId = store.get(sessionId)?.museSessionId;
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

    rememberMuseSessionId(sessionId, agent.sessionId);
    agents.set(sessionId, agent);
    agentIdentities.set(sessionId, identity);
    core.touchAgent(sessionId);
    await core.maybeEvictLiveAgents(sessionId);
    return agent;
  }

  async function handleUnauthorized(sessionId: string): Promise<void> {
    getLogger().warn("turn unauthorized", { sessionId });
    // Capture before flipping status: automation / issue dispatch settle only
    // when the turn was still running. A second unauthorized callback must not
    // re-fire onTurnSettled after we already idled.
    const wasRunning = store.get(sessionId)?.status === "running";
    store.updateStatus(sessionId, "error");
    hub.broadcast(sessionId, {
      type: "session:status",
      status: "error",
      error: "Unauthorized",
    });

    const active = registry.getActive();
    const provider = registry.get(active.providerId);
    if (provider?.id === "codemaker") {
      // Local expire may still look valid while the API already rejected the
      // token; drop creds so the next login does not reuse the dead token.
      await provider.logout();
      hub.broadcast(sessionId, {
        type: "auth:changed",
        status: { state: "unauthenticated", providerId: "codemaker" },
      });
    } else if (provider) {
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

    // Auth failures should not permanently block the session. Mirror
    // finishTurnError so automation runs / issue exec turns leave "running".
    if (store.get(sessionId)) {
      agentLoading.set(sessionId, false);
      store.updateStatus(sessionId, "idle");
      hub.broadcast(sessionId, { type: "session:status", status: "idle" });
      core.markUnreadDoneIfInactive(sessionId);
      if (wasRunning) {
        ctx.onTurnSettled?.(sessionId, {
          ok: false,
          error: "Unauthorized",
        });
      }
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

    store.update(sessionId, { lastActiveAt: Date.now() });
    store.updateStatus(sessionId, "running");
    hub.broadcast(sessionId, { type: "session:status", status: "running" });
    // 仅当 agent 当前空闲（本消息将开启新一轮）才重置轮次状态。若 agent 仍
    // 在忙（SDK 会把本消息入队、等上一轮结束才派发），保留上一轮的
    // turnHadOutput/loadingSeen 等——否则上一轮收尾时的 onLoadingChange(false)
    // 或本 runTurn 的 setImmediate 回退会把这轮"入队中"的消息误判成空 turn，
    // 广播假的"模型没有产生输出"，进而导致 webview 重复渲染用户气泡。
    const queued = agentLoading.get(sessionId) === true;
    let serial = turnSerial.get(sessionId) ?? 0;
    if (!queued) {
      serial += 1;
      turnSerial.set(sessionId, serial);
    }
    if (!queued) {
      turnEnded.set(sessionId, false);
      turnHadOutput.set(sessionId, false);
      agentLoading.set(sessionId, false);
      loadingSeen.set(sessionId, false);
      queuedDispatch.delete(sessionId);
      pendingTurnOutputReset.delete(sessionId);
    } else {
      queuedDispatch.add(sessionId);
    }
    core.touchAgent(sessionId);
    getLogger().info("turn started", {
      sessionId,
      model: session.model,
      chars: content.length,
      images: images?.length ?? 0,
      source: source ?? "user",
    });

    // turnSendDepth 挡住 onLoadingChange(false)→markIdle→onTurnSettled。
    // 非排队回合必须在 ensureAgent 之前 +1：status 已是 running，上一轮残留的
    // loading=false 会把 Issue 新 dispatch 的 inflight 误结掉，规划会话收到
    // 重复的「来源：执行会话」。排队回合不能提前 +1，否则上一轮无法 settle。
    let holdingSendDepth = false;
    const holdSendDepth = () => {
      if (holdingSendDepth) return;
      turnSendDepth.set(sessionId, (turnSendDepth.get(sessionId) ?? 0) + 1);
      holdingSendDepth = true;
    };
    const releaseSendDepth = () => {
      if (!holdingSendDepth) return;
      const remaining = (turnSendDepth.get(sessionId) ?? 1) - 1;
      if (remaining <= 0) turnSendDepth.delete(sessionId);
      else turnSendDepth.set(sessionId, remaining);
      holdingSendDepth = false;
    };
    if (!queued) holdSendDepth();

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
      if (queued) holdSendDepth();
      try {
        await agent.sendMessage(finalContent, images);
      } finally {
        releaseSendDepth();
      }
      // loading=false during sendMessage was skipped (still in flight). If the
      // SDK already dropped loading for good, settle now that sendMessage returned.
      if (
        !disposed.has(sessionId) &&
        store.get(sessionId)?.status === "running" &&
        agentLoading.get(sessionId) !== true &&
        loadingSeen.get(sessionId)
      ) {
        core.reportEmptyTurnIfNeeded(sessionId);
        if (!turnEnded.get(sessionId)) {
          hub.broadcast(sessionId, { type: "message:completed" });
        }
        getLogger().info("turn completed", { sessionId });
        core.markIdle(sessionId);
      }
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
        // 90 秒抢占会在 abort 收尾前开下一轮。旧请求的 abort 晚到时不能再结掉它。
        if ((turnSerial.get(sessionId) ?? 0) === serial) {
          core.markIdle(sessionId);
        }
        return;
      }
      if (isUnauthorized(err)) {
        await handleUnauthorized(sessionId);
        return;
      }
      core.finishTurnError(sessionId, err);
    } finally {
      releaseSendDepth();
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
    getSkillsForWorkdir,
    invalidateSkillsListCache,
  };
}
