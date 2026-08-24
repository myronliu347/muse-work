import React, {
  useEffect,
  useReducer,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MessageInputHandle } from "./chat/MessageInput";
import {
  DesktopSidebar,
  resolveSidebarSessions,
} from "./desktop/DesktopSidebar";
import { DesktopShell } from "./desktop/DesktopShell";
import { ChatContainer } from "./chat/ChatContainer";
import { ChatComposer } from "./chat/ChatComposer";
import { ChatDialogs, type ChatDialogsProps } from "./dialogs/ChatDialogs";
import type { DesktopPanelSlotsProps } from "./desktop/DesktopPanelSlots";
import { TodoNotifyStack } from "./todo/TodoNotifyStack";
import { useTodoBoardStore, type TodoNotification } from "../stores/todoBoardStore";
import { MuseApiClient } from "../muse/apiClient";
import { resolveMuseServerUrl } from "../muse/hostBridge";
import type { WorkspaceDiffFile } from "./panels/DiffPane";
import { prefetchTerminalLib } from "./panels/TerminalPane";
import type {
  ChatAppProps,
  DesktopPanelKind,
} from "../types";
import { chatReducer, initialState } from "../reducers/chatReducer";
import { usePanelGroup, usePaneUi } from "../stores";
import { dedupeSnapshotsByFile } from "../utils/fileHistorySnapshots";
import { createMessageHandler } from "../muse/messageRouter";
import { useChatAppCore } from "../hooks/useChatAppCore";
import { useChatSend } from "../hooks/useChatSend";
import { usePanels } from "../hooks/usePanels";
import { useFilePanel } from "../hooks/useFilePanel";
import { usePreview } from "../hooks/usePreview";
import { useRewind } from "../hooks/useRewind";
import { useDialogs } from "../hooks/useDialogs";
import "../styles/ChatApp.css";



export { prunePanelGroupCache } from "../stores";

/** The conversation (message) area never shrinks below this when opening/dragging panels. */
const CHAT_MAIN_MIN_WIDTH = 520;

/** 主内容区视图：chat 需要结合当前会话（state.currentSession）渲染。 */
export type MainView = "newChat" | "chat" | "popo-robot" | "todo-board";

