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
import { AutomationsPage } from "./automation/AutomationsPage";
import { ChatComposer } from "./chat/ChatComposer";
import { ChatDialogs, type ChatDialogsProps } from "./dialogs/ChatDialogs";
import { NewIssueDialog } from "./issue/NewIssueDialog";
import { OpenPlanningDialog } from "./issue/OpenPlanningDialog";
import { PopoUiProvider, usePopoUi } from "./popo/popoUi";
import type { DesktopPanelSlotsProps } from "./desktop/DesktopPanelSlots";
import { useAgentsStore } from "../stores/agentsStore";
import { MuseApiClient } from "../muse/apiClient";
import { resolveDraftModel } from "../muse/defaultModel";
import { resolveMuseServerUrl } from "../muse/hostBridge";
import type { WorkspaceDiffFile } from "./panels/DiffPane";
import { prefetchTerminalLib } from "./panels/TerminalPane";
import {
  chatMainMinWidth,
  paneHasSidebarInset,
} from "../muse/layout";
import { useDesktopSidebarWidth } from "../hooks/useDesktopSidebarWidth";
import { useDesktopSidebarCollapsed } from "../hooks/useDesktopSidebarCollapsed";
import { DesktopSidebarToggle } from "./desktop/DesktopSidebarToggle";
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

/** 主内容区视图：chat 需要结合当前会话（state.currentSession）渲染。 */
export type MainView = "newChat" | "chat" | "popo-chat" | "automations";

export const ChatApp: React.FC<ChatAppProps> = (props) => {
  const popoApi = useMemo(
    () => new MuseApiClient({ baseUrl: resolveMuseServerUrl() }),
    [],
  );
  if (props.paneId !== undefined) {
    return <ChatAppInner {...props} popoApi={popoApi} />;
  }
  return (
    <PopoUiProvider api={popoApi}>
      <ChatAppInner {...props} popoApi={popoApi} />
    </PopoUiProvider>
  );
};

