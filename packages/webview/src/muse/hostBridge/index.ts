import type { VsCodeApi } from "../../types";
import type { MuseWsEvent, MuseWsStatus } from "../wsClient.js";
import { createAuthModule } from "./auth.js";
import { createChatModule } from "./chat.js";
import { createConfirmModule, type ConfirmationResponseMsg } from "./confirm.js";
import { createBridgeCtx, type HostBridgeOptions } from "./ctx.js";
import { createDesktopModule, type DesktopCreateWorktreeMsg } from "./desktop.js";
import { createSessionModule } from "./session.js";
import { createTasksModule } from "./tasks.js";
import { allTreeSessions, postToWebview, showServerToast } from "./utils.js";
import type { PendingPermission } from "./utils.js";

export { buildSidebarModel, isAuthError } from "./utils.js";
export type { HostBridgeOptions } from "./ctx.js";

type BridgeMsg = { command?: string; [k: string]: unknown };

/**
 * Minimal host bridge: maps legacy webview postMessage commands onto Muse HTTP/WS.
 * Compatible subset: login / logout / sendMessage / confirmationResponse (+ auth bootstrap).
 * Also bootstraps desktop workdir state so DesktopApp is not stuck on loading.
 */
export function createHostBridge(opts: HostBridgeOptions): VsCodeApi {
  // E2E harnesses set this so ChatApp talks to the mock outer host only —
  // no HTTP/WS, no overwriting injected desktopSessionTree / toasts.
  if (
    typeof window !== "undefined" &&
    (window as Window & { __MUSE_E2E_PASS_THROUGH__?: boolean })
      .__MUSE_E2E_PASS_THROUGH__
  ) {
    return (
      opts.outer ?? {
        postMessage: () => {},
        getState: () => null,
        setState: () => {},
      }
    );
  }

  const ctx = createBridgeCtx(opts);
  const session = createSessionModule(ctx);
  const desktop = createDesktopModule(ctx);
  const auth = createAuthModule(ctx);
  const chat = createChatModule(ctx);
  const tasks = createTasksModule(ctx);
  const confirm = createConfirmModule(ctx);

  // Wire cross-domain registration points after all modules are assembled.
  // Static imports between domain modules stay acyclic; everything crosses
  // through ctx at runtime.
  ctx.emitChatWs = chat.emitChatWs;
  ctx.activateSession = session.activateSession;
  ctx.handleSendMessage = chat.handleSendMessage;
  ctx.handleAbortMessage = chat.handleAbortMessage;
  ctx.resetChatStreaming = chat.resetChatStreaming;
  ctx.patchTreeSession = session.patchTreeSession;
  ctx.refreshTree = session.refreshTree;
  ctx.loadMessages = session.loadMessages;
  ctx.applyGrouped = session.applyGrouped;
  ctx.emitCurrentSession = session.emitCurrentSession;
  ctx.emitWorkdirState = desktop.emitWorkdirState;
  ctx.rememberRecentWorkdir = desktop.rememberRecentWorkdir;
  ctx.handleDesktopCreateWorktree = desktop.handleDesktopCreateWorktree;
  ctx.refreshAuth = auth.refreshAuth;
  ctx.maybePromptAuthDialog = auth.maybePromptAuthDialog;
  ctx.maybePatchTitle = auth.maybePatchTitle;
  ctx.normalizeOutboundImages = auth.normalizeOutboundImages;
  ctx.pushSessionControlState = tasks.pushSessionControlState;
  ctx.setRunningWork = tasks.setRunningWork;
  ctx.showPermissionConfirmation = confirm.showPermissionConfirmation;
  ctx.clearPendingPermission = confirm.clearPendingPermission;

  const resyncAfterReconnect = async (): Promise<void> => {
    try {
      const grouped = await ctx.refreshTree();
      const sessions = allTreeSessions(grouped);
      const runningIds = new Set(
        sessions.filter((s) => s.status === "running").map((s) => s.id),
      );
      for (const id of [...ctx.pendingPermissions.keys()]) {
        if (!runningIds.has(id)) ctx.pendingPermissions.delete(id);
      }
      for (const s of sessions) {
        if (!runningIds.has(s.id)) {
          ctx.patchTreeSession(s.id, { waitingConfirmation: false });
        }
      }
      if (!ctx.sessionId || ctx.pendingNewSession) return;
      await ctx.loadMessages(ctx.sessionId);
      if (!runningIds.has(ctx.sessionId)) {
        ctx.resetChatStreaming();
      }
    } catch {
      // Server may still be down; leave UI as-is until the next attempt.
    }
  };
  ctx.resyncAfterReconnect = resyncAfterReconnect;

  const emitWs = (event: MuseWsEvent) => {
    if (event.type === "auth:changed") {
      const status = event.status as
        | { state?: string; providerId?: string }
        | undefined;
      if (typeof status?.providerId === "string") {
        ctx.activeProviderId = status.providerId;
      }
      postToWebview({
        command: "authStatusResponse",
        isAuthenticated: status?.state === "authenticated",
      });
      // Mid-turn token expiry is WS `auth:changed`, not an HTTP send failure.
      // Welcome login CTA is gone once the conversation has messages, so the
      // re-login dialog has to open from this event.
      if (
        status?.state === "unauthenticated" ||
        status?.state === "expired"
      ) {
        auth.promptCodeMakerReauth();
      }
      return;
    }

    if (event.type === "session:unread") {
      ctx.patchTreeSession(event.sessionId, { unreadDone: event.unreadDone });
      return;
    }

    if (event.type === "session:titled") {
      ctx.patchTreeSession(event.sessionId, { title: event.title });
      if (event.sessionId === ctx.sessionId) {
        const cur = ctx.treeById().get(event.sessionId);
        if (cur) ctx.emitCurrentSession(cur);
      }
      return;
    }

    // Issue 任何变更（REST / 插件脚本）：broadcastAll 的 sessionId 恒为 "*"，
    // 不能走下方活跃会话过滤。所有 pane 都收，由 messageRouter 触发树刷新。
    if (event.type === "issue:changed") {
      postToWebview({ command: "issue:changed" });
      return;
    }

    if (event.type === "automation:changed") {
      postToWebview({ command: "automation:changed" });
      return;
    }

    if (event.type === "assistant:chat") {
      postToWebview({ command: "assistant:chat", line: event.line });
      return;
    }

    if (event.type === "assistant:status") {
      postToWebview({ command: "assistant:status", working: event.working });
      return;
    }

    if (event.type === "assistant:queue") {
      postToWebview({ command: "assistant:queue", items: event.items });
      return;
    }

    if (event.type === "permission:resolved") {
      const pending = ctx.pendingPermissions.get(event.sessionId);
      if (pending?.permissionId === event.permissionId) {
        ctx.clearPendingPermission(event.sessionId);
      }
      postToWebview({
        command: "hideConfirmation",
        confirmationId: event.permissionId,
      });
      return;
    }

    if (event.type === "permission:request") {
      const pending: PendingPermission = {
        permissionId: event.permissionId,
        toolName: event.toolName,
        description: event.description,
        toolInput: event.toolInput,
        suggestedPrefix: event.suggestedPrefix,
        hidePersistentOption: event.hidePersistentOption,
        permissionMode: event.permissionMode,
        toolCallId: event.toolCallId,
      };
      ctx.pendingPermissions.set(event.sessionId, pending);
      // Sidebar must show waiting even when this session is not focused.
      ctx.patchTreeSession(event.sessionId, {
        waitingConfirmation: true,
        running: true,
      });
      if (event.sessionId === ctx.sessionId) {
        ctx.showPermissionConfirmation(pending);
      }
      return;
    }

    if (event.type === "session:status") {
      const hasPending = ctx.pendingPermissions.has(event.sessionId);
      const running = event.status === "running" || hasPending;
      ctx.patchTreeSession(event.sessionId, {
        status: event.status,
        running,
        // Do not wipe waitingConfirmation while a permission is still pending.
        ...(hasPending ? {} : { waitingConfirmation: false }),
      });
      if (event.sessionId === ctx.sessionId && event.status === "error") {
        ctx.emitChatWs(event);
      }
      return;
    }

    if (event.type === "loading") {
      const hasPending = ctx.pendingPermissions.has(event.sessionId);
      // Keep sidebar spinner for background sessions; ChatApp only for focus.
      ctx.patchTreeSession(event.sessionId, {
        running: event.loading || hasPending,
      });
      if (event.sessionId === ctx.sessionId) {
        ctx.emitChatWs(event);
      }
      return;
    }

    if (event.type === "compaction:state") {
      if (event.isCompacting) ctx.compactingSessions.add(event.sessionId);
      else ctx.compactingSessions.delete(event.sessionId);
      if (event.sessionId === ctx.sessionId) {
        ctx.emitChatWs(event);
      }
      return;
    }

    if (event.type === "error:block") {
      ctx.compactingSessions.delete(event.sessionId);
      if (event.sessionId === ctx.sessionId) {
        ctx.emitChatWs(event);
      }
      return;
    }

    if (event.type === "background-tasks:update") {
      ctx.setRunningWork(event.sessionId, "tasks", event.tasks);
    }
    if (event.type === "workflow-runs:update") {
      ctx.setRunningWork(event.sessionId, "workflows", event.runs);
    }

    // Chat / streaming events only drive ChatApp for the active session.
    if (event.sessionId !== ctx.sessionId) return;
    ctx.emitChatWs(event);
  };

  ctx.ws.onEvent(emitWs);
  ctx.ws.onStatus?.((status: MuseWsStatus) => {
    if (status === "closed") {
      showServerToast("连接已断开，正在重连…");
      return;
    }
    if (status !== "open") return;
    if (!ctx.wsEverOpened) {
      ctx.wsEverOpened = true;
      return;
    }
    showServerToast("已重新连接");
    void resyncAfterReconnect();
  });

  const dispatch: Record<string, (msg: BridgeMsg) => void> = {
    desktopReady: () => void session.handleDesktopReady(),
    newSession: (msg) => {
      const workdir =
        typeof msg.workdir === "string" && msg.workdir
          ? msg.workdir
          : undefined;
      void session.handleNewSession(workdir);
    },
    desktopSelectSession: (msg) => {
      const id =
        typeof msg.sessionId === "string" ? msg.sessionId : undefined;
      if (id) void ctx.activateSession(id);
    },
    desktopDeleteSession: (msg) => {
      const id =
        typeof msg.sessionId === "string" ? msg.sessionId : undefined;
      if (id) void session.handleDeleteSession(id);
    },
    desktopTogglePinSession: (msg) => {
      const id =
        typeof msg.sessionId === "string" ? msg.sessionId : undefined;
      if (id && typeof msg.pinned === "boolean") {
        void session.handleTogglePin(id, msg.pinned);
      }
    },
    desktopRenameSession: (msg) => {
      const id =
        typeof msg.sessionId === "string" ? msg.sessionId : undefined;
      const title = typeof msg.title === "string" ? msg.title : undefined;
      if (id && title) void session.handleRenameSession(id, title);
    },
    setSessionModel: (msg) => {
      const model = typeof msg.model === "string" ? msg.model : undefined;
      if (model) void session.handleSetSessionModel(model);
    },
    desktopSelectWorkdir: () => {
      ctx.suppressWorkdirPush = false;
    },
    desktopSelectRecentWorkdir: (msg) => {
      const path = typeof msg.path === "string" ? msg.path : undefined;
      if (path) {
        ctx.suppressWorkdirPush = false;
        ctx.rememberRecentWorkdir(path);
        ctx.emitWorkdirState({
          workdir: path,
          recentWorkdirs: ctx.recentWorkdirs,
          clearSession: true,
        });
      }
    },
    login: () => void auth.handleLogin(),
    logout: () => void auth.handleLogout(),
    sendMessage: (msg) => void chat.handleSendMessage(msg as { text?: string }),
    abortMessage: () => void chat.handleAbortMessage(),
    deleteQueuedMessageById: (msg) =>
      void chat.handleDeleteQueuedMessageById(msg as { id?: string }),
    updateQueuedMessage: (msg) =>
      void chat.handleUpdateQueuedMessage(
        msg as { id?: string; text?: string; images?: unknown },
      ),
    requestSlashCommands: () => void chat.handleRequestSlashCommands(),
    clearChat: () => void chat.handleClearChat(),
    compactChat: () => void chat.handleCompactChat(),
    listRewindCheckpoints: () => void chat.handleListRewindCheckpoints(),
    loadOlderMessages: (msg) => {
      const before = typeof msg.before === "string" ? msg.before : "";
      if (before) void session.loadOlderMessages(before);
    },
    rewindToMessage: (msg) =>
      void chat.handleRewindToMessage(msg as { messageId?: string }),
    setPermissionMode: (msg) =>
      void chat.handleSetPermissionMode(msg as { mode?: string }),
    desktopRefreshSessionTree: () =>
      void session.handleRefreshSessionTree().catch(() => {
        // 侧栏保持旧数据，下次任意刷新兜底
      }),
    desktopClearUnread: (msg) => {
      const sessionIds = Array.isArray(msg.sessionIds)
        ? msg.sessionIds.filter((id): id is string => typeof id === "string")
        : [];
      session.clearUnreadSessions(sessionIds);
    },
    getMcpServers: () => void chat.handleGetMcpServers(),
    connectMcpServer: (msg) =>
      void chat.handleConnectMcpServer(msg as { serverName?: string }),
    disconnectMcpServer: (msg) =>
      void chat.handleDisconnectMcpServer(msg as { serverName?: string }),
    getStatus: () => void tasks.handleGetStatus(),
    getBackgroundTasks: () => void tasks.handleGetBackgroundTasks(),
    stopBackgroundTask: (msg) =>
      void tasks.handleStopBackgroundTask(msg as { taskId?: string }),
    getWorkflowRuns: () => void tasks.handleGetWorkflowRuns(),
    stopWorkflowRun: (msg) =>
      void tasks.handleStopWorkflowRun(msg as { runId?: string }),
    desktopCreateWorktree: (msg) => {
      // Open-planning (and any create-only caller) tags requestId and waits
      // for desktopWorktreeCreated. Forward to Electron; do not mint a session.
      if (typeof msg.requestId === "string" && msg.requestId) {
        opts.outer?.postMessage(msg);
        return;
      }
      void ctx.handleDesktopCreateWorktree(
        msg as DesktopCreateWorktreeMsg,
      );
    },
    confirmationResponse: (msg) =>
      void confirm.handleConfirmationResponse(msg as ConfirmationResponseMsg),
    webviewReady: () => void ctx.refreshAuth(),
    getAuthStatus: () => void ctx.refreshAuth(),
    openExternal: (msg) => {
      if (typeof msg.url === "string") ctx.openExternal(msg.url);
    },
  };

  const bridge: VsCodeApi = {
    postMessage(raw: unknown) {
      // Always mirror to the outer host (Electron IPC / e2e harness) so tests
      // can observe every command ChatApp posts, even when this bridge handles
      // the command locally via HTTP/WS.
      //
      // EXCEPT desktopCreateWorktree: the dispatch below hands it to
      // handleDesktopCreateWorktree, which itself forwards a requestId-tagged
      // message to the outer host. Mirroring the raw message here too would
      // make the main process run createWorktree TWICE per send (one from the
      // mirror, one from the tagged forward), producing a duplicate worktree.
      const msg = raw as BridgeMsg;
      const command = msg?.command;
      if (command !== "desktopCreateWorktree") {
        opts.outer?.postMessage(raw);
      }
      if (!command) {
        return;
      }
      dispatch[command]?.(msg);
    },
    getState() {
      return ctx.state ?? opts.outer?.getState() ?? null;
    },
    setState(next: unknown) {
      ctx.state = next;
      opts.outer?.setState(next);
    },
  };

  // Bootstrap auth once the bridge is created (ChatApp also requests via webviewReady).
  if (!ctx.bootstrapped) {
    ctx.bootstrapped = true;
    queueMicrotask(() => {
      void ctx.refreshAuth();
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
