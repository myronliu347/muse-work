import type { MuseWsEvent } from "../wsClient.js";
import {
  emitCompacting,
  emitPermissionMode,
  newId,
  postToWebview,
  resolveSlashCommandsSessionId,
  skillsToSlashCommands,
} from "./utils.js";
import type { BridgeCtx } from "./ctx.js";

export interface ChatModule {
  emitChatWs: (event: MuseWsEvent) => void;
  resetChatStreaming: () => void;
  handleSendMessage: (msg: { text?: string; images?: unknown }) => Promise<void>;
  handleAbortMessage: () => Promise<void>;
  handleDeleteQueuedMessageById: (msg: { id?: string }) => Promise<void>;
  handleUpdateQueuedMessage: (msg: { id?: string; text?: string; images?: unknown }) => Promise<void>;
  handleRequestSlashCommands: () => Promise<void>;
  handleClearChat: () => Promise<void>;
  handleCompactChat: () => Promise<void>;
  handleListRewindCheckpoints: () => Promise<void>;
  handleRewindToMessage: (msg: { messageId?: string }) => Promise<void>;
  handleSetPermissionMode: (msg: { mode?: string }) => Promise<void>;
  handleGetMcpServers: () => Promise<void>;
  handleConnectMcpServer: (msg: { serverName?: string }) => Promise<void>;
  handleDisconnectMcpServer: (msg: { serverName?: string }) => Promise<void>;
}