export const ChatApp: React.FC<ChatAppProps> = ({ vscode, host, paneId }) => {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const paneUi = usePaneUi(paneId);
  const {
    queueEditWarning,
    toasts,
    pendingRewindId,
    rewindPopupOpen,
    rewindCheckpoints,
    rewindCheckpointsLoading,
    modelPopupOpen,
    configuredModels,
    currentModel,
    modelLoading,
    agentTranscript,
    worktreeBranch,
    worktreeChecked,
    paneGitBranches,
  } = paneUi;
  // Desktop new sessions start with workdir=null. Host bridge syncs
  // updateWorkdir on activate / folder pick / auto-create. Fall back to
  // host.workdir only for bound (non-draft) sessions when state has not
  // caught up yet.
  const isDraftSession =
    !state.currentSession?.id || state.currentSession.id === "__draft__";
  const effectiveWorkdir = isDraftSession
    ? state.workdir
    : (state.workdir ?? host?.workdir);
  // Local-only for now (remote hosts removed from the composer).
  const effectiveHost = "local";
  const gitBranches = paneGitBranches;
  const sessionGitMeta = state.currentSession as
    | { worktreeBranch?: string; worktreeName?: string }
    | undefined;
  const headerGitContext =
    !isDraftSession
      ? {
          branch:
            gitBranches?.current || sessionGitMeta?.worktreeBranch || undefined,
          worktreeName: sessionGitMeta?.worktreeName,
          workdir: effectiveWorkdir,
        }
      : undefined;
  // Desktop only: panel group is keyed by absolute workdir (not session).
  // Fall back to host.workdir so a draft with a selected folder still shares
  // the same dock as sessions in that directory.
  const panelWorkdir =
    effectiveWorkdir ?? host?.workdir ?? undefined;
  const groupKey =
    panelWorkdir ? panelWorkdir : undefined;
  const groupKeyRef = useRef(groupKey);
  groupKeyRef.current = groupKey;
  const {
    checked: checkedPanels,
    mounted: mountedPanels,
    active: activePanel,
    widths: panelWidths,
    dockFullscreen,
    previewUrl,
    fileView,
    diffView,
    fileTree,
    fileSidebarMode,
    contentSearch,
    forward: currentForward,
    forwardError: previewForwardError,
    previewEpoch,
  } = usePanelGroup(groupKey);
  const previewUrlRef = useRef(previewUrl);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [chatColumnWidth, setChatColumnWidth] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth : 1280),
  );
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  // 主内容区视图：聊天（展示 state.currentSession 对应会话）/ 新会话页 / POPO 机器人页。
  // 独立于 host 推送的会话状态，任何导航入口显式切换。
  const [view, setView] = useState<MainView>("chat");
  const popoApi = useMemo(
    () => new MuseApiClient({ baseUrl: resolveMuseServerUrl() }),
    [],
  );
  // 待审核 task 计数（侧栏 badge）+ 通知点击跳转
  const todoReviewCount = useTodoBoardStore((s) => s.reviewCount);
  const openTodoNotification = (n: TodoNotification) => {
    useTodoBoardStore.getState().selectTodo(n.todoId);
    useTodoBoardStore.getState().selectTask(n.taskId);
    setView("todo-board");
  };
  // 本地是否已配置 POPO（~/.popo-config.json）：未配置时隐藏侧栏入口、不渲染机器人页。
  const [popoEnabled, setPopoEnabled] = useState(false);
  useEffect(() => {
    popoApi
      .getPopoConfig()
      .then((cfg) => setPopoEnabled(cfg.configured))
      .catch(() => setPopoEnabled(false));
  }, [popoApi]);
  // 会话切换/新建（host 推送 currentSession 变化）时回到聊天视图，
  // 侧栏导航不应被机器人页等其它视图挡住。view === "chat" 时聊天区渲染
  // state.currentSession 对应的会话（sessionId 即 currentSession.id）。
  useEffect(() => {
    setView("chat");
  }, [state.currentSession?.id]);
  // Mirrors so the stable message listener can reach the panel toggle logic
  // (filled by usePanels) without re-subscribing.
  const togglePanelRef = useRef<(kind: DesktopPanelKind) => void>(() => {});
  const toggleFullscreenRef = useRef<() => void>(() => {});
  const messageInputRef = useRef<MessageInputHandle>(null);
  const messageListRef = useRef<{
    scrollToBottom: (behavior?: ScrollBehavior) => void;
  }>(null);
  const stateRef = useRef(state);
  // The pane this instance renders; undefined = single view (desktop
  // single-pane layout). Ref mirror for use inside stable callbacks.
  const paneIdRef = useRef<string | undefined>(paneId);

  // Keep stateRef in sync with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  // Track the chat column width so dock maxWidth stays correct across
  // window resizes and split-pane changes (ref reads alone do not re-render).
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      // clientWidth is the CSS-constrained layout width (requires min-width:0
      // on .chat-container). getBoundingClientRect can report an overflowed
      // content size and feed a too-large dockMaxWidth, worsening the spill.
      const width = el.clientWidth;
      if (width > 0) setChatColumnWidth(width);
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => ro.disconnect();
  }, [paneId, host?.panes?.length]);

  useEffect(() => {
    paneIdRef.current = paneId;
  }, [paneId]);

  // Host pushes (updateMessages, setInitialState, user:message, ...) arrive on
  // the window message channel. The 58-case router lives in muse/messageRouter
  // (extracted verbatim) — this component only registers it. `refs` objects are
  // stable across renders, so the handler is created once per mount.
  const handleMessage = useMemo(
    () =>
      createMessageHandler({
        dispatch,
        vscode,
        refs: {
          paneIdRef,
          stateRef,
          messageListRef,
          messageInputRef,
          chatContainerRef,
          togglePanelRef,
          previewUrlRef,
          groupKeyRef,
        },
      }),
    [dispatch, vscode],
  );
  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Domain hooks: core bridge first, then panels → preview → file panel
  // (tryOpenPanel/acquireForward/handleOpenPreview flow down), then the
  // rewind/dialog/send groups. Order is fixed — missing params are tsc errors.
  const core = useChatAppCore({
    paneId,
    vscode,
    effectiveWorkdir,
    groupKey,
    paneIdRef,
  });
  const { postToHost, patchPane, updatePanelGroup } = core;

  // Auto-dismiss the queue-edit warning banner
  useEffect(() => {
    if (!queueEditWarning) return;
    const timer = setTimeout(() => patchPane({ queueEditWarning: null }), 4000);
    return () => clearTimeout(timer);
  }, [queueEditWarning, patchPane]);

  // Desktop: reset worktree opt-in when the workdir changes. Do not depend on
  // `gitBranches` — silent poll / visibility refresh rewrite paneGitBranches
  // every ~3s and must not clear the user's checkbox or base-branch pick.
  useEffect(() => {
    patchPane({
      worktreeBranch: "",
      worktreeChecked: false,
    });
  }, [effectiveWorkdir, patchPane]);

  const send = useChatSend({
    postToHost,
    patchPane,
    dispatch,
    vscode,
    stateRef,
    messageInputRef,
    state,
    host,
    worktreeChecked,
    worktreeBranch,
    gitBranches,
    effectiveWorkdir,
  });
  const {
    handleSendMessage,
    handleAbortMessage,
    handleClearChat,
    handleDeleteQueuedMessage,
    handleEditQueuedMessage,
    handleSubmitQueuedEdit,
    handleCancelQueuedEdit,
    handleAddComment,
  } = send;

  const dockMaxWidth = chatColumnWidth - CHAT_MAIN_MIN_WIDTH;
  const panels = usePanels({
    postToHost,
    updatePanelGroup,
    groupKey,
    panelWorkdir,
    chatContainerRef,
    togglePanelRef,
    toggleFullscreenRef,
    isDraftSession,
    host,
    paneId,
    setView,
    setQuickOpenOpen,
    checkedPanels,
    mountedPanels,
    activePanel,
    panelWidths,
    dockMaxWidth,
  });
  const {
    tryOpenPanel,
    acquireForward,
    panelDisabled,
    handleTogglePanel,
    handleToggleDock,
    handleAddPanel,
    handleToggleFullscreen,
    handleSelectPanel,
    handleDockWidthChange,
  } = panels;

  const preview = usePreview({
    updatePanelGroup,
    tryOpenPanel,
    acquireForward,
    effectiveHost,
    currentForward,
    previewForwardError,
  });
  const {
    handleOpenPreview,
    handleRemotePreviewRetry,
    handlePreviewNavigate,
    openPreviewHandler,
  } = preview;

  const filePanel = useFilePanel({
    postToHost,
    updatePanelGroup,
    tryOpenPanel,
    handleOpenPreview,
    popoApi,
    currentSession: state.currentSession,
    effectiveHost,
    effectiveWorkdir,
    groupKey,
    contentSearch,
  });
  const {
    handleOpenFile,
    handleRevealInFinder,
    handleOpenFileHistoryDiff,
    handleRevertFileHistory,
    revertingFileHistory,
    handleFileTreeChange,
    handleOpenLocalFilePreview,
    handleFileSidebarModeChange,
    handleContentSearchChange,
  } = filePanel;

  const rewind = useRewind({
    postToHost,
    patchPane,
    dispatch,
    isStreaming: state.isStreaming,
    pendingRewindId,
    messageInputRef,
  });
  const {
    handleConfirmation,
    handleRejection,
    handleRewindToMessage,
    handleOpenAgentTranscript,
    handleCloseAgentTranscript,
    handleRewindCheckpointSelect,
    handleRewindPopupClose,
    handleRewindConfirm,
  } = rewind;

  const dialogActions = useDialogs({
    postToHost,
    patchPane,
    dispatch,
    vscode,
    stateRef,
    messageInputRef,
    setView,
  });
  const {
    handleConfigurationSave,
    handleDialogClose,
    handleLogin,
    handleLogout,
    handleOpenSettings,
    handleToastDismiss,
    handleToastAction,
    handleModelSelect,
    handleSessionModelChange,
    handleModelPopupClose,
    handleDesktopNewSession,
    handleDesktopNewSessionInWorkdir,
    handleInputCleared,
  } = dialogActions;

  // Initialize webview and load sessions on component mount
  useEffect(() => {
    dispatch({ type: "SET_SESSIONS_LOADING", payload: true });
    vscode.postMessage({
      command: "webviewReady",
    });
  }, [vscode]);

  // Re-focus input when command finishes running (e.g., after bang execution)
  useEffect(() => {
    if (!state.isCommandRunning && messageInputRef.current) {
      messageInputRef.current.focus();
    }
  }, [state.isCommandRunning]);

  useEffect(() => {
    patchPane({ agentTranscript: null });
  }, [state.currentSession?.id, patchPane]);

  // Desktop: idle-preload the lazily injected xterm chunk so the first
  // terminal open doesn't pay the fetch+parse cost.
  useEffect(() => {
    const id = window.requestIdleCallback?.(() => prefetchTerminalLib());
    return () => {
      if (id !== undefined) window.cancelIdleCallback?.(id);
    };
  }, []);

  // A message counts as chat content only when the UI renders it — hidden meta
  // user messages (e.g. SessionStart hook additionalContext, isMeta: true) do
  // not, so they must not suppress the welcome page.
  const hasVisibleMessages = state.messages.some(
    (m) => !(m.role === "user" && m.isMeta),
  );

  // Welcome page shows only when there are no visible messages yet. Login is optional:
  // a direct-connect config (baseURL/apiKey) works without authentication, so an
  // unauthenticated user who sends a message must still see the chat, not the welcome page.
  const showWelcome = !hasVisibleMessages;
  // Withhold the welcome page until the initial state (incl. auth status) has
  // arrived, otherwise logged-in users see the login CTA flash before
  // setInitialState updates isAuthenticated to true.
  const showWelcomeReady = showWelcome && state.initialized;

  // "最近一次修改" diff source: every assistant message of the NEWEST turn
  // that carries an enriched file_history block (server adds +N/−M + hunks in
  // getMessages). A turn starts at a real user message (role=user, not isMeta)
  // and runs to the next one. Only the newest turn is considered — a plain
  // question with no file changes shows nothing (no fallback to earlier
  // turns). Derived from the live message list so it survives session
  // switches — the reloaded transcript carries the same file_history blocks.
  const recentDiffFiles = useMemo<WorkspaceDiffFile[]>(() => {
    const msgs = state.messages;
    // Walk from the tail and collect every assistant message of the newest
    // turn; meta-injected user messages do not break the turn. We stop at the
    // first real user message — earlier turns are ignored even when the newest
    // turn has no file_history.
    const snapshots: Array<{
      filePath: string;
      additions?: number;
      deletions?: number;
      hunks?: string;
    }> = [];
    let inTurn = false;
    let foundFh = false;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "user" && !m.isMeta) {
        // The newest turn ends here; do not look further back.
        break;
      }
      if (m.role !== "assistant") continue;
      inTurn = true;
      const block = (m.blocks ?? []).find(
        (b) => b.type === "file_history",
      ) as
        | {
            type: "file_history";
            snapshots: Array<{
              filePath: string;
              additions?: number;
              deletions?: number;
              hunks?: string;
            }>;
          }
        | undefined;
      if (block && Array.isArray(block.snapshots)) {
        snapshots.push(...block.snapshots);
        foundFh = true;
      }
    }
    if (!inTurn || !foundFh) return [];
    const wd = effectiveWorkdir;
    // A turn often edits the same file repeatedly; keep the OLDEST snapshot per
    // file so the diff covers the whole turn (enrich diffs against current disk
    // content — newer snapshots would only show the delta since that edit).
    const deduped = dedupeSnapshotsByFile(snapshots);
    return deduped
      .filter(
        (s) =>
          s.filePath &&
          // Internal bookkeeping files (task state, etc.) outside the workdir
          // are not user-facing changes.
          (!wd || s.filePath.startsWith(wd)) &&
          ((s.additions ?? 0) > 0 || (s.deletions ?? 0) > 0),
      )
      .map((s) => ({
        path: s.filePath,
        status: "modified" as const,
        additions: s.additions ?? 0,
        deletions: s.deletions ?? 0,
        hunks: s.hunks ?? "",
        truncated: false,
        binary: false,
      }));
  }, [state.messages, effectiveWorkdir]);


  const showNewSessionPage = isDraftSession && state.initialized;

  const composer = (
    <ChatComposer
      ref={messageInputRef}
      onSendMessage={handleSendMessage}
      isStreaming={state.isStreaming}
      onAbortMessage={handleAbortMessage}
      onSubmitQueuedEdit={handleSubmitQueuedEdit}
      editingQueuedId={state.editingQueuedId}
      onCancelQueuedEdit={handleCancelQueuedEdit}
      shouldClearInput={state.shouldClearInput}
      onInputCleared={handleInputCleared}
      vscode={vscode}
      selection={state.selection}
      inputContent={state.inputContent}
      sessionId={state.currentSession?.id}
      permissionMode={state.permissionMode}
      initialAttachedImages={state.attachedImages}
      host={host}
      isDraftSession={isDraftSession}
      effectiveHost={effectiveHost}
      effectiveWorkdir={effectiveWorkdir}
      panelWorkdir={panelWorkdir}
      gitBranches={gitBranches}
      worktreeBranch={worktreeBranch}
      worktreeChecked={worktreeChecked}
      patchPane={patchPane}
      modelId={(state.currentSession as { model?: string } | undefined)?.model}
      onModelChange={handleSessionModelChange}
      rewindPopupOpen={rewindPopupOpen}
      rewindCheckpointsLoading={rewindCheckpointsLoading}
      rewindCheckpoints={rewindCheckpoints}
      onRewindCheckpointSelect={handleRewindCheckpointSelect}
      onRewindPopupClose={handleRewindPopupClose}
      modelPopupOpen={modelPopupOpen}
      modelLoading={modelLoading}
      configuredModels={configuredModels}
      currentModel={currentModel}
      onModelSelect={handleModelSelect}
      onModelPopupClose={handleModelPopupClose}
    />
  );

  // One assembly for the 4 return branches (desktop shell / pane / layout / web).
  const dialogProps: ChatDialogsProps = {
    activeDialog: state.activeDialog,
    configurationData: state.configurationData,
    configurationLoading: state.configurationLoading,
    configurationError: state.configurationError,
    projectSettings: state.projectSettings,
    onLoadProjectSettings: () =>
      postToHost({ command: "getProjectSettings" }),
    onToggleBuiltinPlugin: (pluginId, enabled) =>
      postToHost({
        command: "setBuiltinPluginEnabled",
        pluginId,
        enabled,
        scope: "project",
      }),
    onConfigurationSave: handleConfigurationSave,
    onDialogClose: handleDialogClose,
    vscode,
    workflowRuns: state.workflowRuns,
    onOpenFile: handleOpenFile,
    isAuthenticated: state.isAuthenticated,
    loginError: state.loginError,
    onLogin: handleLogin,
    agentTranscript,
    subagentMessages: state.subagentMessages,
    agentToolSubagentIds: state.agentToolSubagentIds,
    onCloseAgentTranscript: handleCloseAgentTranscript,
    pendingRewindId,
    onRewindConfirm: handleRewindConfirm,
    onCancelRewind: () => patchPane({ pendingRewindId: null }),
    toasts,
    onToastDismiss: handleToastDismiss,
    onToastAction: handleToastAction,
    quickOpenOpen,
    onQuickOpenClose: () => setQuickOpenOpen(false),
    effectiveWorkdir,
  };

  // Shared dock payload: the 4 panel slots + dock chrome (rendered by
  // ChatContainer when a bound session is showing).
  const dock: DesktopPanelSlotsProps = {
    checked: checkedPanels,
    active: activePanel,
    mounted: mountedPanels,
    disabledPanels: panelDisabled,
    fullscreen: dockFullscreen,
    widths: panelWidths,
    dockMaxWidth,
    onSelect: handleSelectPanel,
    onCloseTab: handleTogglePanel,
    onAddPanel: handleAddPanel,
    onToggleDock: handleToggleDock,
    onToggleFullscreen: handleToggleFullscreen,
    onWidthChange: handleDockWidthChange,
    vscode,
    paneId,
    isStreaming: state.isStreaming,
    sessionId: state.currentSession?.id,
    workdir: effectiveWorkdir,
    previewEpoch,
    previewUrl,
    currentForward,
    previewForwardError,
    onRemotePreviewRetry: handleRemotePreviewRetry,
    onPreviewNavigate: handlePreviewNavigate,
    onAddComment: handleAddComment,
    diffView,
    recentFiles: recentDiffFiles,
    onOpenFile: handleOpenFile,
    onSendMessage: (text) => handleSendMessage(text),
    fileView,
    fileTree,
    onFileTreeChange: handleFileTreeChange,
    fileSidebarMode,
    onFileSidebarModeChange: handleFileSidebarModeChange,
    contentSearch,
    onContentSearchChange: handleContentSearchChange,
    onOpenInPreview: handleOpenLocalFilePreview,
    onRevealInFinder: handleRevealInFinder,
    openPreviewHandler,
  };

  const chatContainer = (
    <ChatContainer
      chatContainerRef={chatContainerRef}
      queueEditWarning={queueEditWarning}
      onDismissQueueEditWarning={() => patchPane({ queueEditWarning: null })}
      view={view}
      setView={setView}
      host={host}
      postToHost={postToHost}
      patchPane={patchPane}
      popoApi={popoApi}
      currentSession={state.currentSession}
      initialized={state.initialized}
      effectiveWorkdir={effectiveWorkdir}
      dock={dock}
      vscode={vscode}
      // ChatChrome / ChatBody props
      onNewSession={handleClearChat}
      onAbortMessage={handleAbortMessage}
      messages={state.messages}
      onOpenSettings={handleOpenSettings}
      onLogin={handleLogin}
      onLogout={handleLogout}
      isAuthenticated={state.isAuthenticated}
      dispatch={dispatch}
      gitBranches={gitBranches}
      isDraftSession={isDraftSession}
      checkedPanels={checkedPanels}
      onToggleDock={handleToggleDock}
      isRestoring={state.isRestoring}
      configurationData={state.configurationData}
      queuedMessages={state.queuedMessages}
      isStreaming={state.isStreaming}
      isCompacting={state.isCompacting}
      onRewindToMessage={handleRewindToMessage}
      workdir={state.workdir}
      onOpenPreview={openPreviewHandler}
      onOpenFile={handleOpenFile}
      onOpenAgentTranscript={handleOpenAgentTranscript}
      onRevertFileHistory={handleRevertFileHistory}
      revertingFileHistory={revertingFileHistory}
      onOpenFileHistoryFile={handleOpenFileHistoryDiff}
      backgroundTasks={state.backgroundTasks}
      isBackgroundTasksCollapsed={state.isBackgroundTasksCollapsed}
      onToggleBackgroundTasks={() =>
        dispatch({ type: "TOGGLE_BACKGROUND_TASKS_COLLAPSE" })
      }
      onStopTask={(taskId) =>
        postToHost({ command: "stopBackgroundTask", taskId })
      }
      tasks={state.tasks}
      isTaskListCollapsed={state.isTaskListCollapsed}
      onToggleTaskList={() =>
        dispatch({ type: "TOGGLE_TASK_LIST_COLLAPSE" })
      }
      isQueueCollapsed={state.isQueueCollapsed}
      onToggleQueueCollapse={() =>
        dispatch({ type: "TOGGLE_QUEUE_COLLAPSE" })
      }
      onEditQueuedMessage={handleEditQueuedMessage}
      onDeleteQueuedMessage={handleDeleteQueuedMessage}
      editingQueuedId={state.editingQueuedId}
      pendingConfirmations={state.pendingConfirmations}
      onConfirm={handleConfirmation}
      onReject={handleRejection}
      composer={composer}
    />
  );

  if (host?.type === "desktop") {
    // FR-032 split-view: when the host has pushed a pane layout, DesktopShell
    // owns the row of paneId-scoped ChatApp instances. This instance then only
    // contributes its pane-scoped chatContainer (rendered below); without a
    // paneId it would double-render, so bail out to the shell instead.
    if ((host.panes?.length ?? 0) > 0 && paneId === undefined) {
      return (
        <>
          <DesktopShell
            vscode={vscode}
            host={host}
            onOpenSettings={handleOpenSettings}
          />
          <ChatDialogs {...dialogProps} />
        </>
      );
    }
    // Inside DesktopShell each pane renders only its own chatContainer; the
    // sidebar / preview pane live in the shell / single-pane layout.
    if (paneId !== undefined) {
      return (
        <>
          {chatContainer}
          <ChatDialogs {...dialogProps} />
        </>
      );
    }
    return (
      <div className="desktop-layout">
        <DesktopSidebar
          onNewSession={handleDesktopNewSession}
          onNewSessionInPane={() => {
            setView("chat");
            postToHost({ command: "desktopNewSessionInPane" });
          }}
          onNewSessionInWorkdir={handleDesktopNewSessionInWorkdir}
          isStreaming={state.isStreaming}
          disabled={false}
          onOpenSettings={handleOpenSettings}
          {...resolveSidebarSessions({ sessionTree: host.sessionTree })}
          todoGroups={host.todoGroups}
          currentSessionId={state.currentSession?.id}
          onSelectSession={(workdir, sessionId) => {
            // 点侧栏会话立即回到聊天视图：即使点的是当前会话（host 不推
            // updateCurrentSession、effect 不触发），机器人页等视图也能退出。
            setView("chat");
            host.onSelectSession(workdir, sessionId);
          }}
          onOpenPane={host.onOpenPane}
          onDeleteSession={host.onDeleteSession}
          onTogglePin={host.onTogglePin}
          onRenameSession={host.onRenameSession}
          onOpenInEditor={(workdir) =>
            postToHost({ command: "desktopOpenInEditor", workdir })
          }
          onOpenInTerminal={(workdir) =>
            postToHost({ command: "desktopOpenInTerminal", workdir })
          }
          onRevealInFinder={(workdir) =>
            postToHost({ command: "revealInFinder", path: workdir })
          }
          onTogglePopoRobot={() => setView((v) => (v === "popo-robot" ? "chat" : "popo-robot"))}
          onToggleTodoBoard={() =>
            setView((v) => (v === "todo-board" ? "chat" : "todo-board"))
          }
          todoReviewCount={todoReviewCount}
          popoEnabled={popoEnabled}
          activeMenu={
            view === "popo-robot"
              ? "popo-robot"
              : view === "todo-board"
                ? "todo-board"
                : view === "newChat" || showNewSessionPage
                  ? "newChat"
                  : undefined
          }
        />
        {chatContainer}
        <ChatDialogs {...dialogProps} />
        <TodoNotifyStack onOpen={openTodoNotification} />
      </div>
    );
  }

  return (
    <>
      {chatContainer}
      <ChatDialogs {...dialogProps} />
    </>
  );
};
