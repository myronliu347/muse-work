import type { DesktopSessionEntry, DesktopSessionGroup, VsCodeApi } from "../types";
import {
  MuseApiClient,
  type MuseSession,
  type MuseSessionsGrouped,
} from "./apiClient.js";
import { MuseWsClient, type MuseWsEvent, type MuseWsStatus } from "./wsClient.js";
import { DEFAULT_SESSION_MODEL_ID } from "./defaultModel.js";

export interface HostBridgeOptions {
  api: MuseApiClient;
  ws: MuseWsClient;
  /** Default workdir for createSession */
  workdir?: string;
  /** Optional outer host API for unhandled commands */
  outer?: VsCodeApi;
  openExternal?: (url: string) => void;
}

const DEFAULT_TITLE = "新对话";
const TITLE_MAX_LEN = 40;

type TreeSession = MuseSession & {
  unreadDone?: boolean;
  running?: boolean;
  waitingConfirmation?: boolean;
};

function postToWebview(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function truncateTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_TITLE;
  return trimmed.length > TITLE_MAX_LEN
    ? `${trimmed.slice(0, TITLE_MAX_LEN)}…`
    : trimmed;
}

function toEntry(session: TreeSession): DesktopSessionEntry {
  return {
    sessionId: session.id,
    title: session.title || DEFAULT_TITLE,
    lastActiveAt: session.lastActiveAt ?? session.createdAt,
    workdir: session.workdir,
    hasWorktree: Boolean(session.worktreeName),
    worktreeName: session.worktreeName,
    worktreeBranch: session.worktreeBranch,
    running: session.running ?? session.status === "running",
    waitingConfirmation: session.waitingConfirmation,
    pinned: session.pinned,
    unreadDone: session.unreadDone,
  };
}

/**
 * Assemble temporary DesktopSessionGroup[] for pin/recent until Task 6 redesigns Sidebar props.
 */
export function buildSidebarModel(grouped: {
  pinned: TreeSession[];
  recent: TreeSession[];
}): DesktopSessionGroup[] {
  return [
    {
      host: "local",
      workdir: "pin",
      sessions: grouped.pinned.map(toEntry),
    },
    {
      host: "local",
      workdir: "recent",
      sessions: grouped.recent.map(toEntry),
    },
  ];
}

function mergeRuntimeFields(
  sessions: MuseSession[],
  prevById: Map<string, TreeSession>,
): TreeSession[] {
  return sessions.map((s) => {
    const prev = prevById.get(s.id);
    return {
      ...s,
      unreadDone: prev?.unreadDone ?? s.unreadDone,
      // Prefer API status so refresh clears sticky local running.
      running: s.status === "running",
      waitingConfirmation: prev?.waitingConfirmation,
    };
  });
}

type PendingPermission = {
  permissionId: string;
  toolName: string;
  description: string;
  toolInput?: Record<string, unknown>;
  planContent?: string;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  permissionMode?: string;
  toolCallId?: string;
};

function confirmationTypeForTool(toolName: string): string {
  switch (toolName) {
    case "AskUserQuestion":
      return "问题待回答";
    case "Bash":
      return "Bash 命令执行确认";
    case "Edit":
    case "Write":
      return "代码修改确认";
    case "ExitPlanMode":
      return "计划执行确认";
    case "EnterPlanMode":
      return "进入计划模式确认";
    default:
      if (toolName.startsWith("mcp__")) return "MCP 工具确认";
      return "工具确认";
  }
}

