import React, {
  useEffect,
  useReducer,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentTranscriptPopup } from "./dialogs/AgentTranscriptPopup";
import { MessageList } from "./chat/MessageList";
import { MessageInput } from "./chat/MessageInput";
import type { MessageInputHandle } from "./chat/MessageInput";
import { ChatHeader } from "./chat/ChatHeader";
import { DesktopPanelDock } from "./desktop/DesktopPanelDock";
import { TaskList } from "./chat/TaskList";
import { BackgroundTaskList } from "./chat/BackgroundTaskList";
import { QueuedMessageList } from "./chat/QueuedMessageList";
import { ConfirmationDialog } from "./dialogs/ConfirmationDialog";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { RewindPopup } from "./dialogs/RewindPopup";
import { ModelPopup } from "./dialogs/ModelPopup";
import { ToastStack } from "./shared/ToastStack";
import ConfigDialog from "./dialogs/ConfigDialog";
import PluginDialog from "./dialogs/PluginDialog";
import McpDialog from "./dialogs/McpDialog";
import StatusDialog from "./dialogs/StatusDialog";
import WorkflowManager from "./settings/WorkflowManager";
import AgentsDialog from "./dialogs/AgentsDialog";
import LoginDialog from "./dialogs/LoginDialog";
import WelcomeView from "./chat/WelcomeView";
import { NewSessionPage } from "./chat/NewSessionPage";
import LoadingLogo from "./chat/LoadingLogo";
import {
  DesktopSidebar,
  resolveSidebarSessions,
} from "./desktop/DesktopSidebar";
import { DesktopShell } from "./desktop/DesktopShell";
import { DesktopWorkdirSelector } from "./desktop/DesktopWorkdirSelector";
import { DesktopWorktreeControls } from "./desktop/DesktopWorktreeControls";
import { PANEL_TAB_ORDER } from "../muse/panelTabs";
import { createMessageHandler } from "../muse/messageRouter";
import { PreviewPane } from "./panels/PreviewPane";
import {
  DiffPane,
  type WorkspaceDiffFile,
} from "./panels/DiffPane";
import { TerminalPane, prefetchTerminalLib } from "./panels/TerminalPane";
import { FilePane } from "./panels/FilePane";
import { QuickOpenPalette } from "./panels/QuickOpenPalette";
import { PopoRobotView } from "./popo/PopoRobotView";
import { TodoBoard } from "./todo/TodoBoard";
import { TodoNotifyStack } from "./todo/TodoNotifyStack";
import { useTodoBoardStore, type TodoNotification } from "../stores/todoBoardStore";
import { MuseApiClient } from "../muse/apiClient";
import { resolveMuseServerUrl } from "../muse/hostBridge";
import type {
  ChatAppProps,
  DesktopPanelKind,
} from "../types";
import { chatReducer, initialState } from "../reducers/chatReducer";
import { resolveSubagentMessages } from "../utils/subagentTranscript";
import {
  PANEL_DEFAULT_WIDTH,
  usePanelGroup,
  usePaneUi,
} from "../stores";
import { dedupeSnapshotsByFile } from "../utils/fileHistorySnapshots";
import { useChatAppCore } from "../hooks/useChatAppCore";
import { useChatSend } from "../hooks/useChatSend";
import { usePanels } from "../hooks/usePanels";
import { useFilePanel } from "../hooks/useFilePanel";
import { usePreview } from "../hooks/usePreview";
import { useRewind } from "../hooks/useRewind";
import { useDialogs } from "../hooks/useDialogs";
import "../styles/ChatApp.css";


export { prunePanelGroupCache } from "../stores";

/** Desktop conversation-level panels: tab order in the shared dock. */
const PANEL_ORDER = PANEL_TAB_ORDER;
const PANEL_MIN_WIDTH = 320;
/** The conversation (message) area never shrinks below this when opening/dragging panels. */
const CHAT_MAIN_MIN_WIDTH = 520;

/**
 * Hostname spellings that name the same remote service through an ssh tunnel:
 * the forward always targets the remote's `localhost:<port>`, so every
 * loopback and all-interfaces spelling refers to the same endpoint (aligned
 * with VS Code's LOCALHOST_ADDRESSES / ALL_INTERFACES_ADDRESSES, whose
 * mapHasAddressLocalhostOrAllInterfaces treats them as one tunnel). Both
 * bracketed and bare IPv6 forms are covered — URL.hostname serializes the
 * former, terminal/Markdown links may carry the latter.
 */
