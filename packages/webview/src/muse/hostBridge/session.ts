import type { MuseSession, MuseSessionsGrouped } from "../apiClient.js";
import {
  DEFAULT_SESSION_MODEL_ID,
  DEFAULT_TITLE,
  buildSidebarModel,
  emitCompacting,
  emitPermissionMode,
  mergeRuntimeFields,
  postToWebview,
  showServerToast,
  toEntry,
} from "./utils.js";
import type { TreeSession } from "./utils.js";
import type { BridgeCtx } from "./ctx.js";

const DRAFT_SESSION_ID = "__draft__";

export interface SessionModule {
  activateSession: (id: string) => Promise<MuseSession>;
  handleNewSession: (workdir?: string) => Promise<void>;
  handleDeleteSession: (id: string) => Promise<void>;
  handleTogglePin: (id: string, pinnedNext: boolean) => Promise<void>;
  handleRenameSession: (id: string, title: string) => Promise<void>;
  handleSetSessionModel: (model: string) => Promise<void>;
  handleSetSessionAgent: (agent: string) => Promise<void>;
  handleDesktopReady: () => Promise<void>;
  refreshTree: () => Promise<MuseSessionsGrouped>;
  loadMessages: (id: string) => Promise<void>;
  applyGrouped: (grouped: MuseSessionsGrouped) => void;
  patchTreeSession: (id: string, patch: Partial<TreeSession>) => void;
  emitCurrentSession: (session: MuseSession) => void;
}

