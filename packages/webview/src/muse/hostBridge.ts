import type { DesktopSessionEntry, DesktopSessionGroup, VsCodeApi } from "../types";
import {
  MuseApiClient,
  type MuseSession,
  type MuseSessionsGrouped,
} from "./apiClient.js";
import { MuseWsClient, type MuseWsEvent } from "./wsClient.js";

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

function subagentMessageId(subagentId: string, messageId: string): string {
  return `sa_${subagentId}_${messageId}`;
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
    hasWorktree: false,
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
  let streamingMessageId: string | null = null;
  const knownAssistantIds = new Set<string>();
  let state: unknown = null;
  let bootstrapped = false;
  let loading = false;
  let wsConnected = false;
  let pinned: TreeSession[] = [];
  let recent: TreeSession[] = [];
  const titledSessions = new Set<string>();

  const treeById = (): Map<string, TreeSession> => {
    const map = new Map<string, TreeSession>();
    for (const s of pinned) map.set(s.id, s);
    for (const s of recent) map.set(s.id, s);
    return map;
  };

  const emitSessionTree = () => {
    postToWebview({
      command: "desktopSessionTree",
      groups: buildSidebarModel({ pinned, recent }),
    });
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

  const emitCurrentSession = (session: MuseSession) => {
    postToWebview({
      command: "updateCurrentSession",
      session: {
        id: session.id,
        title: session.title || DEFAULT_TITLE,
        createdAt: session.createdAt,
        updatedAt: session.lastActiveAt ?? session.createdAt,
      },
    });
  };

  const resetChatStreaming = () => {
    streamingMessageId = null;
    knownAssistantIds.clear();
    loading = false;
    postToWebview({ command: "endStreaming" });
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

  const emitWorkdirState = (patch?: {
    workdir?: string;
    recentWorkdirs?: string[];
    clearSession?: boolean;
  }) => {
    if (typeof patch?.workdir === "string" && patch.workdir) {
      currentWorkdir = patch.workdir;
      if (patch.clearSession) sessionId = null;
    }
    if (patch?.recentWorkdirs) {
      recentWorkdirs = patch.recentWorkdirs;
    }
    postToWebview({
      command: "desktopWorkdirState",
      workdir: currentWorkdir || undefined,
      recentWorkdirs,
      host: "local",
      hosts: [],
    });
  };

  // Keep createSession workdir in sync when Electron main (or tests) push state.
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as {
      command?: string;
      workdir?: string;
      recentWorkdirs?: string[];
    };
    if (message?.command !== "desktopWorkdirState") return;
    if (typeof message.workdir === "string" && message.workdir) {
      if (message.workdir !== currentWorkdir) {
        sessionId = null;
      }
      currentWorkdir = message.workdir;
    }
    if (Array.isArray(message.recentWorkdirs)) {
      recentWorkdirs = message.recentWorkdirs;
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

  const activateSession = async (id: string): Promise<MuseSession> => {
    const { session } = await api.selectSession(id);
    sessionId = session.id;
    clearUnread(session.id);
    if (session.workdir && session.workdir !== currentWorkdir) {
      emitWorkdirState({ workdir: session.workdir });
    } else if (session.workdir) {
      currentWorkdir = session.workdir;
    }
    resetChatStreaming();
    emitCurrentSession(session);
    await loadMessages(session.id);
    await refreshTree();
    return session;
  };

  const handleNewSession = async (): Promise<void> => {
    await ensureWs();
    const session = await api.createSession(currentWorkdir || "/");
    await api.selectSession(session.id);
    sessionId = session.id;
    resetChatStreaming();
    postToWebview({ command: "updateMessages", messages: [] });
    emitCurrentSession(session);
    await loadMessages(session.id);
    await refreshTree();
  };

  const handleDeleteSession = async (id: string): Promise<void> => {
    const wasActive = sessionId === id;
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

  const emitChatWs = (event: MuseWsEvent) => {
    if (event.type === "loading") {
      loading = event.loading;
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
        postToWebview({ command: "startStreaming" });
      }
      return;
    }

    if (event.type === "message:delta") {
      const messageId = event.messageId || streamingMessageId || newId("asst");
      ensureAssistantMessage(messageId);
      if (!loading) {
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

    if (event.type === "permission:request") {
      postToWebview({
        command: "showConfirmation",
        confirmationId: event.permissionId,
        toolName: event.toolName,
        confirmationType: "tool",
        toolInput: event.description,
      });
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
      loading = false;
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

    if (event.type === "subagent:assistant:message") {
      const messageId = subagentMessageId(event.subagentId, event.messageId);
      ensureAssistantMessage(messageId, { trackMain: false });
      if (!loading) {
        postToWebview({ command: "startStreaming" });
      }
      return;
    }

    if (event.type === "subagent:message:delta") {
      const messageId = subagentMessageId(event.subagentId, event.messageId);
      ensureAssistantMessage(messageId, { trackMain: false });
      if (!loading) {
        postToWebview({ command: "startStreaming" });
      }
      postToWebview({
        command: "updateStreamingContent",
        messageId,
        chunk: event.text,
        stage: event.stage,
      });
      return;
    }

    if (event.type === "subagent:reasoning:delta") {
      const messageId = subagentMessageId(event.subagentId, event.messageId);
      ensureAssistantMessage(messageId, { trackMain: false });
      if (!loading) {
        postToWebview({ command: "startStreaming" });
      }
      postToWebview({
        command: "updateStreamingReasoning",
        messageId,
        chunk: event.text,
        stage: event.stage,
      });
      return;
    }

    if (event.type === "subagent:tool:update") {
      const params = event.params;
      const rawMessageId =
        typeof params.messageId === "string" ? params.messageId : event.subagentId;
      const messageId = subagentMessageId(event.subagentId, rawMessageId);
      ensureAssistantMessage(messageId, { trackMain: false });
      if (!loading) {
        postToWebview({ command: "startStreaming" });
      }
      postToWebview({
        command: "updateToolBlock",
        params: { ...params, messageId },
      });
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

    if (event.type === "session:status") {
      const running = event.status === "running";
      patchTreeSession(event.sessionId, {
        status: event.status,
        running,
        waitingConfirmation: false,
      });
      if (event.sessionId === sessionId && event.status === "error") {
        emitChatWs(event);
      }
      return;
    }

    // Chat / streaming events only drive ChatApp for the active session.
    if (event.sessionId !== sessionId) return;
    emitChatWs(event);
  };

  ws.onEvent(emitWs);

  async function ensureSession(): Promise<string> {
    await ensureWs();
    if (sessionId) return sessionId;

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

    const session = await api.createSession(currentWorkdir || "/");
    await api.selectSession(session.id);
    sessionId = session.id;
    emitCurrentSession(session);
    await refreshTree();
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

  async function handleSendMessage(msg: {
    text?: string;
    images?: unknown;
  }): Promise<void> {
    const text = (msg.text ?? "").trim();
    if (!text) return;

    const userId = newId("user");
    postToWebview({
      command: "appendMessage",
      message: {
        id: userId,
        role: "user",
        timestamp: new Date().toISOString(),
        blocks: [{ type: "text", content: text }],
      },
    });

    try {
      const sid = await ensureSession();
      streamingMessageId = null;
      knownAssistantIds.clear();
      loading = false;
      postToWebview({ command: "startStreaming" });
      await api.sendMessage(sid, text);
      await maybePatchTitle(sid, text);
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
      postToWebview({ command: "endStreaming" });
      loading = false;
      streamingMessageId = null;
    }
  }

  async function handleConfirmationResponse(msg: {
    confirmationId?: string;
    decision?: string;
  }): Promise<void> {
    if (!sessionId || !msg.confirmationId) return;
    const decision =
      msg.decision === "deny" || msg.decision === "reject" ? "deny" : "allow";
    try {
      await api.respondPermission(sessionId, msg.confirmationId, decision);
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
      await ensureWs();
      const grouped = await refreshTree();
      if (grouped.activeSessionId) {
        await activateSession(grouped.activeSessionId);
      }
    } catch {
      // Keep workdir bootstrap even if session APIs fail.
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
        case "newSession":
          void handleNewSession();
          return;
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
        case "desktopSelectRecentWorkdir": {
          const path = typeof msg.path === "string" ? msg.path : undefined;
          if (path) {
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
        case "confirmationResponse":
          void handleConfirmationResponse(
            msg as { confirmationId?: string; decision?: string },
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
