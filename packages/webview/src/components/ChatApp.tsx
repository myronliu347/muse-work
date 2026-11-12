import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MessageInputHandle } from "./chat/MessageInput";
import { useAssistantHomeVisible } from "./assistant/museBotNotice";
import { ChatSessionColumn } from "./chat/ChatSessionColumn";
import { buildChatDialogProps } from "./chat/chatDialogProps";
import { useIssueComposer } from "./chat/useIssueComposer";
import { AssistantFrame } from "./assistant/AssistantFrame";
import { DesktopChatLayout } from "./desktop/DesktopChatLayout";
import {
  useBotWorkspace,
  useBotWorkspaceController,
  type BotWorkspaceContextValue,
} from "./desktop/BotTabs";
import { useBotListsWide } from "./desktop/BotLists";
import { ChatDialogs } from "./dialogs/ChatDialogs";
import type { ConfigDialogHandle } from "./dialogs/ConfigDialog";
import {
  registerDesktopNewSessionOpener,
  subscribeFocusedPaneNewSession,
} from "../muse/desktopNewSessionNav";
import { registerDesktopSettingsOpener } from "../muse/desktopSettingsNav";
import { registerUnfocusedClose } from "../muse/sidePanelTabs";
import { draftSessionMetadata } from "../utils/session";
import {
  useProvidedShellSurface,
  useShellSurface,
  type ShellSurface,
} from "./desktop/shellSurface";
import { useScenarioModelsStore } from "../stores/scenarioModelsStore";
import { MuseApiClient } from "../muse/apiClient";
import { resolveDraftModel } from "../muse/defaultModel";
import { resolveMuseServerUrl } from "../muse/hostBridge";
import { prefetchTerminalLib } from "./panels/TerminalPane";
import {
  DESKTOP_SIDEBAR_WIDTH,
  SPLIT_ISSUE_MIN_WIDTH,
  chatMainMinWidth,
  dockFlexGridColumns,
  paneHasSidebarInset,
} from "../muse/layout";
import { useDesktopSidebarCollapsed } from "../hooks/useDesktopSidebarCollapsed";
import { useDesktopSessionListWidth } from "../hooks/useDesktopSidebarWidth";
import "../styles/WelcomeView.css";
import type { ChatAppProps, DesktopPanelKind } from "../types";
import { chatReducer, initialState } from "../reducers/chatReducer";
import { usePaneUi } from "../stores";
import { useBotIssueBoard } from "../hooks/useBotIssueBoard";
import { useHostStartupEffects } from "../hooks/useHostStartupEffects";
import { useChatFrame } from "../hooks/useChatFrame";
import { useChatDock } from "../hooks/useChatDock";
import { useIssueSessionChrome } from "../hooks/useIssueSessionChrome";
import { usePanelGroupWriters } from "../hooks/usePanelGroupWriters";
import { useChatAppCore } from "../hooks/useChatAppCore";
import { useChatSend } from "../hooks/useChatSend";
import { usePanels } from "../hooks/usePanels";
import { useFilePanel } from "../hooks/useFilePanel";
import { usePreview } from "../hooks/usePreview";
import { useRewind } from "../hooks/useRewind";
import { useDialogs } from "../hooks/useDialogs";
import { useAssistantDockColumn } from "../hooks/useAssistantDockColumn";
import { useBotDockTools } from "../hooks/useBotDockTools";
import { useDockSurface } from "../hooks/useDockSurface";
import { useSessionsPageSession } from "../hooks/useSessionsPageSession";
import { useShownFileTabs } from "../hooks/useShownFileTabs";
import { useIssueTranscript } from "../hooks/useIssueTranscript";
import "../styles/ChatApp.css";

export { prunePanelGroupCache } from "../stores";


/** 主内容区视图：chat 需要结合当前会话（state.currentSession）渲染。 */
export type MainView = "newChat" | "chat" | "automations" | "skills" | "assistant";

type ChatAppInnerProps = ChatAppProps & {
  workspace: BotWorkspaceContextValue;
};

export const ChatApp: React.FC<ChatAppProps> = (props) => {
  const providedWorkspace = useBotWorkspace();
  if (providedWorkspace) {
    return <ChatAppInner {...props} workspace={providedWorkspace} />;
  }
  return <ChatAppWorkspaceOwner {...props} />;
};