const ChatAppInner: React.FC<ChatAppProps & { popoApi: MuseApiClient }> = ({
  vscode,
  host,
  paneId,
  popoApi,
}) => {
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
    fileTabs,
    activeFilePath,
    diffView,
    fileTree,
    fileSidebarMode,
    contentSearch,
    forward: currentForward,
    forwardError: previewForwardError,
    previewEpoch,
  } = usePanelGroup(groupKey);
  // Single-file view for the panel body = the active tab (multi-tab: the tab
  // bar lives in FilePane; everything downstream keeps working on one view).
  const fileView = useMemo(
    () => fileTabs.find((t) => t.path === activeFilePath) ?? null,
    [fileTabs, activeFilePath],
  );
  const previewUrlRef = useRef(previewUrl);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [chatColumnWidth, setChatColumnWidth] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth : 1280),
  );
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  // 主内容区视图：聊天（展示 state.currentSession 对应会话）/ 新会话页 / POPO 机器人页。
  // 独立于 host 推送的会话状态，任何导航入口显式切换。
  const [view, setView] = useState<MainView>("chat");
  const popoUi = usePopoUi();
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [planningIssueId, setPlanningIssueId] = useState<string | null>(null);
  // 初始化数字人 agent store（GET /agents + /agents/scenarios），选择器/设置页共用
  useEffect(() => {
    useAgentsStore.getState().init(popoApi);
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
  const openQuickOpenRef = useRef<(query: string) => void>(() => {});
  const messageInputRef = useRef<MessageInputHandle>(null);
  const messageListRef = useRef<{
    scrollToBottom: (behavior?: ScrollBehavior) => void;
  }>(null);
  const stateRef = useRef(state);
  // The pane this instance renders; undefined = single view (desktop
  // single-pane layout). Ref mirror for use inside stable callbacks.
  const paneIdRef = useRef<string | undefined>(paneId);

  openQuickOpenRef.current = (query: string) => {
    setQuickOpenQuery(query);
    setQuickOpenOpen(true);
  };

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
          openQuickOpenRef,
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

  // Desktop: reset worktree opt-in only when the workdir path actually changes.
  // Do not depend on `gitBranches` (poll rewrites it) or treat `patchPane`
  // identity changes as a workdir switch — that wiped the pick and created
  // from HEAD/current instead of the selected base branch.
  const prevWorkdirRef = useRef(effectiveWorkdir);
  useEffect(() => {
    const prev = prevWorkdirRef.current;
    prevWorkdirRef.current = effectiveWorkdir;
    if (prev === effectiveWorkdir) return;
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

  const { width: sidebarWidth } = useDesktopSidebarWidth();
  const { collapsed: sidebarCollapsed } = useDesktopSidebarCollapsed();
  const layoutSidebarWidth = sidebarCollapsed ? 0 : sidebarWidth;
  const sidebarInset =
    !dockFullscreen && !sidebarCollapsed && paneHasSidebarInset(host?.panes, paneId);
  const chatMinWidth = chatMainMinWidth(sidebarInset, layoutSidebarWidth);
  const dockMaxWidth = chatColumnWidth - chatMinWidth;
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
    setQuickOpenOpen: (value) => {
      const next =
        typeof value === "function" ? value(quickOpenOpen) : value;
      if (next) setQuickOpenQuery("");
      else setQuickOpenQuery("");
      setQuickOpenOpen(next);
    },
    checkedPanels,
    mountedPanels,
    activePanel,
    panelWidths,
    dockMaxWidth,
    chatMinWidth,
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
    handleOpenFilePin,
    handleRefreshOpenFile,
    handleSelectFileTab,
    handleCloseFileTab,
    handlePinFileTab,
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
    handleAgentChange,
    handleModelPopupClose,
    handleDesktopNewSession,
    handleDesktopNewSessionInWorkdir,
    handleInputCleared,
  } = dialogActions;

  // session 场景映射的默认 agent key（无会话 agentName 时选择器展示它）。
  const defaultSessionAgentKey = useAgentsStore(
    (s) => s.scenarios?.session ?? "default",
  );
  // agent 列表缓存（设置页与输入框选择器共用），含每个 agent 的 model。
  const agents = useAgentsStore((s) => s.agents);

  // 已建会话：modelId = currentSession.model（server 按 agent 重算后 emit 回来，已联动）。
  // draft 态：优先用户手动选的 model（≠默认值）；否则解析 draft 会话绑定的 agent
  // （先会话所选 agentName，未选则 session 场景默认 agent）的 model，兜底默认模型。
  const currentSessionModel = (
    state.currentSession as { model?: string } | undefined
  )?.model;
  const sessionAgentName = (
    state.currentSession as { agentName?: string } | undefined
  )?.agentName;
  const resolvedModelId = isDraftSession
    ? resolveDraftModel(
        currentSessionModel,
        sessionAgentName,
        defaultSessionAgentKey,
        agents,
      )
    : currentSessionModel;

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
      modelId={resolvedModelId}
      onModelChange={handleSessionModelChange}
      agentName={(state.currentSession as { agentName?: string } | undefined)?.agentName}
      defaultAgentName={defaultSessionAgentKey}
      onAgentChange={handleAgentChange}
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
    quickOpenQuery,
    onQuickOpenClose: () => {
      setQuickOpenOpen(false);
      setQuickOpenQuery("");
    },
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
    onOpenFilePinned: handleOpenFilePin,
    onRefreshOpenFile: handleRefreshOpenFile,
    onSendMessage: (text) => handleSendMessage(text),
    fileView,
    fileTabs,
    activeFilePath,
    onSelectFileTab: handleSelectFileTab,
    onCloseFileTab: handleCloseFileTab,
    onPinFileTab: handlePinFileTab,
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
      popoChatKey={popoUi.selectedChatKey}
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
      onSelectPrompt={(text) => messageInputRef.current?.setText(text)}
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
    const refreshSessionTree = () =>
      postToHost({ command: "desktopRefreshSessionTree" });
    const issueSidebarProps = {
      issueGroups: host.issueGroups,
      onNewIssue: () => setShowNewIssue(true),
      onOpenPlanning: (issueId: string) => setPlanningIssueId(issueId),
      onCompleteIssue: (issueId: string) => {
        void popoApi
          .completeIssue(issueId)
          .then(refreshSessionTree)
          .catch((err) => {
            window.alert(
              err instanceof Error ? err.message : "完成 Issue 失败",
            );
          });
      },
      onCancelIssue: (issueId: string) => {
        void popoApi
          .cancelIssue(issueId)
          .then(refreshSessionTree)
          .catch((err) => {
            window.alert(
              err instanceof Error ? err.message : "取消 Issue 失败",
            );
          });
      },
    };
    const newIssueDialog = showNewIssue ? (
      <NewIssueDialog
        api={popoApi}
        onCancel={() => setShowNewIssue(false)}
        onCreated={() => {
          setShowNewIssue(false);
          refreshSessionTree();
        }}
      />
    ) : null;
    const openPlanningDialog = planningIssueId ? (
      <OpenPlanningDialog
        issueId={planningIssueId}
        api={popoApi}
        postToHost={postToHost}
        recentWorkdirs={host.recentWorkdirs}
        onCancel={() => setPlanningIssueId(null)}
        onOpened={({ sessionId, workdir }) => {
          setPlanningIssueId(null);
          host.onSelectSession(workdir, sessionId);
          refreshSessionTree();
        }}
      />
    ) : null;

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
            onLogin={handleLogin}
            isAuthenticated={state.isAuthenticated}
            api={popoApi}
            postToHost={postToHost}
            {...issueSidebarProps}
          />
          {newIssueDialog}
          {openPlanningDialog}
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
      <div
        className="desktop-layout"
        data-sidebar-collapsed={sidebarCollapsed ? "true" : undefined}
        style={
          {
            "--desktop-sidebar-width": `${layoutSidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <DesktopSidebarToggle />
        {!sidebarCollapsed ? (
        <DesktopSidebar
          onNewSession={() => {
            popoUi.selectChat(null);
            setView("chat");
            handleDesktopNewSession();
          }}
          onNewSessionInPane={() => {
            setView("chat");
            postToHost({ command: "desktopNewSessionInPane" });
          }}
          onNewSessionInWorkdir={handleDesktopNewSessionInWorkdir}
          isStreaming={state.isStreaming}
          disabled={false}
          onOpenSettings={handleOpenSettings}
          onLogin={handleLogin}
          isAuthenticated={state.isAuthenticated}
          {...resolveSidebarSessions({ sessionTree: host.sessionTree })}
          {...issueSidebarProps}
          currentSessionId={
            popoUi.selectedChatKey ? undefined : state.currentSession?.id
          }
          onSelectSession={(workdir, sessionId) => {
            popoUi.selectChat(null);
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
          popoEnabled={popoUi.enabled}
          popoChats={popoUi.chats}
          selectedPopoChatKey={popoUi.selectedChatKey}
          onSelectPopoChat={(chatKey) => {
            popoUi.selectChat(chatKey);
            setView("popo-chat");
          }}
          onDeletePopoChat={(chatKey) => {
            void popoUi.deleteChat(chatKey).catch((err) => {
              window.alert(err instanceof Error ? err.message : "删除 POPO 会话失败");
            });
          }}
          onOpenAutomations={() => {
            popoUi.selectChat(null);
            setView("automations");
          }}
          activeMenu={
            view === "automations"
              ? "automations"
              : view === "newChat" || showNewSessionPage
                ? "newChat"
                : undefined
          }
        />
        ) : null}
        {view === "automations" ? (
          <AutomationsPage
            api={popoApi}
            postToHost={postToHost}
            recentWorkdirs={host.recentWorkdirs ?? []}
          />
        ) : (
          chatContainer
        )}
        {newIssueDialog}
        {openPlanningDialog}
        <ChatDialogs {...dialogProps} />
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