const LOOPBACK_OR_ALL_INTERFACES_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0:0:0:0:0:0:0:1",
  "[0:0:0:0:0:0:0:1]",
  "0.0.0.0",
  "::",
  "[::]",
  "0:0:0:0:0:0:0:0",
  "[0:0:0:0:0:0:0:0]",
]);

/**
 * Canonical form of a preview URL for same-link comparison: collapses the
 * loopback/all-interfaces host spellings above to `localhost`, so clicking
 * `http://127.0.0.1:5173/app` after `http://localhost:5173/app` reuses the
 * established tunnel instead of release + re-acquire churn. Non-loopback URLs
 * (external sites) are returned unchanged.
 */
function canonicalForwardUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (LOOPBACK_OR_ALL_INTERFACES_HOSTS.has(u.hostname.toLowerCase()))
      u.hostname = "localhost";
    return u.href;
  } catch {
    return raw;
  }
}

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


  const renderPanelSlot = (kind: DesktopPanelKind) => {
    const dockWidth =
      panelWidths[activePanel ?? kind] ?? PANEL_DEFAULT_WIDTH;
    const common = {
      width: dockWidth,
      onWidthChange: handleDockWidthChange,
      maxWidth: dockMaxWidth,
      onClose: () => handleTogglePanel(kind),
    };

    if (kind === "preview") {
      return (
        <PreviewPane
          key={previewEpoch}
          url={previewUrl}
          originalUrl={currentForward?.originalUrl}
          onRetry={currentForward ? handleRemotePreviewRetry : undefined}
          forwardError={previewForwardError}
          onNavigate={handlePreviewNavigate}
          vscode={vscode}
          onAddComment={handleAddComment}
          {...common}
        />
      );
    }
    if (kind === "diff") {
      return (
        <DiffPane
          vscode={vscode}
          paneId={paneId}
          visible={checkedPanels.includes("diff")}
          isStreaming={state.isStreaming}
          sessionId={state.currentSession?.id}
          workdir={effectiveWorkdir}
          diffView={diffView}
          recentFiles={recentDiffFiles}
          onOpenFile={handleOpenFile}
          onAddComment={handleAddComment}
          onSendMessage={(text) => handleSendMessage(text)}
          {...common}
        />
      );
    }
    if (kind === "file") {
      return (
        <FilePane
          fileView={fileView}
          workdir={effectiveWorkdir}
          vscode={vscode}
          fileTree={fileTree}
          onFileTreeChange={handleFileTreeChange}
          fileSidebarMode={fileSidebarMode}
          onFileSidebarModeChange={handleFileSidebarModeChange}
          contentSearch={contentSearch}
          onContentSearchChange={handleContentSearchChange}
          onOpenFile={handleOpenFile}
          onOpenInPreview={handleOpenLocalFilePreview}
          onRevealInFinder={handleRevealInFinder}
          isStreaming={state.isStreaming}
          visible={checkedPanels.includes("file")}
          {...common}
        />
      );
    }
    return (
      <TerminalPane
        vscode={vscode}
        paneId={paneId}
        visible={checkedPanels.includes("terminal")}
        workdir={effectiveWorkdir}
        onOpenPreview={openPreviewHandler}
        {...common}
      />
    );
  };

  const showNewSessionPage = isDraftSession && state.initialized;

  const messageInput = (
    <MessageInput
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
      disabled={
        host?.type === "desktop" && !effectiveWorkdir && !isDraftSession
      }
      modelId={
        (state.currentSession as { model?: string } | undefined)?.model
      }
      onModelChange={handleSessionModelChange}
      workdir={effectiveWorkdir ?? panelWorkdir}
      workdirSelector={
        host?.type === "desktop" && isDraftSession ? (
          <>
            <DesktopWorkdirSelector
              host={effectiveHost}
              workdir={effectiveWorkdir}
              recentWorkdirs={host.recentWorkdirs}
              onSelectWorkdir={host.onSelectWorkdir}
              onSelectRecentWorkdir={host.onSelectRecentWorkdir}
              onRemoveRecentWorkdir={host.onRemoveRecentWorkdir}
            />
            {effectiveWorkdir &&
              gitBranches &&
              gitBranches.branches.length > 0 && (
                <DesktopWorktreeControls
                  branches={gitBranches.branches}
                  branch={worktreeBranch || gitBranches.current}
                  worktreeChecked={worktreeChecked}
                  onBranchChange={(branch) =>
                    patchPane({ worktreeBranch: branch })
                  }
                  onWorktreeChange={(checked) =>
                    patchPane({ worktreeChecked: checked })
                  }
                />
              )}
          </>
        ) : undefined
      }
      rewindPopup={
        <RewindPopup
          isVisible={rewindPopupOpen}
          isLoading={rewindCheckpointsLoading}
          checkpoints={rewindCheckpoints}
          onSelect={handleRewindCheckpointSelect}
          onClose={handleRewindPopupClose}
        />
      }
      modelPopup={
        <ModelPopup
          isVisible={modelPopupOpen}
          isLoading={modelLoading}
          models={configuredModels}
          currentModel={currentModel}
          onSelect={handleModelSelect}
          onClose={handleModelPopupClose}
        />
      }
    />
  );

  const newSessionPage = (
    <NewSessionPage
      welcome={
        <WelcomeView
          embedded
          isAuthenticated={state.isAuthenticated}
          hasDirectConnectConfig={
            !!(
              state.configurationData?.apiKey &&
              state.configurationData?.baseURL
            )
          }
          onLogin={handleLogin}
        />
      }
      composer={messageInput}
    />
  );

  const chatBodyContent = state.isRestoring ? (
    // Desktop restore in progress: the pane already switched to the target
    // session — show the sweep animation over the message + input area until
    // the host finishes connecting and replaying the transcript (spec 场景 7).
    <div
      className="chat-restoring-overlay"
      data-testid="chat-restoring-overlay"
    >
      <LoadingLogo />
    </div>
  ) : (
    <>
      {showWelcomeReady ? (
        <WelcomeView
          isAuthenticated={state.isAuthenticated}
          hasDirectConnectConfig={
            !!(
              state.configurationData?.apiKey &&
              state.configurationData?.baseURL
            )
          }
          onLogin={handleLogin}
        />
      ) : showWelcome ? (
        <LoadingLogo />
      ) : (
        <MessageList
          ref={messageListRef}
          messages={state.messages}
          queuedMessages={state.queuedMessages}
          isStreaming={state.isStreaming}
          isCompacting={state.isCompacting}
          vscode={vscode}
          onRewindToMessage={handleRewindToMessage}
          workdir={state.workdir}
          onOpenPreview={openPreviewHandler}
          onOpenFile={handleOpenFile}
          onOpenAgentTranscript={handleOpenAgentTranscript}
          onRevertFileHistory={handleRevertFileHistory}
          revertingFileHistory={revertingFileHistory}
          onOpenFileHistoryFile={handleOpenFileHistoryDiff}
        />
      )}

      <div
        className={`input-area-container${state.pendingConfirmations.length > 0 ? " input-area-container--confirm" : ""}`}
      >
        <div
          style={{
            display: state.pendingConfirmations.length === 0 ? "block" : "none",
          }}
        >
          <BackgroundTaskList
            // 按会话 id 重挂载：切换会话时重置"全部完成自动隐藏"的跟踪。
            // 注意与 TaskList 的 key 保持不同——两个兄弟组件用同一 key 会触发
            // React 重复 key 警告（session id 每次渲染都相同）。
            key={`bg-${state.currentSession?.id ?? "none"}`}
            tasks={state.backgroundTasks}
            isCollapsed={state.isBackgroundTasksCollapsed}
            onToggleCollapse={() =>
              dispatch({ type: "TOGGLE_BACKGROUND_TASKS_COLLAPSE" })
            }
            onStopTask={(taskId) =>
              postToHost({ command: "stopBackgroundTask", taskId })
            }
          />
          <TaskList
            // 按会话 id 重挂载：切换会话时重置“观察过未完成任务”的跟踪，
            // 使全部已完成的新会话立即隐藏，而不是沿用上一会话的 5 秒宽限
            key={`tasks-${state.currentSession?.id ?? "none"}`}
            tasks={state.tasks}
            isCollapsed={state.isTaskListCollapsed}
            onToggleCollapse={() =>
              dispatch({ type: "TOGGLE_TASK_LIST_COLLAPSE" })
            }
          />
          <QueuedMessageList
            queuedMessages={state.queuedMessages}
            isCollapsed={state.isQueueCollapsed}
            onToggleCollapse={() => dispatch({ type: "TOGGLE_QUEUE_COLLAPSE" })}
            onEdit={handleEditQueuedMessage}
            onDelete={handleDeleteQueuedMessage}
            editingQueuedId={state.editingQueuedId}
            vscode={vscode}
          />
        </div>

        <div
          style={{
            display: state.pendingConfirmations.length === 0 ? "block" : "none",
          }}
        >
          {messageInput}
        </div>

        {state.pendingConfirmations.length > 0 && (
          <ConfirmationDialog
            key={state.pendingConfirmations[0].confirmationId}
            data-confirmation-id={state.pendingConfirmations[0].confirmationId}
            confirmation={state.pendingConfirmations[0]}
            onConfirm={handleConfirmation}
            onReject={handleRejection}
          />
        )}
      </div>
    </>
  );

  // Dialogs render at the component root — not inside chatContainer — so they
  // stay visible in every layout: the desktop split-view shell (where the root
  // ChatApp never mounts its own chatContainer) still shows the config dialog
  // opened from the sidebar 更多 menu.
  const dialogs = (
    <>
      {state.activeDialog === "config" && (
        <ConfigDialog
          configurationData={state.configurationData || {}}
          isLoading={state.configurationLoading}
          error={state.configurationError}
          onSave={handleConfigurationSave}
          onCancel={handleDialogClose}
          projectSettings={state.projectSettings}
          onLoadProjectSettings={() =>
            postToHost({ command: "getProjectSettings" })
          }
          onToggleBuiltinPlugin={(pluginId, enabled) =>
            postToHost({
              command: "setBuiltinPluginEnabled",
              pluginId,
              enabled,
              scope: "project",
            })
          }
          vscode={vscode}
        />
      )}
      {state.activeDialog === "plugin" && (
        <PluginDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {state.activeDialog === "mcp" && (
        <McpDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {state.activeDialog === "status" && (
        <StatusDialog
          onClose={handleDialogClose}
          vscode={vscode}
        />
      )}
      {state.activeDialog === "workflows" && (
        <WorkflowManager
          runs={state.workflowRuns}
          vscode={vscode}
          onCancel={handleDialogClose}
          onOpenFile={(path) => {
            handleOpenFile(path);
            handleDialogClose();
          }}
        />
      )}
      {state.activeDialog === "agents" && (
        <AgentsDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {state.activeDialog === "login" && (
        <LoginDialog
          isAuthenticated={state.isAuthenticated}
          loginError={state.loginError}
          onLogin={handleLogin}
          onCancel={handleDialogClose}
        />
      )}
      {agentTranscript && (
        <AgentTranscriptPopup
          title={agentTranscript.title}
          messages={resolveSubagentMessages(
            state.subagentMessages,
            state.agentToolSubagentIds,
            agentTranscript.subagentId,
            {
              nestedMessages: agentTranscript.nestedMessages,
              fallbackText: agentTranscript.fallbackText,
              prompt: agentTranscript.prompt,
            },
          )}
          vscode={vscode}
          onClose={handleCloseAgentTranscript}
        />
      )}
      {pendingRewindId && (
        <ConfirmDialog
          title="确定要回滚到此消息吗？"
          description="这将删除之后的所有消息并撤销相关的文件更改。"
          onConfirm={handleRewindConfirm}
          onCancel={() => patchPane({ pendingRewindId: null })}
        />
      )}
      <ToastStack
        toasts={toasts}
        onDismiss={handleToastDismiss}
        onAction={handleToastAction}
      />
      <QuickOpenPalette
        open={quickOpenOpen}
        workdir={effectiveWorkdir}
        vscode={vscode}
        onClose={() => setQuickOpenOpen(false)}
        onOpenFile={(path) => handleOpenFile(path)}
      />
    </>
  );

  const chatChrome = (
    <>
      <ChatHeader
        onNewSession={handleClearChat}
        newSessionDisabled={false}
        onAbortMessage={handleAbortMessage}
        messages={state.messages}
        currentSession={state.currentSession}
        onOpenSettings={handleOpenSettings}
        onLogin={handleLogin}
        onLogout={handleLogout}
        isAuthenticated={state.isAuthenticated}
        hideSessionButtons
        hideMoreButton
        gitContext={headerGitContext}
        commandMenuItems={[
          {
            id: "compact",
            label: "压缩会话",
            icon: "codicon-fold",
            onClick: () => postToHost({ command: "compactChat" }),
          },
          {
            id: "clear",
            label: "清空会话",
            icon: "codicon-trash",
            onClick: handleClearChat,
          },
          {
            id: "rewind",
            label: "回滚到检查点",
            icon: "codicon-history",
            onClick: () => {
              patchPane({
                rewindPopupOpen: true,
                rewindCheckpointsLoading: true,
              });
              postToHost({ command: "listRewindCheckpoints" });
            },
          },
          {
            id: "mcp",
            label: "MCP 服务器",
            icon: "codicon-plug",
            onClick: () =>
              dispatch({ type: "SHOW_DIALOG", payload: { type: "mcp" } }),
          },
          {
            id: "status",
            label: "会话状态",
            icon: "codicon-info",
            onClick: () =>
              dispatch({ type: "SHOW_DIALOG", payload: { type: "status" } }),
          },
          {
            id: "workflows",
            label: "工作流",
            icon: "codicon-type-hierarchy",
            onClick: () =>
              dispatch({
                type: "SHOW_DIALOG",
                payload: { type: "workflows" },
              }),
          },
        ]}
        panelToggle={
          checkedPanels.length === 0
            ? {
                onToggleDock: handleToggleDock,
              }
            : undefined
        }
      />
      {chatBodyContent}
    </>
  );

  const chatContainer = (
    <div
      className="chat-container"
      data-testid="chat-container"
      ref={chatContainerRef}
    >
      {queueEditWarning && (
        <div
          className="queue-edit-warning-banner"
          role="alert"
          data-testid="queue-edit-warning"
        >
          <span className="queue-edit-warning-text">{queueEditWarning}</span>
          <button
            className="queue-edit-warning-close"
            onClick={() => patchPane({ queueEditWarning: null })}
            aria-label="关闭"
          >
            <i className="codicon codicon-close"></i>
          </button>
        </div>
      )}
      <div className="desktop-chat-body">
        <div className="desktop-chat-main">
          {view === "todo-board" ? (
            <TodoBoard
              api={popoApi}
              onOpenPlanningSession={(sessionId, workdir) => {
                // 打开规划会话：切回聊天视图并选中该会话
                if (!host) return;
                setView("chat");
                host.onSelectSession(workdir, sessionId);
              }}
              onOpenExecutionSession={(sessionId) => {
                // 打开执行会话：切回聊天视图并选中该会话
                if (!host) return;
                setView("chat");
                host.onSelectSession("", sessionId);
              }}
              onOpenInEditor={(workdir) =>
                postToHost({ command: "desktopOpenInEditor", workdir })
              }
              onOpenInTerminal={(workdir) =>
                postToHost({ command: "desktopOpenInTerminal", workdir })
              }
              onTodosChanged={() =>
                postToHost({ command: "desktopRefreshSessionTree" })
              }
            />
          ) : view === "popo-robot" ? (
            <PopoRobotView api={popoApi} vscode={vscode} />
          ) : isDraftSession && !state.initialized ? (
            <LoadingLogo />
          ) : view === "newChat" || showNewSessionPage ? (
            newSessionPage
          ) : (
            chatChrome
          )}
        </div>
        {/* 文件/变更等面板只在会话详情（chat 视图）显示，机器人页/新会话页隐藏 */}
        {view === "chat" && !isDraftSession && checkedPanels.length > 0 && activePanel && (
          <DesktopPanelDock
            checked={checkedPanels}
            active={activePanel}
            onSelect={handleSelectPanel}
            onCloseTab={handleTogglePanel}
            onAddPanel={handleAddPanel}
            disabledPanels={panelDisabled}
            panelToggle={{
              onToggleDock: handleToggleDock,
            }}
            fullscreen={dockFullscreen}
            onToggleFullscreen={handleToggleFullscreen}
            width={Math.min(
              panelWidths[activePanel] ?? PANEL_DEFAULT_WIDTH,
              Math.max(PANEL_MIN_WIDTH, dockMaxWidth),
            )}
            onWidthChange={handleDockWidthChange}
            maxWidth={Math.max(PANEL_MIN_WIDTH, dockMaxWidth)}
          >
            {PANEL_ORDER.filter((kind) => mountedPanels.includes(kind)).map(
              (kind) => (
                <div
                  key={kind}
                  className="desktop-panel-slot"
                  style={{
                    display:
                      checkedPanels.includes(kind) && kind === activePanel
                        ? undefined
                        : "none",
                  }}
                >
                  {renderPanelSlot(kind)}
                </div>
              ),
            )}
          </DesktopPanelDock>
        )}
      </div>
    </div>
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
          {dialogs}
        </>
      );
    }
    // Inside DesktopShell each pane renders only its own chatContainer; the
    // sidebar / preview pane live in the shell / single-pane layout.
    if (paneId !== undefined) {
      return (
        <>
          {chatContainer}
          {dialogs}
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
        {dialogs}
        <TodoNotifyStack onOpen={openTodoNotification} />
      </div>
    );
  }

  return (
    <>
      {chatContainer}
      {dialogs}
    </>
  );
};