/** 没有 provider 时只在这个子组件里挂 controller，避免和已有 context 同时调用。 */
const ChatAppWorkspaceOwner: React.FC<ChatAppProps> = (props) => {
  const issueIds = useMemo(
    () => props.host?.issueGroups?.map((group) => group.issueId),
    [props.host?.issueGroups],
  );
  const ownedWorkspace = useBotWorkspaceController(
    props.host?.issueGroups?.[0]?.issueId ?? null,
    issueIds,
  );
  return <ChatAppInner {...props} workspace={ownedWorkspace} />;
};

const ChatAppInner: React.FC<ChatAppInnerProps> = ({
  vscode,
  host,
  paneId,
  workspace,
}) => {
  const museApi = useMemo(
    () => new MuseApiClient({ baseUrl: resolveMuseServerUrl() }),
    [],
  );
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
    | {
        worktreeBranch?: string;
        worktreeName?: string;
        baseBranch?: string;
      }
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
  // 无窗格桌面就是单栏布局：图标栏默认落在 Muse Bot。有窗格时由 DesktopShell 管。
  const noPaneDesktop =
    host?.type === "desktop" &&
    paneId === undefined &&
    (host.panes?.length ?? 0) === 0;
  // 主内容区视图：聊天 / 新会话页 / 自动化 / Muse Bot。
  const [view, setView] = useState<MainView>(noPaneDesktop ? "assistant" : "chat");
  // 图标选中态不跟会话推送走。助理面上的会话推送也不能把视图拉回普通聊天。
  const [noPaneRail, setNoPaneRail] = useState<ShellSurface>("assistant");
  const settingsPageRef = useRef<ConfigDialogHandle>(null);
  useLayoutEffect(() => {
    if (!noPaneDesktop) return;
    return registerDesktopSettingsOpener(() => {
      setNoPaneRail("settings");
    });
  }, [noPaneDesktop]);
  const shellSurface = useShellSurface();
  const providedShellSurface = useProvidedShellSurface();
  const issueTitles: Record<string, string> = {};
  for (const group of host?.issueGroups ?? []) {
    issueTitles[group.issueId] = group.title;
  }
  const [assistantWorkdir, setAssistantWorkdir] = useState<string | undefined>();
  const assistantVisible =
    host?.type === "desktop" &&
    (paneId !== undefined
      ? providedShellSurface === "assistant" &&
        (host.focusedPaneId ?? paneId) === paneId
      : (host.panes?.length ?? 0) === 0 &&
        view === "assistant" &&
        noPaneRail === "assistant");
  const [botComposerFocused, setBotComposerFocused] = useState(false);
  // 分栏时 Muse Bot 标签被锁住，进不了主页。左侧输入框聚焦才算回到这条会话。
  useAssistantHomeVisible(
    assistantVisible && (workspace.active === "bot" || botComposerFocused),
  );
  useEffect(() => {
    if (!assistantVisible) return;
    let cancelled = false;
    void museApi
      .getAssistantSession()
      .then((info) => {
        if (cancelled) return;
        if (info.workdir) setAssistantWorkdir(info.workdir);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [assistantVisible, museApi]);
  const botListsWide = useBotListsWide();
  const board = useBotIssueBoard({
    assistantVisible,
    museApi,
    host,
    workspace,
    state,
  });
  const {
    botSwitchHost,
    setBotSwitchHost,
    botMenu,
    setBotMenu,
    botQueue,
    botIssues,
    issueTabPresence,
    clearIssueUnreadRef,
    selectBotPanel,
    setThreeColumnsOn,
    splitLeftWidth,
    setSplitLeftWidth,
    threeColumns,
    shownIssueGroup,
    focusShownIssueFromSender,
  } = board;

  const surface = useDockSurface({
    assistantVisible,
    workspace,
    host,
    paneId,
    providedShellSurface,
    noPaneRail,
    currentSession: state.currentSession,
    effectiveWorkdir,
    assistantWorkdir,
    shownIssueGroup,
    vscode,
    view,
    isDraftSession,
  });
  const {
    dockIssueId,
    dockIssueGroup,
    onSessionsSurface,
    dockWorkdir,
    panelWorkdir,
    followIssueTools,
    groupKey,
    groupKeyRef,
    assistantVisibleRef,
    onSessionsSurfaceRef,
    dockWorkdirRef,
    dockIssueIdRef,
    shownIssueIdRef,
    vscodeRef,
    previewGroupKeyRef,
    fileContentGroupKeyRef,
    checkedPanels,
    mountedPanels,
    activePanel,
    dockFullscreen,
    previewUrl,
    diffView,
    fileSidebarMode,
    previewTitle,
    assistantTools,
    assistantActiveToolId,
    dockTabOrder,
    chromeChecked,
    chromeActive,
    slotCheckedWithFile,
    slotMountedWithFile,
    assistantWidths,
    shownWidths,
    shownFileTabs,
    shownActiveFilePath,
    shownFileTree,
    shownContentSearch,
    shownPreviewUrl,
    shownForward,
    shownForwardError,
    shownPreviewEpoch,
    fileView,
    selectDockRef,
    dockChromeRef,
  } = surface;
  const {
    previewUrlRef,
    chatContainerRef,
    chatColumnWidth,
    leftPanelWidth,
    quickOpenOpen,
    setQuickOpenOpen,
    quickOpenQuery,
    setQuickOpenQuery,
    showNewIssue,
    setShowNewIssue,
    planningIssueId,
    setPlanningIssueId,
    togglePanelRef,
    toggleFullscreenRef,
    messageInputRef,
    assistantInputRef,
    messageListRef,
    stateRef,
    paneIdRef,
    hostRef,
  } = useChatFrame({
    previewUrl,
    assistantVisible,
    assistantTools,
    assistantActiveToolId,
    shownPreviewUrl,
    paneId,
    host,
    view,
    shellSurface,
    state,
    dispatch,
    vscode,
    groupKeyRef,
    previewGroupKeyRef,
    fileContentGroupKeyRef,
    noPaneDesktop,
    noPaneRail,
    setView,
    providedShellSurface,
    museApi,
  });


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
  const {
    openIssueViewTab,
    setIssueTabChoice,
    openIssueSessionId,
    issueSessionActive,
    issueLoading,
    shownIssueMessages,
    issueShowWelcome,
    issueStreaming,
    loadOlderIssueMessages,
  } = useIssueTranscript({
    shownIssueGroup,
    assistantVisible,
    host,
    currentSessionId: state.currentSession?.id,
    messages: state.messages,
    isStreaming: state.isStreaming,
    postToHost,
  });
  // 焦点不在左侧事项或右侧面板时，⌘W 关闭窗口。侧栏里关不掉的页（Muse Bot、详情）不再连带关窗口。
  useEffect(() => {
    if (paneId !== undefined) return;
    return registerUnfocusedClose(() => {
      postToHost({ command: "desktopCloseWindow" });
    });
  }, [paneId, postToHost]);
  useSessionsPageSession({
    hostRef,
    currentSession: state.currentSession,
    onSessionsSurface,
    paneId,
    dispatch,
    postToHost,
    assistantVisible,
    workspaceActive: workspace.active,
    openIssueSessionId,
  });
  useHostStartupEffects({
    postToHost,
    host,
    workspaceActive: workspace.active,
    clearIssueUnreadRef,
    queueEditWarning,
    patchPane,
    effectiveWorkdir,
  });
  const { updatePreviewGroup, updateFileGroup, resolveFileGroupKey } =
    usePanelGroupWriters({
      assistantVisibleRef,
      previewGroupKeyRef,
      shownIssueIdRef,
      dockIssueIdRef,
    });

  const issueSendSessionRef = useRef<string | undefined>(undefined);
  issueSendSessionRef.current =
    assistantVisible && openIssueSessionId ? openIssueSessionId : undefined;

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
    pinnedSessionIdRef: issueSendSessionRef,
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

  const sidebarWidth = DESKTOP_SIDEBAR_WIDTH;
  const { collapsed: sidebarCollapsed } = useDesktopSidebarCollapsed();
  const { width: sessionListWidth, setWidth: setSessionListWidth } =
    useDesktopSessionListWidth();
  const layoutSidebarWidth = sidebarWidth;
  const sessionListInset =
    noPaneDesktop && noPaneRail === "sessions" && !sidebarCollapsed
      ? sessionListWidth
      : 0;
  const contentInset = layoutSidebarWidth + sessionListInset;
  const sidebarInset =
    !dockFullscreen && !sidebarCollapsed && paneHasSidebarInset(host?.panes, paneId);
  const chatMinWidth = chatMainMinWidth(sidebarInset, contentInset);
  // Three columns keep the Muse Bot floor and still leave the issue column
  // its own floor, so the dock cannot eat the left side down to one column.
  const layoutChatMin = threeColumns
    ? chatMinWidth + SPLIT_ISSUE_MIN_WIDTH
    : chatMinWidth;
  const dockMaxWidth = chatColumnWidth - layoutChatMin;
  const {
    assistantDockOpen,
    setAssistantDockOpen,
    chatPaneWidth,
    assistantDockToggleRef,
    restoreAssistantToolsRef,
    updateMuseWidthGroup,
    assistantView,
    onAssistantViewMode,
    toggleAssistantDock,
    pinChatPaneAfterDrag,
    handleToggleDockRef,
  } = useAssistantDockColumn({
    assistantVisible,
    dockIssueId,
    dockWorkdir,
    checkedPanels,
    assistantWidths,
    chatColumnWidth,
    chatContainerRef,
    layoutChatMin,
    dockMaxWidth,
    dockFullscreen,
    workspaceActive: workspace.active,
  });
  const {
    beforeToggleRef,
    panelShortcutRef,
    placeKindRef,
    placeForwardRef,
    focusOrOpenBotPreviewRef,
    tryOpenPanelRef,
    tryOpenForPreview,
    handleAddPanelRef,
    openBotTerminal,
    openBotPreview,
    focusBotTool,
    closeBotTool,
    readAssistantTools,
  } = useBotDockTools({
    assistantVisible,
    workspace,
    chromeChecked,
    activePanel,
    shownFileTabs,
    shownActiveFilePath,
    assistantActiveToolId,
    assistantTools,
    slotCheckedWithFile,
    groupKey,
    selectDockRef,
    dockWorkdirRef,
    vscodeRef,
    dockChromeRef,
    assistantVisibleRef,
    dockIssueIdRef,
    onSessionsSurface,
    groupKeyRef,
    setAssistantDockOpen,
  });
  const panels = usePanels({
    postToHost,
    updatePanelGroup,
    updateWidthGroup: followIssueTools ? updateMuseWidthGroup : undefined,
    groupKey,
    forwardGroupKeyRef: previewGroupKeyRef,
    panelWorkdir,
    chatContainerRef,
    togglePanelRef,
    toggleFullscreenRef,
    dockToggleHandlerRef: assistantDockToggleRef,
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
    panelWidths: shownWidths,
    dockMaxWidth,
    chatMinWidth: layoutChatMin,
    hideDiff: assistantVisible && !dockIssueId,
    previewWithoutWorkdir: assistantVisible,
    beforeToggleRef,
    panelShortcutRef,
    placeForwardRef,
    placeKindRef,
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
  const handleDockWidthChangeAndPin = useCallback(
    (width: number) => {
      handleDockWidthChange(width);
      pinChatPaneAfterDrag(width);
    },
    [handleDockWidthChange, pinChatPaneAfterDrag],
  );
  // Live dock width while a splitter drags. The assistant frame sizes the dock
  // from its own grid, so the drag writes that grid (and the dock's
  // --dock-width, used by the flex chat layout) straight to the DOM. The width
  // reaches the store once, from handleDockWidthChangeAndPin on release.
  const previewDockWidth = useCallback(
    (width: number) => {
      const frame = chatContainerRef.current;
      if (!frame) return;
      frame
        .querySelector<HTMLElement>(".desktop-panel-dock")
        ?.style.setProperty("--dock-width", `${width}px`);
      if (assistantDockOpen && !dockFullscreen && chatColumnWidth > 0) {
        frame.style.gridTemplateColumns = dockFlexGridColumns(
          Math.max(0, chatColumnWidth - width),
          chatMinWidth,
        );
      }
    },
    [assistantDockOpen, dockFullscreen, chatColumnWidth, chatMinWidth],
  );
  handleToggleDockRef.current = handleToggleDock;
  handleAddPanelRef.current = handleAddPanel;
  tryOpenPanelRef.current = tryOpenPanel;
  assistantDockToggleRef.current = assistantVisible ? toggleAssistantDock : null;
  const preview = usePreview({
    updatePanelGroup: updatePreviewGroup,
    tryOpenPanel: tryOpenForPreview,
    acquireForward,
    effectiveHost,
    currentForward: shownForward,
    previewForwardError: shownForwardError,
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
    api: museApi,
    currentSession: state.currentSession,
    effectiveHost,
    effectiveWorkdir: followIssueTools ? dockWorkdir : effectiveWorkdir,
    groupKey,
    contentSearch: shownContentSearch,
    updateListingGroup: updatePreviewGroup,
    updateFileGroup,
    resolveFileGroupKey,
  });
  const {
    handleOpenFile: openFileTabInGroup,
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
  const {
    revealOpenedFile,
    handleOpenFile,
    openMessageFile,
    openIssueMessageFile,
    openFileHistoryDiff,
    selectShownFileTab,
    closeShownFileTab,
    pinShownFileTab,
  } = useShownFileTabs({
    assistantVisibleRef,
    onSessionsSurfaceRef,
    previewGroupKeyRef,
    groupKeyRef,
    shownIssueIdRef,
    dockIssueIdRef,
    dockWorkdirRef,
    selectDockRef,
    setAssistantDockOpen,
    onSessionsSurface,
    tryOpenPanel,
    openFileTabInGroup,
    handleOpenFileHistoryDiff,
    handleSelectFileTab,
    handleCloseFileTab,
    handlePinFileTab,
    postToHost,
    effectiveHost,
  });

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

  // Cmd+N 是窗口菜单，到不了页面。无窗格时由这里切到会话并打开草稿。
  useLayoutEffect(() => {
    if (!noPaneDesktop) return;
    return registerDesktopNewSessionOpener(() => {
      setNoPaneRail("sessions");
      setView("chat");
      handleDesktopNewSession();
    });
  }, [noPaneDesktop, handleDesktopNewSession]);
  // 有窗格时壳切到会话，聚焦的那一格在同一帧放上草稿，避免被记下的旧会话拉回去。
  useEffect(() => {
    if (paneId === undefined) return;
    return subscribeFocusedPaneNewSession(() => {
      const hostNow = hostRef.current;
      const focused = hostNow?.focusedPaneId ?? hostNow?.panes?.[0]?.paneId;
      if (focused && focused !== paneId) return;
      setView("chat");
      dispatch({
        type: "SET_CURRENT_SESSION",
        payload: draftSessionMetadata(),
      });
    });
  }, [paneId, dispatch]);

  const sessionDefaultModel = useScenarioModelsStore(
    (s) => s.models?.session,
  );

  const currentSessionModel = (
    state.currentSession as { model?: string } | undefined
  )?.model;
  const resolvedModelId = isDraftSession
    ? resolveDraftModel(currentSessionModel, sessionDefaultModel)
    : currentSessionModel;

  // Initialize webview and load sessions on component mount
  useEffect(() => {
    dispatch({ type: "SET_SESSIONS_LOADING", payload: true });
    vscode.postMessage({
      command: "webviewReady",
    });
  }, [vscode]);

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
  const {
    recentDiffFiles,
    issueRecentDiffFiles,
    activeIssueGroup,
    issueClosed,
    issueViewTab,
    handleIssueTabChange,
    handleSelectIssue,
  } = useIssueSessionChrome({
    state,
    host,
    effectiveWorkdir,
    dockWorkdir,
    dockIssueGroup,
    assistantVisible,
    shownIssueGroup,
    openIssueSessionId,
    shownIssueMessages,
    setIssueTabChoice,
    paneIssueViewTab: paneUi.issueViewTab,
    patchPane,
  });


  const {
    showIssueChrome,
    issueSessionHeader,
    sendIssueMessage,
    composer,
  } = useIssueComposer({
    activeIssueGroup,
    issueViewTab,
    handleIssueTabChange,
    shownIssueGroup,
    assistantVisible,
    openIssueViewTab,
    setIssueTabChoice,
    issueSendSessionRef,
    handleSendMessage,
    messageInputRef,
    issueStreaming,
    state,
    handleAbortMessage,
    handleSubmitQueuedEdit,
    handleCancelQueuedEdit,
    handleInputCleared,
    vscode,
    host,
    isDraftSession,
    effectiveHost,
    effectiveWorkdir,
    panelWorkdir,
    gitBranches,
    worktreeBranch,
    worktreeChecked,
    patchPane,
    resolvedModelId,
    handleSessionModelChange,
    rewindPopupOpen,
    rewindCheckpointsLoading,
    rewindCheckpoints,
    handleRewindCheckpointSelect,
    handleRewindPopupClose,
    modelPopupOpen,
    modelLoading,
    configuredModels,
    currentModel,
    handleModelSelect,
    handleModelPopupClose,
    issueClosed,
  });


  // One assembly for the 4 return branches (desktop shell / pane / layout / web).
  const dialogProps = buildChatDialogProps({
    state,
    vscode,
    host,
    effectiveWorkdir,
    patchPane,
    handleConfigurationSave,
    handleDialogClose,
    handleOpenFile,
    handleLogin,
    agentTranscript,
    handleCloseAgentTranscript,
    pendingRewindId,
    handleRewindConfirm,
    toasts,
    handleToastDismiss,
    handleToastAction,
    quickOpenOpen,
    quickOpenQuery,
    setQuickOpenOpen,
    setQuickOpenQuery,
    selectBotPanel,
  });


  const dock = useChatDock({
    surface,
    board,
    workspace,
    host,
    panelDisabled,
    dockMaxWidth,
    assistantVisible,
    recentDiffFiles,
    issueRecentDiffFiles,
    state,
    effectiveWorkdir,
    sessionBaseBranch: sessionGitMeta?.baseBranch,
    paneId,
    vscode,
    postToHost,
    openBotTerminal,
    openBotPreview,
    focusBotTool,
    closeBotTool,
    handleAddPanel,
    handleSelectPanel,
    handleTogglePanel,
    handleToggleDock,
    toggleAssistantDock,
    handleToggleFullscreen,
    handleDockWidthChangeAndPin,
    onWidthPreview: previewDockWidth,
    handlePreviewNavigate,
    handleRemotePreviewRetry,
    handleAddComment,
    acquireForward,
    updatePreviewGroup,
    restoreAssistantToolsRef,
    setAssistantDockOpen,
    handleOpenFile,
    handleOpenFilePin,
    revealOpenedFile,
    handleRefreshOpenFile,
    sendIssueMessage,
    selectShownFileTab,
    closeShownFileTab,
    pinShownFileTab,
    botComposerFocused,
    assistantInputRef,
    messageInputRef,
    handleFileTreeChange,
    handleFileSidebarModeChange,
    handleContentSearchChange,
    handleOpenLocalFilePreview,
    handleRevealInFinder,
    openPreviewHandler,
  });


  // Cards follow the pane left of the dock, not the window. matchMedia is
  // only the fallback when that pane has not been measured (jsdom).
  const assistantFrame = (
    <AssistantFrame
      leftPanelWidth={leftPanelWidth}
      botListsWide={botListsWide}
      workspace={workspace}
      assistantVisible={assistantVisible}
      dockFullscreen={dockFullscreen}
      assistantView={assistantView}
      board={board}
      setAssistantDockOpen={setAssistantDockOpen}
      openIssueViewTab={openIssueViewTab}
      setIssueTabChoice={setIssueTabChoice}
      assistantDockOpen={assistantDockOpen}
      toggleAssistantDock={toggleAssistantDock}
      chatPaneWidth={chatPaneWidth}
      chatContainerRef={chatContainerRef}
      layoutChatMin={layoutChatMin}
      chatMinWidth={chatMinWidth}
      issueTitles={issueTitles}
      museApi={museApi}
      vscode={vscode}
      assistantInputRef={assistantInputRef}
      messageInputRef={messageInputRef}
      onAssistantViewMode={onAssistantViewMode}
      openMessageFile={openMessageFile}
      openIssueMessageFile={openIssueMessageFile}
      handleOpenPreview={handleOpenPreview}
      host={host}
      setBotComposerFocused={setBotComposerFocused}
      issueShowWelcome={issueShowWelcome}
      shownIssueMessages={shownIssueMessages}
      state={state}
      handleLogin={handleLogin}
      issueLoading={issueLoading}
      issueStreaming={issueStreaming}
      handleRewindToMessage={handleRewindToMessage}
      dockWorkdir={dockWorkdir}
      handleOpenAgentTranscript={handleOpenAgentTranscript}
      loadOlderIssueMessages={loadOlderIssueMessages}
      handleRevertFileHistory={handleRevertFileHistory}
      revertingFileHistory={revertingFileHistory}
      openFileHistoryDiff={openFileHistoryDiff}
      postToHost={postToHost}
      dispatch={dispatch}
      handleEditQueuedMessage={handleEditQueuedMessage}
      handleDeleteQueuedMessage={handleDeleteQueuedMessage}
      handleConfirmation={handleConfirmation}
      handleRejection={handleRejection}
      composer={composer}
      dock={dock}
    />
  );


  const chatContainer = (
    <ChatSessionColumn
      state={state}
      chatContainerRef={chatContainerRef}
      queueEditWarning={queueEditWarning}
      patchPane={patchPane}
      view={view}
      postToHost={postToHost}
      effectiveWorkdir={effectiveWorkdir}
      dock={dock}
      vscode={vscode}
      handleClearChat={handleClearChat}
      handleAbortMessage={handleAbortMessage}
      messageInputRef={messageInputRef}
      handleOpenSettings={handleOpenSettings}
      handleLogin={handleLogin}
      handleLogout={handleLogout}
      dispatch={dispatch}
      gitBranches={gitBranches}
      isDraftSession={isDraftSession}
      checkedPanels={checkedPanels}
      handleToggleDock={handleToggleDock}
      handleRewindToMessage={handleRewindToMessage}
      openPreviewHandler={openPreviewHandler}
      openMessageFile={openMessageFile}
      handleOpenAgentTranscript={handleOpenAgentTranscript}
      handleRevertFileHistory={handleRevertFileHistory}
      revertingFileHistory={revertingFileHistory}
      openFileHistoryDiff={openFileHistoryDiff}
      handleEditQueuedMessage={handleEditQueuedMessage}
      handleDeleteQueuedMessage={handleDeleteQueuedMessage}
      handleConfirmation={handleConfirmation}
      handleRejection={handleRejection}
      composer={composer}
      issueSessionHeader={issueSessionHeader}
      showIssueChrome={showIssueChrome}
    />
  );


  if (host?.type === "desktop") {
    return (
      <DesktopChatLayout
        host={host}
        paneId={paneId}
        vscode={vscode}
        workspace={workspace}
        state={state}
        museApi={museApi}
        postToHost={postToHost}
        dialogProps={dialogProps}
        assistantFrame={assistantFrame}
        chatContainer={chatContainer}
        providedShellSurface={providedShellSurface}
        view={view}
        setView={setView}
        noPaneRail={noPaneRail}
        setNoPaneRail={setNoPaneRail}
        settingsPageRef={settingsPageRef}
        showNewIssue={showNewIssue}
        setShowNewIssue={setShowNewIssue}
        planningIssueId={planningIssueId}
        setPlanningIssueId={setPlanningIssueId}
        handleSelectIssue={handleSelectIssue}
        handleLogin={handleLogin}
        handleConfigurationSave={handleConfigurationSave}
        handleDesktopNewSession={handleDesktopNewSession}
        handleDesktopNewSessionInWorkdir={handleDesktopNewSessionInWorkdir}
        sidebarCollapsed={sidebarCollapsed}
        contentInset={contentInset}
        sidebarWidth={sidebarWidth}
        sessionListWidth={sessionListWidth}
        setSessionListWidth={setSessionListWidth}
      />
    );
  }


  return (
    <>
      {chatContainer}
      <ChatDialogs {...dialogProps} />
    </>
  );
};