/** Normalize WS toolInput; fall back to parsing description when older servers omit it. */
function resolveToolInput(pending: PendingPermission): Record<string, unknown> {
  if (pending.toolInput && typeof pending.toolInput === "object") {
    return pending.toolInput;
  }
  const prefix = `${pending.toolName}: `;
  if (pending.description.startsWith(prefix)) {
    try {
      const parsed: unknown = JSON.parse(
        pending.description.slice(prefix.length),
      );
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }
  // Legacy hostBridge stored the bare command string as description for Bash.
  if (pending.toolName === "Bash" && pending.description.trim()) {
    return { command: pending.description };
  }
  return {};
}

/**
 * Minimal host bridge: maps legacy webview postMessage commands onto Muse HTTP/WS.
 * Compatible subset: login / logout / sendMessage / confirmationResponse (+ auth bootstrap).
 * Also bootstraps desktop workdir state so DesktopApp is not stuck on loading.
 */
export function createHostBridge(opts: HostBridgeOptions): VsCodeApi {
  const { api, ws } = opts;
  let currentWorkdir = opts.workdir ?? "/";
  let recentWorkdirs: string[] = [];
  const openExternal =
    opts.openExternal ??
    ((url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    });

  let sessionId: string | null = null;
  /** True after「新对话」until the first send creates a real session. */
  let pendingNewSession = false;
  /**
   * When true, ignore Electron `desktopWorkdirState` workdir pushes so a
   * persisted last-folder cannot overwrite the new-session null default.
   * Cleared when the user explicitly picks a folder/recent.
   */
  let suppressWorkdirPush = false;
  let draftModel: string | undefined;
  let streamingMessageId: string | null = null;
  const knownAssistantIds = new Set<string>();
  let state: unknown = null;
  let bootstrapped = false;
  let loading = false;
  let latestTokens = 0;
  let wsConnected = false;
  let toastedInterrupted = false;
  let wsEverOpened = false;
  let pinned: TreeSession[] = [];
  let recent: TreeSession[] = [];
  const titledSessions = new Set<string>();
  /** Cached permission:request for non-focus (and active) sessions until responded/disposed. */
  const pendingPermissions = new Map<string, PendingPermission>();

  const DRAFT_SESSION_ID = "__draft__";

  const emitDraftSession = () => {
    postToWebview({
      command: "updateCurrentSession",
      session: {
        id: DRAFT_SESSION_ID,
        title: DEFAULT_TITLE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: draftModel ?? DEFAULT_SESSION_MODEL_ID,
      },
    });
  };

  const treeById = (): Map<string, TreeSession> => {
    const map = new Map<string, TreeSession>();
    for (const s of pinned) map.set(s.id, s);
    for (const s of recent) map.set(s.id, s);
    return map;
  };

  const publishAgentBusy = (): void => {
    const anyRunning =
      loading ||
      pinned.some((s) => s.running) ||
      recent.some((s) => s.running);
    opts.outer?.postMessage({
      command: "desktopAgentBusy",
      busy: anyRunning,
    });
  };

  const setLoading = (next: boolean): void => {
    loading = next;
    publishAgentBusy();
  };

  const emitSessionTree = () => {
    postToWebview({
      command: "desktopSessionTree",
      groups: buildSidebarModel({ pinned, recent }),
    });
    publishAgentBusy();
  };

  const applyGrouped = (grouped: MuseSessionsGrouped) => {
    const prev = treeById();
    pinned = mergeRuntimeFields(grouped.pinned, prev);
    recent = mergeRuntimeFields(grouped.recent, prev);
    emitSessionTree();
  };

  const patchTreeSession = (
    id: string,
    patch: Partial<TreeSession>,
  ): void => {
    const apply = (list: TreeSession[]) =>
      list.map((s) => (s.id === id ? { ...s, ...patch } : s));
    pinned = apply(pinned);
    recent = apply(recent);
    emitSessionTree();
  };

  const clearUnread = (id: string) => {
    patchTreeSession(id, { unreadDone: false });
  };

  const showPermissionConfirmation = (pending: PendingPermission) => {
    postToWebview({
      command: "showConfirmation",
      confirmationId: pending.permissionId,
      toolName: pending.toolName,
      confirmationType: confirmationTypeForTool(pending.toolName),
      toolInput: resolveToolInput(pending),
      planContent: pending.planContent,
      suggestedPrefix: pending.suggestedPrefix,
      hidePersistentOption: pending.hidePersistentOption,
      permissionMode: pending.permissionMode,
    });
  };

  const clearPendingPermission = (id: string) => {
    if (!pendingPermissions.has(id)) return;
    pendingPermissions.delete(id);
    patchTreeSession(id, { waitingConfirmation: false });
  };

  const emitCurrentSession = (session: MuseSession) => {
    postToWebview({
      command: "updateCurrentSession",
      session: {
        id: session.id,
        title: session.title || DEFAULT_TITLE,
        createdAt: session.createdAt,
        updatedAt: session.lastActiveAt ?? session.createdAt,
        model: session.model,
        workdir: session.workdir,
        worktreeName: session.worktreeName,
        worktreeBranch: session.worktreeBranch,
        baseBranch: session.baseBranch,
      },
    });
  };

  const resetChatStreaming = () => {
    streamingMessageId = null;
    knownAssistantIds.clear();
    setLoading(false);
    postToWebview({ command: "endStreaming" });
  };

  const showServerToast = (message: string): void => {
    postToWebview({
      command: "showToast",
      toast: { id: "muse-server", message },
    });
  };

  const resyncAfterReconnect = async (): Promise<void> => {
    try {
      const grouped = await refreshTree();
      const runningIds = new Set(
        [...grouped.pinned, ...grouped.recent]
          .filter((s) => s.status === "running")
          .map((s) => s.id),
      );
      for (const id of [...pendingPermissions.keys()]) {
        if (!runningIds.has(id)) pendingPermissions.delete(id);
      }
      for (const session of [...grouped.pinned, ...grouped.recent]) {
        if (!runningIds.has(session.id)) {
          patchTreeSession(session.id, { waitingConfirmation: false });
        }
      }
      if (!sessionId || pendingNewSession) return;
      await loadMessages(sessionId);
      if (!runningIds.has(sessionId)) {
        resetChatStreaming();
      }
    } catch {
      // Server may still be down; leave UI as-is until the next attempt.
    }
  };

  const ensureAssistantMessage = (
    messageId: string,
    opts?: { trackMain?: boolean },
  ): void => {
    const trackMain = opts?.trackMain !== false;
    if (knownAssistantIds.has(messageId)) {
      if (trackMain) streamingMessageId = messageId;
      return;
    }
    knownAssistantIds.add(messageId);
    if (trackMain) streamingMessageId = messageId;
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

  const syncChatWorkdir = (workdir: string | undefined) => {
    postToWebview({ command: "updateWorkdir", workdir });
  };

  const emitWorkdirState = (patch?: {
    workdir?: string | null;
    recentWorkdirs?: string[];
    clearSession?: boolean;
    /** When true, clear current workdir (new-session default). */
    clearWorkdir?: boolean;
  }) => {
    if (patch?.clearWorkdir) {
      currentWorkdir = "";
      if (patch.clearSession) sessionId = null;
    } else if (typeof patch?.workdir === "string" && patch.workdir) {
      currentWorkdir = patch.workdir;
      if (patch.clearSession) sessionId = null;
    }
    if (patch?.recentWorkdirs) {
      recentWorkdirs = patch.recentWorkdirs;
    }
    const workdir = currentWorkdir || undefined;
    postToWebview({
      command: "desktopWorkdirState",
      workdir,
      recentWorkdirs,
      host: "local",
      hosts: [],
    });
    syncChatWorkdir(workdir);
  };

  type PendingWorktree = {
    text: string;
    images?: unknown;
    resolve: (value: {
      ok: true;
      name: string;
      path: string;
      branch: string;
      baseBranch: string;
      repoRoot: string;
    } | { ok: false; error: string }) => void;
  };
  const pendingWorktrees = new Map<string, PendingWorktree>();

  // Keep createSession workdir in sync when Electron main (or tests) push state.
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as {
      command?: string;
      workdir?: string;
      recentWorkdirs?: string[];
      requestId?: string;
      name?: string;
      path?: string;
      branch?: string;
      baseBranch?: string;
      repoRoot?: string;
      error?: string;
    };
    if (message?.command === "desktopWorktreeCreated") {
      const reqId =
        typeof message.requestId === "string" ? message.requestId : "";
      const pending = reqId ? pendingWorktrees.get(reqId) : undefined;
      if (pending) {
        pendingWorktrees.delete(reqId);
        if (typeof message.error === "string" && message.error) {
          pending.resolve({ ok: false, error: message.error });
        } else if (
          typeof message.name === "string" &&
          typeof message.path === "string" &&
          typeof message.branch === "string" &&
          typeof message.repoRoot === "string"
        ) {
          pending.resolve({
            ok: true,
            name: message.name,
            path: message.path,
            branch: message.branch,
            baseBranch:
              typeof message.baseBranch === "string"
                ? message.baseBranch
                : "HEAD",
            repoRoot: message.repoRoot,
          });
        } else {
          pending.resolve({ ok: false, error: "创建 worktree 返回不完整" });
        }
      }
      return;
    }
    if (message?.command === "desktopPrepareQuit") {
      void (async () => {
        const ids = new Set<string>();
        if (sessionId && !pendingNewSession) ids.add(sessionId);
        for (const s of [...pinned, ...recent]) {
          if (s.running) ids.add(s.id);
        }
        await handleAbortMessage();
        for (const id of ids) {
          if (id === sessionId) continue;
          try {
            await api.abortMessage(id);
          } catch {
            // best-effort
          }
        }
        setLoading(false);
        publishAgentBusy();
        opts.outer?.postMessage({ command: "desktopPrepareQuitDone" });
      })();
      return;
    }
    if (message?.command === "museServerLifecycle") {
      const state = (message as { state?: string }).state;
      if (state === "restarting") {
        showServerToast("本地服务已退出，正在重新拉起…");
        return;
      }
      if (state === "ready") {
        showServerToast("本地服务已恢复");
        void (async () => {
          await (typeof ws.reconnectNow === "function"
            ? ws.reconnectNow()
            : ws.connect("*"));
          await resyncAfterReconnect();
        })();
        return;
      }
      if (state === "resume") {
        void (async () => {
          await (typeof ws.reconnectNow === "function"
            ? ws.reconnectNow()
            : ws.connect("*"));
          await resyncAfterReconnect();
        })();
        return;
      }
      if (state === "dead" || state === "failed") {
        showServerToast("本地服务无法恢复，请重启应用");
        resetChatStreaming();
      }
      return;
    }
    if (message?.command !== "desktopWorkdirState") return;
    if (Array.isArray(message.recentWorkdirs)) {
      recentWorkdirs = message.recentWorkdirs;
    }
    if (suppressWorkdirPush) return;
    if (typeof message.workdir === "string" && message.workdir) {
      if (message.workdir !== currentWorkdir) {
        sessionId = null;
      }
      currentWorkdir = message.workdir;
      syncChatWorkdir(currentWorkdir);
    }
  });

  const ensureWs = async (): Promise<void> => {
    if (wsConnected) {
      await ws.connect("*");
      return;
    }
    await ws.connect("*");
    wsConnected = true;
  };

  const refreshTree = async (): Promise<MuseSessionsGrouped> => {
    const grouped = await api.listSessionsGrouped();
    applyGrouped(grouped);
    return grouped;
  };

  const loadMessages = async (id: string): Promise<void> => {
    const { messages } = await api.getMessages(id);
    postToWebview({ command: "updateMessages", messages });
  };

  const pushSessionControlState = async (id: string): Promise<void> => {
    try {
      const { tasks } = await api.getBackgroundTasks(id);
      postToWebview({
        command: "updateBackgroundTasks",
        tasks: Array.isArray(tasks) ? tasks : [],
      });
    } catch {
      postToWebview({ command: "updateBackgroundTasks", tasks: [] });
    }
    try {
      const { runs } = await api.getWorkflowRuns(id);
      postToWebview({
        command: "updateWorkflowRuns",
        runs: Array.isArray(runs) ? runs : [],
      });
    } catch {
      postToWebview({ command: "updateWorkflowRuns", runs: [] });
    }
  };

  const activateSession = async (id: string): Promise<MuseSession> => {
    pendingNewSession = false;
    suppressWorkdirPush = false;
    const { session } = await api.selectSession(id);
    sessionId = session.id;
    clearUnread(session.id);
    if (session.workdir) {
      emitWorkdirState({ workdir: session.workdir });
    }
    resetChatStreaming();
    emitCurrentSession(session);
    await loadMessages(session.id);
    await pushSessionControlState(session.id);
    await refreshTree();
    const pending = pendingPermissions.get(session.id);
    if (pending) {
      showPermissionConfirmation(pending);
    }
    return session;
  };

  const handleNewSession = async (workdir?: string): Promise<void> => {
    // Lazy create: do not POST /sessions until the first user message.
    pendingNewSession = true;
    sessionId = null;
    draftModel = undefined;
    resetChatStreaming();
    postToWebview({ command: "updateMessages", messages: [] });
    postToWebview({ command: "updateBackgroundTasks", tasks: [] });
    postToWebview({ command: "updateWorkflowRuns", runs: [] });
    postToWebview({ command: "updateTasks", tasks: [] });
    if (workdir) {
      // Workdir-group "+": draft session with that directory pre-selected.
      suppressWorkdirPush = false;
      const nextRecent = [
        workdir,
        ...recentWorkdirs.filter((p) => p !== workdir),
      ].slice(0, 10);
      emitWorkdirState({ workdir, recentWorkdirs: nextRecent });
      opts.outer?.postMessage({
        command: "desktopSelectRecentWorkdir",
        path: workdir,
      });
    } else {
      suppressWorkdirPush = true;
      // New session starts with no workdir; first send auto-creates one.
      emitWorkdirState({ clearWorkdir: true });
    }
    emitDraftSession();
    try {
      await refreshTree();
    } catch {
      // Sidebar can stay stale; retry on the next successful WS open.
    }
    try {
      await ensureWs();
    } catch {
      // Draft composer is already up; reconnect will resync.
    }
  };

  const handleDeleteSession = async (id: string): Promise<void> => {
    const wasActive = sessionId === id;
    clearPendingPermission(id);
    const existing =
      pinned.find((s) => s.id === id) ?? recent.find((s) => s.id === id);
    // Drop the session-scoped PTY so deleted chats do not leak shells.
    opts.outer?.postMessage({
      command: "desktopTerminalKill",
      termId: `term-${id}`,
    });
    if (
      existing?.worktreeName &&
      existing.worktreeBranch &&
      existing.worktreeRepoRoot &&
      existing.workdir
    ) {
      opts.outer?.postMessage({
        command: "desktopRemoveWorktree",
        path: existing.workdir,
        branch: existing.worktreeBranch,
        repoRoot: existing.worktreeRepoRoot,
      });
    }
    await api.deleteSession(id);
    if (!wasActive) {
      await refreshTree();
      return;
    }
    const grouped = await refreshTree();
    const next = grouped.recent[0] ?? grouped.pinned[0];
    if (next) {
      await activateSession(next.id);
    } else {
      await handleNewSession();
    }
  };

  const handleTogglePin = async (
    id: string,
    pinnedNext: boolean,
  ): Promise<void> => {
    await api.patchSession(id, { pinned: pinnedNext });
    await refreshTree();
  };

  const handleRenameSession = async (
    id: string,
    title: string,
  ): Promise<void> => {
    const next = title.trim();
    if (!next) return;
    const session = await api.patchSession(id, { title: next });
    titledSessions.add(id);
    patchTreeSession(id, { title: session.title || next });
    if (sessionId === id) {
      emitCurrentSession(session);
    }
  };

  const handleSetSessionModel = async (model: string): Promise<void> => {
    if (!model) return;
    if (!sessionId || pendingNewSession) {
      draftModel = model;
      emitDraftSession();
      return;
    }
    const session = await api.patchSession(sessionId, { model });
    patchTreeSession(sessionId, { model: session.model });
    emitCurrentSession(session);
  };

  const emitChatWs = (event: MuseWsEvent) => {
    if (event.type === "loading") {
      setLoading(event.loading);
      postToWebview({
        command: event.loading ? "startStreaming" : "endStreaming",
      });
      if (!event.loading) {
        streamingMessageId = null;
        knownAssistantIds.clear();
      }
      return;
    }

    if (event.type === "assistant:message") {
      ensureAssistantMessage(event.messageId);
      if (!loading) {
        setLoading(true);
        postToWebview({ command: "startStreaming" });
      }
      return;
    }

    if (event.type === "message:delta") {
      const messageId = event.messageId || streamingMessageId || newId("asst");
      ensureAssistantMessage(messageId);
      if (!loading) {
        setLoading(true);
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
      ensureAssistantMessage(event.messageId);
      if (!loading) {
        setLoading(true);
        postToWebview({ command: "startStreaming" });
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
          : streamingMessageId || newId("asst");
      ensureAssistantMessage(messageId);
      if (!loading) {
        setLoading(true);
        postToWebview({ command: "startStreaming" });
      }
      postToWebview({
        command: "updateToolBlock",
        params: { ...params, messageId },
      });
      return;
    }

    if (event.type === "message:completed") {
      const messageId = event.messageId || streamingMessageId;
      if (messageId) {
        postToWebview({
          command: "updateStreamingContent",
          messageId,
          chunk: "",
          stage: "end",
        });
      }
      if (!loading) {
        streamingMessageId = null;
        knownAssistantIds.clear();
        postToWebview({ command: "endStreaming" });
      }
      return;
    }

    if (event.type === "session:status" && event.status === "error") {
      postToWebview({
        command: "updateErrorBlock",
        error: event.error?.trim() || "Session error",
      });
      postToWebview({ command: "endStreaming" });
      streamingMessageId = null;
      knownAssistantIds.clear();
      setLoading(false);
      return;
    }

    if (event.type === "compaction:state") {
      postToWebview({
        command: "compactionStateChange",
        isCompacting: event.isCompacting,
      });
      return;
    }

    if (event.type === "messages:replace") {
      postToWebview({
        command: "updateMessages",
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
      latestTokens = event.latestTotalTokens;
      return;
    }
  };

  const emitWs = (event: MuseWsEvent) => {
    if (event.type === "auth:changed") {
      const status = event.status as { state?: string } | undefined;
      postToWebview({
        command: "authStatusResponse",
        isAuthenticated: status?.state === "authenticated",
      });
      return;
    }

    if (event.type === "session:unread") {
      patchTreeSession(event.sessionId, { unreadDone: event.unreadDone });
      return;
    }

    if (event.type === "permission:request") {
      const pending: PendingPermission = {
        permissionId: event.permissionId,
        toolName: event.toolName,
        description: event.description,
        toolInput: event.toolInput,
        planContent: event.planContent,
        suggestedPrefix: event.suggestedPrefix,
        hidePersistentOption: event.hidePersistentOption,
        permissionMode: event.permissionMode,
        toolCallId: event.toolCallId,
      };
      pendingPermissions.set(event.sessionId, pending);
      // Sidebar must show waiting even when this session is not focused.
      patchTreeSession(event.sessionId, {
        waitingConfirmation: true,
        running: true,
      });
      if (event.sessionId === sessionId) {
        showPermissionConfirmation(pending);
      }
      return;
    }

    if (event.type === "session:status") {
      const hasPending = pendingPermissions.has(event.sessionId);
      const running = event.status === "running" || hasPending;
      patchTreeSession(event.sessionId, {
        status: event.status,
        running,
        // Do not wipe waitingConfirmation while a permission is still pending.
        ...(hasPending ? {} : { waitingConfirmation: false }),
      });
      if (event.sessionId === sessionId && event.status === "error") {
        emitChatWs(event);
      }
      return;
    }

    if (event.type === "loading") {
      const hasPending = pendingPermissions.has(event.sessionId);
      // Keep sidebar spinner for background sessions; ChatApp only for focus.
      patchTreeSession(event.sessionId, {
        running: event.loading || hasPending,
      });
      if (event.sessionId === sessionId) {
        emitChatWs(event);
      }
      return;
    }

    // Chat / streaming events only drive ChatApp for the active session.
    if (event.sessionId !== sessionId) return;
    emitChatWs(event);
  };

  ws.onEvent(emitWs);
  ws.onStatus?.((status: MuseWsStatus) => {
    if (status === "closed") {
      showServerToast("连接已断开，正在重连…");
      return;
    }
    if (status !== "open") return;
    if (!wsEverOpened) {
      wsEverOpened = true;
      return;
    }
    showServerToast("已重新连接");
    void resyncAfterReconnect();
  });

  async function ensureSession(): Promise<string> {
    await ensureWs();
    if (sessionId && !pendingNewSession) return sessionId;

    // Explicit「新对话」: always create a fresh session on first send.
    if (pendingNewSession || !sessionId) {
      if (!pendingNewSession) {
        const grouped = await api.listSessionsGrouped();
        applyGrouped(grouped);
        const activeId = grouped.activeSessionId;
        if (activeId) {
          const candidate =
            grouped.pinned.find((s) => s.id === activeId) ??
            grouped.recent.find((s) => s.id === activeId);
          // Only reuse activeSessionId when it belongs to the current workdir.
          if (candidate && candidate.workdir === (currentWorkdir || "/")) {
            const { session } = await api.selectSession(activeId);
            sessionId = session.id;
            emitCurrentSession(session);
            return sessionId;
          }
        }
      }

      const session = await api.createSession(
        currentWorkdir || undefined,
        { model: draftModel ?? DEFAULT_SESSION_MODEL_ID },
      );
      await api.selectSession(session.id);
      sessionId = session.id;
      pendingNewSession = false;
      suppressWorkdirPush = false;
      draftModel = undefined;
      // Server may have minted ~/.muse-work/projects/<date>-<uid>.
      if (session.workdir) {
        const nextRecent = [
          session.workdir,
          ...recentWorkdirs.filter((p) => p !== session.workdir),
        ].slice(0, 10);
        emitWorkdirState({
          workdir: session.workdir,
          recentWorkdirs: nextRecent,
        });
        // Persist recents via Electron when available.
        opts.outer?.postMessage({
          command: "desktopSelectRecentWorkdir",
          path: session.workdir,
        });
      }
      emitCurrentSession(session);
      await refreshTree();
      return sessionId;
    }

    return sessionId;
  }

  async function refreshAuth(): Promise<void> {
    try {
      const status = await api.getAuthStatus();
      postToWebview({
        command: "authStatusResponse",
        isAuthenticated: status.state === "authenticated",
      });
    } catch {
      postToWebview({
        command: "authStatusResponse",
        isAuthenticated: false,
      });
    }
  }

  async function handleLogin(): Promise<void> {
    try {
      const start = await api.login();
      if (start && typeof start === "object" && "authUrl" in start && start.authUrl) {
        openExternal(start.authUrl);
        await api.login({ wait: true });
      }
      await refreshAuth();
      postToWebview({ command: "loginResponse", success: true });
    } catch (err) {
      postToWebview({
        command: "loginResponse",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleLogout(): Promise<void> {
    try {
      await api.logout();
      postToWebview({ command: "logoutResponse", success: true });
      postToWebview({ command: "authStatusResponse", isAuthenticated: false });
    } catch (err) {
      postToWebview({
        command: "logoutResponse",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function maybePatchTitle(sid: string, text: string): Promise<void> {
    if (titledSessions.has(sid)) return;
    const existing = treeById().get(sid);
    if (existing && existing.title && existing.title !== DEFAULT_TITLE) {
      titledSessions.add(sid);
      return;
    }
    const title = truncateTitle(text);
    try {
      await api.patchSession(sid, { title });
      titledSessions.add(sid);
      patchTreeSession(sid, { title });
      emitCurrentSession({
        ...(existing ?? {
          id: sid,
          workdir: currentWorkdir,
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          status: "idle",
          model: "",
          pinned: false,
        }),
        title,
      });
    } catch {
      // Title is best-effort; server also auto-titles.
    }
  }

  function normalizeOutboundImages(
    raw: unknown,
  ): Array<{ data: string; mediaType: string }> {
    if (!Array.isArray(raw)) return [];
    const out: Array<{ data: string; mediaType: string }> = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const data = (item as { data?: unknown }).data;
      const mediaType = (item as { mediaType?: unknown }).mediaType;
      if (typeof data !== "string" || !data) continue;
      out.push({
        data,
        mediaType:
          typeof mediaType === "string" && mediaType
            ? mediaType
            : "image/png",
      });
    }
    return out;
  }

  async function handleSendMessage(msg: {
    text?: string;
    images?: unknown;
  }): Promise<void> {
    const text = (msg.text ?? "").trim();
    const images = normalizeOutboundImages(msg.images);
    if (!text && images.length === 0) return;

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

    try {
      const sid = await ensureSession();
      streamingMessageId = null;
      knownAssistantIds.clear();
      setLoading(true);
      postToWebview({ command: "startStreaming" });
      await api.sendMessage(sid, text, images.length > 0 ? images : undefined);
      if (text) {
        await maybePatchTitle(sid, text);
      }
      // First send promotes the session into the sidebar (started filter).
      await refreshTree();
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
      postToWebview({ command: "endStreaming" });
      setLoading(false);
      streamingMessageId = null;
    }
  }

  async function handleAbortMessage(): Promise<void> {
    // Optimistic UI: hide stop button immediately while the server aborts.
    if (streamingMessageId) {
      postToWebview({
        command: "updateStreamingContent",
        messageId: streamingMessageId,
        chunk: "",
        stage: "end",
      });
    }
    setLoading(false);
    streamingMessageId = null;
    knownAssistantIds.clear();
    postToWebview({ command: "endStreaming" });

    if (!sessionId || pendingNewSession) return;
    try {
      await api.abortMessage(sessionId);
    } catch {
      // Server may already be idle; UI is already stopped.
    }
  }

  const FALLBACK_SLASH_COMMANDS = [
    { id: "compact", name: "compact", description: "压缩会话上下文" },
    { id: "clear", name: "clear", description: "清空当前会话" },
    { id: "rewind", name: "rewind", description: "回滚到检查点" },
    { id: "mcp", name: "mcp", description: "MCP 服务器" },
    { id: "status", name: "status", description: "会话状态" },
    { id: "tasks", name: "tasks", description: "后台任务" },
    { id: "workflows", name: "workflows", description: "工作流" },
  ];

  async function handleRequestSlashCommands(): Promise<void> {
    if (!sessionId || pendingNewSession) {
      postToWebview({
        command: "slashCommandsResponse",
        commands: FALLBACK_SLASH_COMMANDS,
      });
      return;
    }
    try {
      const { commands } = await api.getSlashCommands(sessionId);
      postToWebview({ command: "slashCommandsResponse", commands });
    } catch {
      postToWebview({
        command: "slashCommandsResponse",
        commands: FALLBACK_SLASH_COMMANDS,
      });
    }
  }

  async function handleClearChat(): Promise<void> {
    if (!sessionId || pendingNewSession) {
      postToWebview({ command: "updateMessages", messages: [] });
      return;
    }
    try {
      await api.clear(sessionId);
      const { messages } = await api.getMessages(sessionId);
      postToWebview({ command: "updateMessages", messages });
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleCompactChat(): Promise<void> {
    if (!sessionId || pendingNewSession) return;
    try {
      if (loading) await handleAbortMessage();
      await api.compact(sessionId);
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleListRewindCheckpoints(): Promise<void> {
    if (!sessionId || pendingNewSession) {
      postToWebview({ command: "rewindCheckpoints", checkpoints: [] });
      return;
    }
    try {
      const { checkpoints } = await api.listRewindCheckpoints(sessionId);
      postToWebview({ command: "rewindCheckpoints", checkpoints });
    } catch {
      postToWebview({ command: "rewindCheckpoints", checkpoints: [] });
    }
  }

  async function handleRewindToMessage(msg: {
    messageId?: string;
  }): Promise<void> {
    const messageId = typeof msg.messageId === "string" ? msg.messageId : "";
    if (!messageId || !sessionId || pendingNewSession) return;
    try {
      if (loading) await handleAbortMessage();
      const result = await api.rewind(sessionId, messageId);
      const { messages } = await api.getMessages(sessionId);
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
    postToWebview({ command: "updatePermissionMode", mode });
    if (!sessionId || pendingNewSession) return;
    try {
      await api.patchSession(sessionId, { permissionMode: mode });
    } catch {
      // Keep optimistic UI; next session load will reconcile.
    }
  }

  async function handleGetMcpServers(): Promise<void> {
    if (!sessionId || pendingNewSession) {
      postToWebview({ command: "mcpServersResponse", servers: [] });
      return;
    }
    try {
      const { servers } = await api.getMcpServers(sessionId);
      postToWebview({ command: "mcpServersResponse", servers });
    } catch {
      postToWebview({ command: "mcpServersResponse", servers: [] });
    }
  }

  async function handleConnectMcpServer(msg: {
    serverName?: string;
  }): Promise<void> {
    const name = typeof msg.serverName === "string" ? msg.serverName : "";
    if (!name || !sessionId || pendingNewSession) return;
    try {
      await api.connectMcpServer(sessionId, name);
      const { servers } = await api.getMcpServers(sessionId);
      postToWebview({ command: "mcpServersUpdate", servers });
    } catch {
      // McpDialog stays on previous list.
    }
  }

  async function handleDisconnectMcpServer(msg: {
    serverName?: string;
  }): Promise<void> {
    const name = typeof msg.serverName === "string" ? msg.serverName : "";
    if (!name || !sessionId || pendingNewSession) return;
    try {
      await api.disconnectMcpServer(sessionId, name);
      const { servers } = await api.getMcpServers(sessionId);
      postToWebview({ command: "mcpServersUpdate", servers });
    } catch {
      // McpDialog stays on previous list.
    }
  }

  async function handleGetStatus(): Promise<void> {
    if (!sessionId || pendingNewSession) {
      postToWebview({
        command: "statusResponse",
        sessionId: "",
        workdir: currentWorkdir,
        latestTotalTokens: latestTokens,
      });
      return;
    }
    try {
      const status = await api.getSessionStatus(sessionId);
      latestTokens = status.latestTotalTokens;
      postToWebview({
        command: "statusResponse",
        sessionId: status.sessionId,
        workdir: status.workdir,
        latestTotalTokens: status.latestTotalTokens,
        permissionMode: status.permissionMode,
      });
    } catch {
      postToWebview({
        command: "statusResponse",
        sessionId,
        workdir: currentWorkdir,
        latestTotalTokens: latestTokens,
      });
    }
  }

  async function handleGetBackgroundTasks(): Promise<void> {
    if (!sessionId || pendingNewSession) return;
    try {
      const { tasks } = await api.getBackgroundTasks(sessionId);
      postToWebview({ command: "updateBackgroundTasks", tasks });
    } catch {
      // Keep the WS snapshot; opening /tasks should not wipe a live list.
    }
  }

  async function handleGetBackgroundTaskOutput(msg: {
    taskId?: string;
  }): Promise<void> {
    const taskId = typeof msg.taskId === "string" ? msg.taskId : "";
    if (!taskId || !sessionId || pendingNewSession) return;
    try {
      const { output } = await api.getBackgroundTaskOutput(sessionId, taskId);
      postToWebview({
        command: "backgroundTaskOutput",
        taskId,
        output:
          output && typeof output === "object"
            ? output
            : { stdout: "", stderr: "", status: "failed" },
      });
    } catch {
      postToWebview({
        command: "backgroundTaskOutput",
        taskId,
        output: { stdout: "", stderr: "", status: "failed" },
      });
    }
  }

  async function handleStopBackgroundTask(msg: {
    taskId?: string;
  }): Promise<void> {
    const taskId = typeof msg.taskId === "string" ? msg.taskId : "";
    if (!taskId || !sessionId || pendingNewSession) return;
    try {
      await api.stopBackgroundTask(sessionId, taskId);
    } catch {
      // Still release the dialog stop spinner.
    }
    postToWebview({ command: "backgroundTaskStopped", taskId });
    await handleGetBackgroundTasks();
  }

  async function handleGetWorkflowRuns(): Promise<void> {
    if (!sessionId || pendingNewSession) {
      postToWebview({ command: "updateWorkflowRuns", runs: [] });
      return;
    }
    try {
      const { runs } = await api.getWorkflowRuns(sessionId);
      postToWebview({ command: "updateWorkflowRuns", runs });
    } catch {
      postToWebview({ command: "updateWorkflowRuns", runs: [] });
    }
  }

  async function handleStopWorkflowRun(msg: { runId?: string }): Promise<void> {
    const runId = typeof msg.runId === "string" ? msg.runId : "";
    if (!runId || !sessionId || pendingNewSession) return;
    try {
      await api.stopWorkflowRun(sessionId, runId);
      postToWebview({ command: "workflowRunStopped", runId });
    } catch {
      postToWebview({ command: "workflowRunStopped", runId });
    }
  }

  async function handleDesktopCreateWorktree(msg: {
    workdir?: string;
    baseBranch?: string;
    name?: string;
    text?: string;
    images?: unknown;
  }): Promise<void> {
    const workdir =
      (typeof msg.workdir === "string" && msg.workdir) || currentWorkdir;
    const text = (msg.text ?? "").trim();
    const images = normalizeOutboundImages(msg.images);
    if (!workdir) {
      postToWebview({
        command: "updateErrorBlock",
        error: "创建 worktree 失败：未选择仓库目录",
      });
      return;
    }
    if (!text && images.length === 0) return;

    const requestId = newId("wt");
    const created = await new Promise<
      | {
          ok: true;
          name: string;
          path: string;
          branch: string;
          baseBranch: string;
          repoRoot: string;
        }
      | { ok: false; error: string }
    >((resolve) => {
      pendingWorktrees.set(requestId, { text, images, resolve });
      opts.outer?.postMessage({
        command: "desktopCreateWorktree",
        requestId,
        workdir,
        baseBranch: msg.baseBranch,
        name: msg.name,
        text,
        images,
      });
      // If Electron is unavailable (tests without outer), fail fast.
      if (!opts.outer) {
        pendingWorktrees.delete(requestId);
        resolve({ ok: false, error: "桌面宿主不可用" });
      }
    });

    if (!created.ok) {
      postToWebview({
        command: "updateErrorBlock",
        error: `创建 worktree 失败：${created.error}`,
      });
      return;
    }

    // Switch createSession into the new worktree path.
    suppressWorkdirPush = false;
    currentWorkdir = created.path;
    syncChatWorkdir(created.path);
    pendingNewSession = true;
    sessionId = null;

    try {
      await ensureWs();
      const session = await api.createSession(created.path, {
        model: draftModel ?? DEFAULT_SESSION_MODEL_ID,
        worktreeName: created.name,
        worktreeBranch: created.branch,
        baseBranch: created.baseBranch,
        worktreeRepoRoot: created.repoRoot,
      });
      await api.selectSession(session.id);
      sessionId = session.id;
      pendingNewSession = false;
      draftModel = undefined;
      emitCurrentSession(session);
      await refreshTree();
      await handleSendMessage({ text, images });
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleConfirmationResponse(msg: {
    confirmationId?: string;
    approved?: boolean;
    decision?:
      | string
      | {
          behavior?: "allow" | "deny";
          message?: string;
          newPermissionMode?: string;
          newPermissionRule?: string;
        };
  }): Promise<void> {
    if (!sessionId || !msg.confirmationId) return;
    const sid = sessionId;

    let behavior: "allow" | "deny" = "allow";
    let message: string | undefined;
    let newPermissionMode: string | undefined;
    let newPermissionRule: string | undefined;

    if (msg.approved === false) {
      behavior = "deny";
      message = "Denied by user";
    }

    if (typeof msg.decision === "string") {
      if (msg.decision === "deny" || msg.decision === "reject") {
        behavior = "deny";
        message = message ?? "Denied by user";
      } else if (msg.decision === "allow") {
        behavior = "allow";
      }
    } else if (msg.decision && typeof msg.decision === "object") {
      if (msg.decision.behavior === "deny" || msg.decision.behavior === "allow") {
        behavior = msg.decision.behavior;
      }
      if (typeof msg.decision.message === "string") {
        message = msg.decision.message;
      } else if (behavior === "deny") {
        message = message ?? "Denied by user";
      }
      if (typeof msg.decision.newPermissionMode === "string") {
        newPermissionMode = msg.decision.newPermissionMode;
      }
      if (typeof msg.decision.newPermissionRule === "string") {
        newPermissionRule = msg.decision.newPermissionRule;
      }
    }

    try {
      await api.respondPermission(sid, msg.confirmationId, {
        behavior,
        message,
        newPermissionMode,
        newPermissionRule,
      });
      clearPendingPermission(sid);
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleDesktopReady(): Promise<void> {
    emitWorkdirState();
    try {
      const grouped = await refreshTree();
      if (
        !toastedInterrupted &&
        [...grouped.pinned, ...grouped.recent].some((s) => s.interrupted)
      ) {
        toastedInterrupted = true;
        showServerToast("上次对话被中断");
      }
      const activeId = grouped.activeSessionId;
      const listed = activeId
        ? [...grouped.pinned, ...grouped.recent].some((s) => s.id === activeId)
        : false;
      if (activeId && listed) {
        await activateSession(activeId);
      } else {
        // No started session to restore — show empty composer without a list row.
        pendingNewSession = true;
        suppressWorkdirPush = true;
        sessionId = null;
        draftModel = undefined;
        postToWebview({ command: "updateMessages", messages: [] });
        emitWorkdirState({ clearWorkdir: true });
        emitDraftSession();
      }
    } catch {
      // Keep workdir bootstrap even if session APIs fail.
    }
    try {
      await ensureWs();
    } catch {
      // Tree already loaded over HTTP; WS reconnect will resync later.
    }
  }

  const bridge: VsCodeApi = {
    postMessage(raw: unknown) {
      const msg = raw as { command?: string; [k: string]: unknown };
      const command = msg?.command;
      if (!command) {
        opts.outer?.postMessage(raw);
        return;
      }

      switch (command) {
        case "desktopReady":
          void handleDesktopReady();
          opts.outer?.postMessage(raw);
          return;
        case "newSession": {
          const workdir =
            typeof msg.workdir === "string" && msg.workdir
              ? msg.workdir
              : undefined;
          void handleNewSession(workdir);
          return;
        }
        case "desktopSelectSession": {
          const id =
            typeof msg.sessionId === "string" ? msg.sessionId : undefined;
          if (id) void activateSession(id);
          return;
        }
        case "desktopDeleteSession": {
          const id =
            typeof msg.sessionId === "string" ? msg.sessionId : undefined;
          if (id) void handleDeleteSession(id);
          return;
        }
        case "desktopTogglePinSession": {
          const id =
            typeof msg.sessionId === "string" ? msg.sessionId : undefined;
          if (id && typeof msg.pinned === "boolean") {
            void handleTogglePin(id, msg.pinned);
          }
          return;
        }
        case "desktopRenameSession": {
          const id =
            typeof msg.sessionId === "string" ? msg.sessionId : undefined;
          const title = typeof msg.title === "string" ? msg.title : undefined;
          if (id && title) void handleRenameSession(id, title);
          return;
        }
        case "setSessionModel": {
          const model = typeof msg.model === "string" ? msg.model : undefined;
          if (model) void handleSetSessionModel(model);
          return;
        }
        case "desktopSelectWorkdir":
          suppressWorkdirPush = false;
          opts.outer?.postMessage(raw);
          return;
        case "desktopSelectRecentWorkdir": {
          const path = typeof msg.path === "string" ? msg.path : undefined;
          if (path) {
            suppressWorkdirPush = false;
            const nextRecent = [
              path,
              ...recentWorkdirs.filter((p) => p !== path),
            ].slice(0, 10);
            emitWorkdirState({
              workdir: path,
              recentWorkdirs: nextRecent,
              clearSession: true,
            });
          }
          opts.outer?.postMessage(raw);
          return;
        }
        case "login":
          void handleLogin();
          return;
        case "logout":
          void handleLogout();
          return;
        case "sendMessage":
          void handleSendMessage(msg as { text?: string });
          return;
        case "abortMessage":
          void handleAbortMessage();
          return;
        case "requestSlashCommands":
          void handleRequestSlashCommands();
          return;
        case "clearChat":
          void handleClearChat();
          return;
        case "compactChat":
          void handleCompactChat();
          return;
        case "listRewindCheckpoints":
          void handleListRewindCheckpoints();
          return;
        case "rewindToMessage":
          void handleRewindToMessage(msg as { messageId?: string });
          return;
        case "setPermissionMode":
          void handleSetPermissionMode(msg as { mode?: string });
          return;
        case "getMcpServers":
          void handleGetMcpServers();
          return;
        case "connectMcpServer":
          void handleConnectMcpServer(msg as { serverName?: string });
          return;
        case "disconnectMcpServer":
          void handleDisconnectMcpServer(msg as { serverName?: string });
          return;
        case "getStatus":
          void handleGetStatus();
          return;
        case "getBackgroundTaskOutput":
          void handleGetBackgroundTaskOutput(msg as { taskId?: string });
          return;
        case "getBackgroundTasks":
          void handleGetBackgroundTasks();
          return;
        case "stopBackgroundTask":
          void handleStopBackgroundTask(msg as { taskId?: string });
          return;
        case "getWorkflowRuns":
          void handleGetWorkflowRuns();
          return;
        case "stopWorkflowRun":
          void handleStopWorkflowRun(msg as { runId?: string });
          return;
        case "desktopCreateWorktree": {
          void handleDesktopCreateWorktree(
            msg as {
              workdir?: string;
              baseBranch?: string;
              name?: string;
              text?: string;
              images?: unknown;
            },
          );
          return;
        }
        case "confirmationResponse":
          void handleConfirmationResponse(
            msg as {
              confirmationId?: string;
              approved?: boolean;
              decision?:
                | string
                | {
                    behavior?: "allow" | "deny";
                    message?: string;
                    newPermissionMode?: string;
                    newPermissionRule?: string;
                  };
            },
          );
          return;
        case "webviewReady":
        case "getAuthStatus":
          void refreshAuth();
          return;
        case "openExternal":
          if (typeof msg.url === "string") openExternal(msg.url);
          return;
        default:
          // desktopSelectWorkdir / folder pick → Electron main via outer IPC.
          opts.outer?.postMessage(raw);
      }
    },
    getState() {
      return state ?? opts.outer?.getState() ?? null;
    },
    setState(next: unknown) {
      state = next;
      opts.outer?.setState(next);
    },
  };

  // Bootstrap auth once the bridge is created (ChatApp also requests via webviewReady).
  if (!bootstrapped) {
    bootstrapped = true;
    queueMicrotask(() => {
      void refreshAuth();
    });
  }

  return bridge;
}

export function resolveMuseServerUrl(): string {
  const w = window as Window & {
    __MUSE_SERVER_URL__?: string;
    museServerUrl?: string;
    museServerBaseUrl?: string;
  };
  return (
    w.museServerBaseUrl ||
    w.__MUSE_SERVER_URL__ ||
    w.museServerUrl ||
    "http://127.0.0.1:8787"
  );
}