export function createSessionModule(ctx: BridgeCtx): SessionModule {
  const emitDraftSession = () => {
    postToWebview({
      command: "updateCurrentSession",
      session: {
        id: DRAFT_SESSION_ID,
        title: DEFAULT_TITLE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        model: ctx.draftModel ?? DEFAULT_SESSION_MODEL_ID,
      },
    });
    emitPermissionMode(ctx.draftPermissionMode);
  };

  const emitSessionTree = () => {
    postToWebview({
      command: "desktopSessionTree",
      groups: buildSidebarModel({ pinned: ctx.pinned, recent: ctx.recent }),
      todoGroups: ctx.todoGroups.map((g) => ({
        todoId: g.todoId,
        todoTitle: g.todoTitle,
        priority: g.priority,
        sessions: g.sessions.map(toEntry),
      })),
    });
    ctx.publishAgentBusy();
  };

  const applyGrouped = (grouped: MuseSessionsGrouped) => {
    const prev = ctx.treeById();
    ctx.pinned = mergeRuntimeFields(grouped.pinned, prev);
    ctx.recent = mergeRuntimeFields(grouped.recent, prev);
    ctx.todoGroups = (grouped.todoGroups ?? []).map((g) => ({
      ...g,
      sessions: mergeRuntimeFields(g.sessions, prev),
    }));
    emitSessionTree();
  };

  const patchTreeSession = (
    id: string,
    patch: Partial<TreeSession>,
  ): void => {
    const apply = (list: TreeSession[]) =>
      list.map((s) => (s.id === id ? { ...s, ...patch } : s));
    ctx.pinned = apply(ctx.pinned);
    ctx.recent = apply(ctx.recent);
    ctx.todoGroups = ctx.todoGroups.map((g) => ({
      ...g,
      sessions: apply(g.sessions),
    }));
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
        model: session.model,
        workdir: session.workdir,
        worktreeName: session.worktreeName,
        worktreeBranch: session.worktreeBranch,
        baseBranch: session.baseBranch,
        agentName: session.agentName,
      },
    });
  };

  const refreshTree = async (): Promise<MuseSessionsGrouped> => {
    const grouped = await ctx.api.listSessionsGrouped();
    applyGrouped(grouped);
    return grouped;
  };

  const loadMessages = async (id: string): Promise<void> => {
    const { messages } = await ctx.api.getMessages(id);
    postToWebview({ command: "updateMessages", messages });
  };

  const restoreRuntimeState = async (id: string): Promise<void> => {
    try {
      const { loading: runtimeLoading, queuedMessages } =
        await ctx.api.getRuntimeState(id);
      // A newer activation may have superseded this one.
      if (ctx.sessionId !== id || ctx.pendingNewSession) return;
      // Restore the sidebar spinner from the authoritative SDK snapshot. The
      // tree refresh uses API status, which can lag a moment between SDK
      // loading rounds and would otherwise clear the spinner.
      patchTreeSession(id, { running: runtimeLoading });
      if (runtimeLoading) {
        ctx.setLoading(true);
        postToWebview({ command: "startStreaming" });
      } else {
        ctx.resetChatStreaming();
      }
      // Always push (including empty) so the queue list reflects this session.
      postToWebview({ command: "updateQueue", messages: queuedMessages });
    } catch {
      if (ctx.sessionId === id && !ctx.pendingNewSession) {
        ctx.resetChatStreaming();
      }
    }
  };

  const activateSession = async (id: string): Promise<MuseSession> => {
    ctx.pendingNewSession = false;
    ctx.suppressWorkdirPush = false;
    const { session } = await ctx.api.selectSession(id);
    ctx.sessionId = session.id;
    clearUnread(session.id);
    if (session.workdir) {
      ctx.emitWorkdirState({ workdir: session.workdir });
    }
    ctx.resetChatStreaming();
    emitCurrentSession(session);
    emitPermissionMode(session.permissionMode);
    emitCompacting(ctx.compactingSessions.has(session.id));
    await loadMessages(session.id);
    await ctx.pushSessionControlState(session.id);
    await refreshTree();
    // Restore runtime state last so it wins over the tree refresh's API status.
    await restoreRuntimeState(session.id);
    const pending = ctx.pendingPermissions.get(session.id);
    if (pending) {
      ctx.showPermissionConfirmation(pending);
    }
    return session;
  };

  const handleNewSession = async (workdir?: string): Promise<void> => {
    // Lazy create: do not POST /sessions until the first user message.
    ctx.pendingNewSession = true;
    ctx.sessionId = null;
    ctx.draftModel = undefined;
    ctx.draftPermissionMode = "acceptEdits";
    ctx.resetChatStreaming();
    postToWebview({ command: "updateMessages", messages: [] });
    postToWebview({ command: "updateBackgroundTasks", tasks: [] });
    postToWebview({ command: "updateWorkflowRuns", runs: [] });
    postToWebview({ command: "updateTasks", tasks: [] });
    emitCompacting(false);
    if (workdir) {
      // Workdir-group "+": draft session with that directory pre-selected.
      ctx.suppressWorkdirPush = false;
      ctx.rememberRecentWorkdir(workdir);
      ctx.emitWorkdirState({ workdir, recentWorkdirs: ctx.recentWorkdirs });
      ctx.outer?.postMessage({
        command: "desktopSelectRecentWorkdir",
        path: workdir,
      });
    } else {
      ctx.suppressWorkdirPush = true;
      // New session starts with no workdir; first send auto-creates one.
      ctx.emitWorkdirState({ clearWorkdir: true });
    }
    emitDraftSession();
    try {
      await refreshTree();
    } catch {
      // Sidebar can stay stale; retry on the next successful WS open.
    }
    try {
      await ctx.ensureWs();
    } catch {
      // Draft composer is already up; reconnect will resync.
    }
  };

  const handleDeleteSession = async (id: string): Promise<void> => {
    const wasActive = ctx.sessionId === id;
    ctx.clearPendingPermission(id);
    const existing =
      ctx.pinned.find((s) => s.id === id) ?? ctx.recent.find((s) => s.id === id);
    // Terminal PTY is workdir-scoped — deleting a chat must not kill the shell.
    if (
      existing?.worktreeName &&
      existing.worktreeBranch &&
      existing.worktreeRepoRoot &&
      existing.workdir
    ) {
      ctx.outer?.postMessage({
        command: "desktopRemoveWorktree",
        path: existing.workdir,
        branch: existing.worktreeBranch,
        repoRoot: existing.worktreeRepoRoot,
      });
    }
    await ctx.api.deleteSession(id);
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
    await ctx.api.patchSession(id, { pinned: pinnedNext });
    await refreshTree();
  };

  const handleRenameSession = async (
    id: string,
    title: string,
  ): Promise<void> => {
    const next = title.trim();
    if (!next) return;
    const session = await ctx.api.patchSession(id, { title: next });
    ctx.titledSessions.add(id);
    patchTreeSession(id, { title: session.title || next });
    if (ctx.sessionId === id) {
      emitCurrentSession(session);
    }
  };

  const handleSetSessionModel = async (model: string): Promise<void> => {
    if (!model) return;
    if (!ctx.sessionId || ctx.pendingNewSession) {
      ctx.draftModel = model;
      emitDraftSession();
      return;
    }
    const session = await ctx.api.patchSession(ctx.sessionId, { model });
    patchTreeSession(ctx.sessionId, { model: session.model });
    emitCurrentSession(session);
  };

  // 输入框 agent 选择器 → PATCH /sessions/:id { agent }（仅已建会话；草稿会话由创建时带 agent）。
  const handleSetSessionAgent = async (agent: string): Promise<void> => {
    if (!agent) return;
    if (!ctx.sessionId || ctx.pendingNewSession) return;
    const session = await ctx.api.patchSession(ctx.sessionId, { agent });
    patchTreeSession(ctx.sessionId, { agentName: session.agentName });
    emitCurrentSession(session);
  };

  const handleDesktopReady = async (): Promise<void> => {
    ctx.emitWorkdirState();
    try {
      const grouped = await refreshTree();
      if (
        !ctx.toastedInterrupted &&
        [...grouped.pinned, ...grouped.recent].some((s) => s.interrupted)
      ) {
        ctx.toastedInterrupted = true;
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
        ctx.pendingNewSession = true;
        ctx.suppressWorkdirPush = true;
        ctx.sessionId = null;
        ctx.draftModel = undefined;
        ctx.draftPermissionMode = "acceptEdits";
        postToWebview({ command: "updateMessages", messages: [] });
        ctx.emitWorkdirState({ clearWorkdir: true });
        emitDraftSession();
      }
    } catch {
      // Keep workdir bootstrap even if session APIs fail.
    }
    try {
      await ctx.ensureWs();
    } catch {
      // Tree already loaded over HTTP; WS reconnect will resync later.
    }
  };

  return {
    activateSession,
    handleNewSession,
    handleDeleteSession,
    handleTogglePin,
    handleRenameSession,
    handleSetSessionModel,
    handleSetSessionAgent,
    handleDesktopReady,
    refreshTree,
    loadMessages,
    applyGrouped,
    patchTreeSession,
    emitCurrentSession,
  };
}