export function createChatModule(ctx: BridgeCtx): ChatModule {
  const ensureAssistantMessage = (
    messageId: string,
    opts?: { trackMain?: boolean },
  ): void => {
    const trackMain = opts?.trackMain !== false;
    if (ctx.knownAssistantIds.has(messageId)) {
      if (trackMain) ctx.streamingMessageId = messageId;
      return;
    }
    ctx.knownAssistantIds.add(messageId);
    if (trackMain) ctx.streamingMessageId = messageId;
    postToWebview({
      command: "appendMessage",
      message: {
        id: messageId,
        role: "assistant",
        timestamp: new Date().toISOString(),
        blocks: [],
      },
    });
  };

  const resetChatStreaming = () => {
    ctx.streamingMessageId = null;
    ctx.knownAssistantIds.clear();
    ctx.aborted = false;
    ctx.setLoading(false);
    postToWebview({ command: "endStreaming" });
  };

  const emitChatWs = (event: MuseWsEvent) => {
    if (event.type === "loading") {
      // A fresh loading:true marks a new turn — later deltas are no longer the
      // stragglers of an aborted turn.
      if (event.loading) ctx.aborted = false;
      ctx.setLoading(event.loading);
      postToWebview({
        command: event.loading ? "startStreaming" : "endStreaming",
      });
      if (!event.loading) {
        ctx.streamingMessageId = null;
        ctx.knownAssistantIds.clear();
      }
      return;
    }

    if (event.type === "assistant:message") {
      if (ctx.aborted) return;
      ensureAssistantMessage(event.messageId);
      if (!ctx.loading) {
        ctx.setLoading(true);
        postToWebview({ command: "startStreaming" });
      }
      return;
    }

    if (event.type === "user:message") {
      postToWebview({
        command: "user:message",
        id: event.id,
        content: event.content,
        images: event.images,
      });
      return;
    }

    if (event.type === "updateQueue") {
      postToWebview({
        command: "updateQueue",
        messages: event.messages,
      });
      return;
    }

    if (event.type === "file_history:update") {
      // Turn ended: merge the turn's file_history blocks into the matching
      // messages (delta events never carry file_history). Lightweight — only
      // snapshots, not the full transcript.
      postToWebview({
        command: "updateFileHistory",
        messages: event.messages,
      });
      return;
    }

    if (event.type === "message:delta") {
      if (ctx.aborted) return;
      const messageId = event.messageId || ctx.streamingMessageId || newId("asst");
      ensureAssistantMessage(messageId);
      if (!ctx.loading) {
        ctx.setLoading(true);
        postToWebview({ command: "startStreaming" });
      }
      postToWebview({
        command: "updateStreamingContent",
        messageId,
        chunk: event.text,
        stage: event.stage ?? "streaming",
      });
      return;
    }

    if (event.type === "reasoning:delta") {
      // Abort 后 SDK 仍会把思考块收成 stage:end。这条要放行，否则计时停不下来。
      // 流式增量继续丢掉，避免中断后的迟到片段把会话重新点亮。
      if (ctx.aborted && event.stage !== "end") return;
      if (!ctx.aborted) {
        ensureAssistantMessage(event.messageId);
        if (!ctx.loading) {
          ctx.setLoading(true);
          postToWebview({ command: "startStreaming" });
        }
      }
      postToWebview({
        command: "updateStreamingReasoning",
        messageId: event.messageId,
        chunk: event.text,
        stage: event.stage,
      });
      return;
    }

    if (event.type === "tool:update") {
      const params = event.params;
      const messageId =
        typeof params.messageId === "string"
          ? params.messageId
          : ctx.streamingMessageId || newId("asst");
      // Abort 后 SDK 推送的 tool:update 是对卡在 running/streaming 的 tool
      // block 的 finalize（stage:end + error）——必须放行让 UI 停止 shimmer；
      // 只跳过 startStreaming，避免重燃被中断的会话。
      if (!ctx.aborted) {
        ensureAssistantMessage(messageId);
        if (!ctx.loading) {
          ctx.setLoading(true);
          postToWebview({ command: "startStreaming" });
        }
      }
      postToWebview({
        command: "updateToolBlock",
        params: { ...params, messageId },
      });
      return;
    }

    if (event.type === "message:completed") {
      const messageId = event.messageId || ctx.streamingMessageId;
      if (messageId) {
        postToWebview({
          command: "updateStreamingContent",
          messageId,
          chunk: "",
          stage: "end",
        });
      }
      if (!ctx.loading) {
        ctx.streamingMessageId = null;
        ctx.knownAssistantIds.clear();
        postToWebview({ command: "endStreaming" });
      }
      return;
    }

    if (event.type === "session:status" && event.status === "error") {
      const error = event.error?.trim() || "Session error";
      postToWebview({
        command: "updateErrorBlock",
        error,
      });
      postToWebview({ command: "endStreaming" });
      ctx.streamingMessageId = null;
      ctx.knownAssistantIds.clear();
      ctx.setLoading(false);
      ctx.maybePromptAuthDialog(error);
      return;
    }

    if (event.type === "error:block") {
      ctx.compactingSessions.delete(event.sessionId);
      postToWebview({
        command: "updateErrorBlock",
        error: event.error?.trim() || "Session error",
      });
      ctx.maybePromptAuthDialog(event.error ?? "");
      emitCompacting(false);
      return;
    }

    if (event.type === "compaction:state") {
      emitCompacting(event.isCompacting);
      return;
    }

    if (event.type === "messages:replace") {
      postToWebview({
        command: "updateMessages",
        messages: event.messages,
        ...(typeof event.hasMore === "boolean" ? { hasMore: event.hasMore } : {}),
      });
      return;
    }

    if (event.type === "messages:append") {
      postToWebview({
        command: "appendMessages",
        messages: event.messages,
      });
      return;
    }

    // Subagent streams belong inside the parent Agent tool block. Forward them
    // into the nested transcript store — never as top-level chat messages.
    if (event.type === "subagent:assistant:message") {
      postToWebview({
        command: "appendSubagentMessage",
        subagentId: event.subagentId,
        messageId: event.messageId,
      });
      return;
    }

    if (event.type === "subagent:message:delta") {
      postToWebview({
        command: "updateSubagentStreamingContent",
        subagentId: event.subagentId,
        messageId: event.messageId,
        chunk: event.text,
        stage: event.stage ?? "streaming",
      });
      return;
    }

    if (event.type === "subagent:reasoning:delta") {
      return;
    }

    if (event.type === "subagent:tool:update") {
      postToWebview({
        command: "updateSubagentToolBlock",
        subagentId: event.subagentId,
        params: event.params,
      });
      return;
    }

    if (event.type === "subagent:messages") {
      postToWebview({
        command: "setSubagentMessages",
        subagentId: event.subagentId,
        messages: event.messages,
      });
      return;
    }

    if (event.type === "tasks:update") {
      postToWebview({ command: "updateTasks", tasks: event.tasks });
      return;
    }
    if (event.type === "background-tasks:update") {
      postToWebview({ command: "updateBackgroundTasks", tasks: event.tasks });
      return;
    }
    if (event.type === "workflow-runs:update") {
      postToWebview({ command: "updateWorkflowRuns", runs: event.runs });
      return;
    }
    if (event.type === "mcp:update") {
      postToWebview({ command: "mcpServersUpdate", servers: event.servers });
      return;
    }
    if (event.type === "permission-mode") {
      postToWebview({ command: "updatePermissionMode", mode: event.mode });
      return;
    }
    if (event.type === "tokens:update") {
      ctx.latestTokens = event.latestTotalTokens;
      return;
    }
  };

  async function ensureSession(): Promise<string> {
    await ctx.ensureWs();
    if (ctx.sessionId && !ctx.pendingNewSession) return ctx.sessionId;

    // Explicit「新对话」: always create a fresh session on first send.
    if (ctx.pendingNewSession || !ctx.sessionId) {
      if (!ctx.pendingNewSession) {
        const grouped = await ctx.api.listSessionsGrouped();
        ctx.applyGrouped(grouped);
        const activeId = grouped.activeSessionId;
        if (activeId) {
          const candidate =
            grouped.pinned.find((s) => s.id === activeId) ??
            grouped.recent.find((s) => s.id === activeId);
          // Only reuse activeSessionId when it belongs to the current workdir.
          if (candidate && candidate.workdir === (ctx.currentWorkdir || "/")) {
            const { session } = await ctx.api.selectSession(activeId);
            ctx.sessionId = session.id;
            ctx.emitCurrentSession(session);
            return ctx.sessionId;
          }
        }
      }

      const session = await ctx.api.createSession(
        ctx.currentWorkdir || undefined,
        {
          // 仅用户手动选过模型（draftModel 有值）才传 model；否则不传，让 server
          // 回落 agent.model（勿用默认值兜底，否则会覆盖 agent 预设的模型）。
          ...(ctx.draftModel ? { model: ctx.draftModel } : {}),
          permissionMode: ctx.draftPermissionMode,
        },
      );
      await ctx.api.selectSession(session.id);
      ctx.sessionId = session.id;
      ctx.pendingNewSession = false;
      ctx.suppressWorkdirPush = false;
      ctx.draftModel = undefined;
      ctx.draftPermissionMode = "acceptEdits";
      // Server may have minted ~/.muse-work/projects/<date>-<uid>.
      if (session.workdir) {
        ctx.rememberRecentWorkdir(session.workdir);
        ctx.emitWorkdirState({
          workdir: session.workdir,
          recentWorkdirs: ctx.recentWorkdirs,
        });
        // Persist recents via Electron when available.
        ctx.outer?.postMessage({
          command: "desktopSelectRecentWorkdir",
          path: session.workdir,
        });
      }
      ctx.emitCurrentSession(session);
      await ctx.refreshTree();
      return ctx.sessionId;
    }

    return ctx.sessionId;
  }

  async function handleSendMessage(msg: {
    text?: string;
    images?: unknown;
    sessionId?: string;
  }): Promise<void> {
    const text = (msg.text ?? "").trim();
    const images = ctx.normalizeOutboundImages(msg.images);
    if (!text && images.length === 0) return;

    // While the AI is busy the SDK queues this message instead of running a
    // new turn. Skip the optimistic user bubble — it appears in the queue and
    // lands in the transcript only when the SDK actually dispatches it
    // (user:message broadcast via onUserMessageAdded).
    const queuing = ctx.loading;
    if (!queuing) {
      const userId = newId("user");
      const blocks: Array<Record<string, unknown>> = [];
      // Text first, then images — the bubble renders prompt above 72px thumbs.
      if (text) {
        blocks.push({ type: "text", content: text });
      }
      if (images.length > 0) {
        blocks.push({
          type: "image",
          imageUrls: images.map((img) => img.data),
        });
      }
      postToWebview({
        command: "appendMessage",
        message: {
          id: userId,
          role: "user",
          timestamp: new Date().toISOString(),
          blocks,
        },
      });
    }

    try {
      let sid = ctx.sessionId;
      const targetId =
        typeof msg.sessionId === "string" && msg.sessionId.trim()
          ? msg.sessionId.trim()
          : undefined;
      if (targetId && targetId !== ctx.sessionId) {
        await ctx.activateSession(targetId);
      }
      sid = ctx.sessionId ?? (await ensureSession());
      ctx.streamingMessageId = null;
      ctx.knownAssistantIds.clear();
      ctx.aborted = false;
      if (!queuing) {
        ctx.setLoading(true);
        postToWebview({ command: "startStreaming" });
      }
      await ctx.api.sendMessage(sid, text, images.length > 0 ? images : undefined);
      if (text) {
        ctx.maybePatchTitle(sid, text);
      }
      // First send promotes the session into the sidebar (started filter).
      await ctx.refreshTree();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      postToWebview({
        command: "updateErrorBlock",
        error: errorText,
      });
      ctx.maybePromptAuthDialog(errorText);
      // A queued send failing must not stop the turn that is already running.
      if (!queuing) {
        postToWebview({ command: "endStreaming" });
        ctx.setLoading(false);
        ctx.streamingMessageId = null;
      }
    }
  }

  async function handleAbortMessage(msg?: { sessionId?: string }): Promise<void> {
    const requested =
      typeof msg?.sessionId === "string" && msg.sessionId.trim()
        ? msg.sessionId.trim()
        : "";
    const sessionId = requested || ctx.sessionId;
    const abortingCurrent = !requested || requested === ctx.sessionId;
    if (abortingCurrent) {
      // Suppress straggler deltas of this turn from re-igniting streaming.
      ctx.aborted = true;
      // Optimistic UI: hide stop button immediately while the server aborts.
      if (ctx.streamingMessageId) {
        postToWebview({
          command: "updateStreamingContent",
          messageId: ctx.streamingMessageId,
          chunk: "",
          stage: "end",
        });
      }
      ctx.setLoading(false);
      ctx.streamingMessageId = null;
      ctx.knownAssistantIds.clear();
      postToWebview({ command: "endStreaming" });
      if (!sessionId || ctx.pendingNewSession) return;
    }
    if (!sessionId) return;
    try {
      await ctx.api.abortMessage(sessionId);
    } catch {
      // Server may already be idle; UI is already stopped.
    }
  }

  async function handleDeleteQueuedMessageById(msg: {
    id?: string;
  }): Promise<void> {
    const id = typeof msg.id === "string" ? msg.id : undefined;
    if (!id || !ctx.sessionId || ctx.pendingNewSession) return;
    try {
      await ctx.api.deleteQueuedMessageById(ctx.sessionId, id);
    } catch {
      // The optimistic UI removal stays; the next updateQueue sync corrects it.
    }
  }

  async function handleUpdateQueuedMessage(msg: {
    id?: string;
    text?: string;
    images?: unknown;
  }): Promise<void> {
    const id = typeof msg.id === "string" ? msg.id : undefined;
    const text = (msg.text ?? "").trim();
    if (!id || !ctx.sessionId || ctx.pendingNewSession) return;
    const images = ctx.normalizeOutboundImages(msg.images);
    try {
      await ctx.api.updateQueuedMessage(ctx.sessionId, id, {
        text,
        images: images.length > 0 ? images : undefined,
      });
    } catch {
      // The next updateQueue sync restores the server-side queue content.
    }
  }

  // 斜杠指令一律来自 agent.getSlashCommands（SDK 内置 /subtask + userInvocable
  // 技能）；无会话/请求失败时不回退硬编码系统指令，弹窗保持为空。
  const FALLBACK_SLASH_COMMANDS: Array<{
    id: string;
    name: string;
    description: string;
  }> = [];

  async function handleRequestSlashCommands(): Promise<void> {
    if (ctx.sessionId && !ctx.pendingNewSession) {
      try {
        const { commands } = await ctx.api.getSlashCommands(ctx.sessionId);
        postToWebview({ command: "slashCommandsResponse", commands });
      } catch {
        postToWebview({
          command: "slashCommandsResponse",
          commands: FALLBACK_SLASH_COMMANDS,
        });
      }
      return;
    }

    const workdir = ctx.currentWorkdir?.trim();
    if (workdir) {
      try {
        const { skills } = await ctx.api.getSkills(workdir);
        postToWebview({
          command: "slashCommandsResponse",
          commands: skillsToSlashCommands(skills),
        });
      } catch {
        postToWebview({
          command: "slashCommandsResponse",
          commands: FALLBACK_SLASH_COMMANDS,
        });
      }
      return;
    }

    const borrowedSessionId = resolveSlashCommandsSessionId(ctx);
    if (!borrowedSessionId) {
      postToWebview({
        command: "slashCommandsResponse",
        commands: FALLBACK_SLASH_COMMANDS,
      });
      return;
    }
    try {
      const { commands } = await ctx.api.getSlashCommands(borrowedSessionId);
      postToWebview({ command: "slashCommandsResponse", commands });
    } catch {
      postToWebview({
        command: "slashCommandsResponse",
        commands: FALLBACK_SLASH_COMMANDS,
      });
    }
  }

  async function handleClearChat(): Promise<void> {
    if (!ctx.sessionId || ctx.pendingNewSession) {
      postToWebview({ command: "updateMessages", messages: [] });
      return;
    }
    try {
      await ctx.api.clear(ctx.sessionId);
      const { messages } = await ctx.api.getMessages(ctx.sessionId);
      postToWebview({ command: "updateMessages", messages });
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleCompactChat(): Promise<void> {
    if (!ctx.sessionId || ctx.pendingNewSession) return;
    try {
      if (ctx.loading) await handleAbortMessage();
      await ctx.api.compact(ctx.sessionId);
    } catch (err) {
      ctx.compactingSessions.delete(ctx.sessionId);
      emitCompacting(false);
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleListRewindCheckpoints(): Promise<void> {
    if (!ctx.sessionId || ctx.pendingNewSession) {
      postToWebview({ command: "rewindCheckpoints", checkpoints: [] });
      return;
    }
    try {
      const { checkpoints } = await ctx.api.listRewindCheckpoints(ctx.sessionId);
      postToWebview({ command: "rewindCheckpoints", checkpoints });
    } catch {
      postToWebview({ command: "rewindCheckpoints", checkpoints: [] });
    }
  }

  async function handleRewindToMessage(msg: {
    messageId?: string;
  }): Promise<void> {
    const messageId = typeof msg.messageId === "string" ? msg.messageId : "";
    if (!messageId || !ctx.sessionId || ctx.pendingNewSession) return;
    try {
      if (ctx.loading) await handleAbortMessage();
      const result = await ctx.api.rewind(ctx.sessionId, messageId);
      const { messages } = await ctx.api.getMessages(ctx.sessionId);
      postToWebview({
        command: "setInitialState",
        messages,
        inputContent: result.inputContent,
      });
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleSetPermissionMode(msg: { mode?: string }): Promise<void> {
    const mode =
      msg.mode === "bypassPermissions" ? "bypassPermissions" : "acceptEdits";
    emitPermissionMode(mode);
    if (!ctx.sessionId || ctx.pendingNewSession) {
      ctx.draftPermissionMode = mode;
      return;
    }
    try {
      await ctx.api.patchSession(ctx.sessionId, { permissionMode: mode });
    } catch {
      // Keep optimistic UI; next session load will reconcile.
    }
  }

  async function handleGetMcpServers(): Promise<void> {
    if (!ctx.sessionId || ctx.pendingNewSession) {
      postToWebview({ command: "mcpServersResponse", servers: [] });
      return;
    }
    try {
      const { servers } = await ctx.api.getMcpServers(ctx.sessionId);
      postToWebview({ command: "mcpServersResponse", servers });
    } catch {
      postToWebview({ command: "mcpServersResponse", servers: [] });
    }
  }

  async function handleConnectMcpServer(msg: {
    serverName?: string;
  }): Promise<void> {
    const name = typeof msg.serverName === "string" ? msg.serverName : "";
    if (!name || !ctx.sessionId || ctx.pendingNewSession) return;
    try {
      await ctx.api.connectMcpServer(ctx.sessionId, name);
      const { servers } = await ctx.api.getMcpServers(ctx.sessionId);
      postToWebview({ command: "mcpServersUpdate", servers });
    } catch {
      // McpDialog stays on previous list.
    }
  }

  async function handleDisconnectMcpServer(msg: {
    serverName?: string;
  }): Promise<void> {
    const name = typeof msg.serverName === "string" ? msg.serverName : "";
    if (!name || !ctx.sessionId || ctx.pendingNewSession) return;
    try {
      await ctx.api.disconnectMcpServer(ctx.sessionId, name);
      const { servers } = await ctx.api.getMcpServers(ctx.sessionId);
      postToWebview({ command: "mcpServersUpdate", servers });
    } catch {
      // McpDialog stays on previous list.
    }
  }

  return {
    emitChatWs,
    resetChatStreaming,
    handleSendMessage,
    handleAbortMessage,
    handleDeleteQueuedMessageById,
    handleUpdateQueuedMessage,
    handleRequestSlashCommands,
    handleClearChat,
    handleCompactChat,
    handleListRewindCheckpoints,
    handleRewindToMessage,
    handleSetPermissionMode,
    handleGetMcpServers,
    handleConnectMcpServer,
    handleDisconnectMcpServer,
  };
}
