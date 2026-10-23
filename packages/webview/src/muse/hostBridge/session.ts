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
import {
  pendingIssueWorktreeRemovals,
  worktreeRemovalForSession,
} from "../worktreeCleanup.js";

const DRAFT_SESSION_ID = "__draft__";

export interface SessionModule {
  activateSession: (id: string) => Promise<MuseSession>;
  handleNewSession: (workdir?: string) => Promise<void>;
  handleDeleteSession: (id: string) => Promise<void>;
  handleTogglePin: (id: string, pinnedNext: boolean) => Promise<void>;
  handleRenameSession: (id: string, title: string) => Promise<void>;
  handleSetSessionModel: (model: string) => Promise<void>;
  handleDesktopReady: () => Promise<void>;
  handleRefreshSessionTree: () => Promise<void>;
  refreshTree: () => Promise<MuseSessionsGrouped>;
  loadMessages: (id: string) => Promise<void>;
  loadOlderMessages: (before: string) => Promise<void>;
  applyGrouped: (grouped: MuseSessionsGrouped) => void;
  patchTreeSession: (id: string, patch: Partial<TreeSession>) => void;
  clearUnreadSessions: (ids: readonly string[]) => void;
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
      issueGroups: ctx.issueGroups.map((g) => ({
        issueId: g.issueId,
        title: g.title,
        description: g.description,
        priority: g.priority,
        ...(g.type ? { type: g.type } : {}),
        status: g.status,
        items: g.items,
        planningSessionId: g.planningSessionId,
        executionSessionId: g.executionSessionId,
        ...(g.agentMode ? { agentMode: g.agentMode } : {}),
        ...(g.closeNote ? { closeNote: g.closeNote } : {}),
        ...(g.workdir ? { workdir: g.workdir } : {}),
        ...(g.baseBranch ? { baseBranch: g.baseBranch } : {}),
        sessions: (g.sessions ?? []).map(toEntry),
      })),
      closedIssueGroups: ctx.closedIssueGroups.map((g) => ({
        issueId: g.issueId,
        title: g.title,
        description: g.description,
        priority: g.priority,
        ...(g.type ? { type: g.type } : {}),
        status: g.status,
        items: g.items,
        planningSessionId: g.planningSessionId,
        executionSessionId: g.executionSessionId,
        ...(g.agentMode ? { agentMode: g.agentMode } : {}),
        ...(g.closeNote ? { closeNote: g.closeNote } : {}),
        ...(g.workdir ? { workdir: g.workdir } : {}),
        ...(g.baseBranch ? { baseBranch: g.baseBranch } : {}),
        sessions: (g.sessions ?? []).map(toEntry),
      })),
    });
    ctx.publishAgentBusy();
  };

  const applyGrouped = (grouped: MuseSessionsGrouped) => {
    const prev = ctx.treeById();
    ctx.pinned = mergeRuntimeFields(grouped.pinned, prev);
    ctx.recent = mergeRuntimeFields(grouped.recent, prev);
    ctx.issueGroups = (grouped.issueGroups ?? []).map((g) => ({
      ...g,
      sessions: mergeRuntimeFields(g.sessions ?? [], prev),
    }));
    ctx.closedIssueGroups = (grouped.closedIssueGroups ?? []).map((g) => ({
      ...g,
      sessions: mergeRuntimeFields(g.sessions ?? [], prev),
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
    ctx.issueGroups = ctx.issueGroups.map((g) => ({
      ...g,
      sessions: apply(g.sessions),
    }));
    ctx.closedIssueGroups = ctx.closedIssueGroups.map((g) => ({
      ...g,
      sessions: apply(g.sessions),
    }));
    emitSessionTree();
  };

  const clearUnread = (id: string) => {
    patchTreeSession(id, { unreadDone: false });
  };

  const clearUnreadSessions = (ids: readonly string[]): void => {
    const drop = new Set(ids.filter((id) => id.length > 0));
    if (drop.size === 0) return;
    const apply = (list: TreeSession[]) =>
      list.map((session) =>
        drop.has(session.id) ? { ...session, unreadDone: false } : session,
      );
    ctx.pinned = apply(ctx.pinned);
    ctx.recent = apply(ctx.recent);
    ctx.issueGroups = ctx.issueGroups.map((group) => ({
      ...group,
      sessions: apply(group.sessions),
    }));
    ctx.closedIssueGroups = ctx.closedIssueGroups.map((group) => ({
      ...group,
      sessions: apply(group.sessions),
    }));
    emitSessionTree();
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

  const handleRefreshSessionTree = async (): Promise<void> => {
    const pending = pendingIssueWorktreeRemovals(ctx.issueGroups);
    await refreshTree();
    if (pending.length === 0) return;
    const closedIds = new Set(ctx.closedIssueGroups.map((g) => g.issueId));
    const posted = new Set<string>();
    for (const removal of pending) {
      if (!closedIds.has(removal.issueId)) continue;
      const key = `${removal.path}\0${removal.branch}\0${removal.repoRoot}`;
      if (posted.has(key)) continue;
      posted.add(key);
      ctx.outer?.postMessage({
        command: "desktopRemoveWorktree",
        path: removal.path,
        branch: removal.branch,
        repoRoot: removal.repoRoot,
      });
    }
  };

  let loadingOlder = false;

  const loadMessages = async (id: string): Promise<void> => {
    const page = await ctx.api.getMessages(id);
    if (ctx.sessionId !== id) return;
    postToWebview({
      command: "updateMessages",
      messages: page.messages,
      ...(typeof page.hasMore === "boolean" ? { hasMore: page.hasMore } : {}),
    });
  };

  const loadOlderMessages = async (before: string): Promise<void> => {
    const id = ctx.sessionId;
    if (!id || !before || loadingOlder) return;
    loadingOlder = true;
    try {
      const page = await ctx.api.getMessages(id, { before, limit: 40 });
      if (ctx.sessionId !== id) return;
      postToWebview({
        command: "prependMessages",
        messages: page.messages,
        hasMore: page.hasMore,
      });
    } finally {
      loadingOlder = false;
    }
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
      await ctx.refreshAuth();
    } catch {
      // Welcome login CTA can stay stale until the next webviewReady.
    }
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
    const existing = ctx.treeById().get(id);
    // Terminal PTY is workdir-scoped — deleting a chat must not kill the shell.
    const removal = existing ? worktreeRemovalForSession(existing) : null;
    if (removal) {
      ctx.outer?.postMessage({
        command: "desktopRemoveWorktree",
        ...removal,
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

  const handleDesktopReady = async (): Promise<void> => {
    ctx.emitWorkdirState();
    try {
      const grouped = await refreshTree();
      const issueSessions = [
        ...(grouped.issueGroups ?? []).flatMap((g) => g.sessions),
        ...(grouped.closedIssueGroups ?? []).flatMap((g) => g.sessions),
      ];
      if (
        !ctx.toastedInterrupted &&
        [...grouped.pinned, ...grouped.recent, ...issueSessions].some(
          (s) => s.interrupted,
        )
      ) {
        ctx.toastedInterrupted = true;
        showServerToast("上次对话被中断");
      }
      const activeId = grouped.activeSessionId;
      const listed = activeId
        ? [...grouped.pinned, ...grouped.recent, ...issueSessions].some(
            (s) => s.id === activeId,
          )
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
      await ctx.refreshAuth();
    } catch {
      // Draft page can still render; next webviewReady retries auth.
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
    handleDesktopReady,
    handleRefreshSessionTree,
    refreshTree,
    loadMessages,
    loadOlderMessages,
    applyGrouped,
    patchTreeSession,
    clearUnreadSessions,
    emitCurrentSession,
  };
}
