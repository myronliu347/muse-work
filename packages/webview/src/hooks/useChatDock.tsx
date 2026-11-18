import { useMemo } from "react";
import type React from "react";
import type { DockSurface } from "./useDockSurface";
import type { BotIssueBoard } from "./useBotIssueBoard";
import { DockDetail } from "../components/desktop/DockDetail";
import type { BotWorkspaceContextValue } from "../components/desktop/BotTabs";
import type { BotListIssue, BotListQueueItem } from "../components/desktop/BotLists";
import { issueTabSessionId, sessionActionLabel } from "../components/desktop/botWorkspace";
import type { DesktopPanelSlotsProps } from "../components/desktop/DesktopPanelSlots";
import type { MessageInputHandle } from "../components/chat/MessageInput";
import { DOCK_DETAIL_TAB } from "../muse/panelTabs";
import { patchDockTool } from "../muse/dockTools";
import { issueGroupSessionWorkdir } from "../utils/issueGroups";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  EMPTY_DOCK_TOOLS,
  emptyFileTreeState,
  usePanelGroupStore,
} from "../stores";
import type { IssuePresence } from "../components/session/SessionStatusGlyph";
import type {
  ChatState,
  DesktopHostProps,
  DesktopIssueGroup,
  DesktopIssueUpdate,
  DesktopPanelKind,
  DiffViewState,
  VsCodeApi,
} from "../types";

type ClosedIssueLike = {
  issueId: string;
  title: string;
  type?: string;
  priority: string;
  status: string;
  closeNote?: string;
  closedAt?: number;
  workdir?: string;
  baseBranch?: string;
};

function toDockClosedIssue(group: ClosedIssueLike) {
  const cancelled = group.status === "cancelled";
  const summary = group.closeNote
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const closedAt = group.closedAt;
  return {
    issueId: group.issueId,
    title: group.title,
    type: group.type,
    priority: group.priority,
    status: group.status,
    statusLabel: cancelled ? "已取消" : "已完成",
    ...(cancelled ? { cancelled: true } : {}),
    ...(closedAt !== undefined ? { closedAt } : {}),
    ...(group.closeNote ? { closeNote: group.closeNote } : {}),
    ...(group.workdir ? { workdir: group.workdir } : {}),
    ...(group.baseBranch ? { baseBranch: group.baseBranch } : {}),
    ...(summary && closedAt !== undefined
      ? { latestUpdate: { summary: summary.slice(0, 160), at: closedAt } }
      : {}),
  };
}

/**
 * Props for the right-hand dock. Muse Bot, the sessions page, and an issue
 * each contribute a different directory, file list, and chrome tab.
 */
export function useChatDock(input: {
  surface: DockSurface;
  board: BotIssueBoard;
  workspace: BotWorkspaceContextValue;
  host: DesktopHostProps | undefined;
  panelDisabled: DesktopPanelKind[];
  dockMaxWidth: number;
  assistantVisible: boolean;
  recentDiffFiles: DesktopPanelSlotsProps["recentFiles"];
  issueRecentDiffFiles: DesktopPanelSlotsProps["recentFiles"];
  state: ChatState;
  effectiveWorkdir: string | undefined;
  sessionBaseBranch: string | undefined;
  paneId: string | undefined;
  vscode: VsCodeApi;
  postToHost: (message: Record<string, unknown>) => void;
  openBotTerminal: (placeAtEnd?: boolean) => boolean;
  openBotPreview: (placeAtEnd?: boolean) => boolean;
  focusBotTool: (id: string) => void;
  closeBotTool: (id: string) => void;
  restartBotTerminal: (id: string) => void;
  handleAddPanel: (
    kind: DesktopPanelKind,
    options?: { placeAtEnd?: boolean },
  ) => void;
  handleSelectPanel: (kind: DesktopPanelKind) => void;
  handleTogglePanel: (kind: DesktopPanelKind) => void;
  handleToggleDock: () => void;
  toggleAssistantDock: () => void;
  handleToggleFullscreen: () => void;
  handleDockWidthChangeAndPin: (width: number) => void;
  /** Live dock width while the handle drags, before the commit. */
  onWidthPreview: (width: number) => void;
  handlePreviewNavigate: (url: string) => void;
  handleRemotePreviewRetry: () => void;
  handleAddComment: (text: string) => void;
  acquireForward: (host: string, url: string) => void;
  updatePreviewGroup: (patch: { previewUrl?: string; previewTitle?: string | null }) => void;
  restoreAssistantToolsRef: React.MutableRefObject<boolean>;
  setAssistantDockOpen: (open: boolean) => void;
  handleOpenFile: (path: string, startLine?: number, endLine?: number, pinned?: boolean) => void;
  handleOpenFilePin: (path: string) => void;
  openChangedFile: (path: string) => void;
  openArtifact: (path: string) => void;
  openArtifactInBrowser?: (path: string) => void;
  loadIssue?: (issueId: string) => Promise<{
    description?: string;
    items?: DesktopIssueGroup["items"];
  }>;
  loadClosedIssuePage?: (
    offset: number,
    limit: number,
  ) => Promise<{
    issues: Array<{
      issueId: string;
      title: string;
      type?: string;
      priority: string;
      status: string;
      closeNote?: string;
      closedAt?: number;
      workdir?: string;
      baseBranch?: string;
    }>;
    hasMore: boolean;
    total: number;
  }>;
  loadIssueUpdates?: (
    issueId: string,
    opts?: { limit?: number; before?: string },
  ) => Promise<{ updates: DesktopIssueUpdate[]; hasMore: boolean }>;
  completeIssue?: (issueId: string, note: string) => Promise<void>;
  cancelIssue?: (issueId: string, note: string) => Promise<void>;
  generateIssueSummary?: (issueId: string) => Promise<string>;
  revealOpenedFile: () => void;
  handleRefreshOpenFile: (path: string) => void;
  sendIssueMessage: (text: string) => void;
  selectShownFileTab: (path: string) => void;
  closeShownFileTab: (path: string) => void;
  pinShownFileTab: (path: string) => void;
  botComposerFocused: boolean;
  assistantInputRef: React.RefObject<MessageInputHandle>;
  messageInputRef: React.RefObject<MessageInputHandle>;
  handleFileTreeChange: DesktopPanelSlotsProps["onFileTreeChange"];
  handleFileSidebarModeChange: DesktopPanelSlotsProps["onFileSidebarModeChange"];
  handleContentSearchChange: DesktopPanelSlotsProps["onContentSearchChange"];
  handleOpenLocalFilePreview: (url: string) => void;
  handleRevealInFinder: (path: string) => void;
  openPreviewHandler: DesktopPanelSlotsProps["openPreviewHandler"];
}): DesktopPanelSlotsProps {
  const { surface, board, ...extras } = input;
  const {
    workspace,
    host,
    botQueue,
    botIssues,
    issueTabPresence,
    chromeChecked,
    chromeActive,
    activePanel,
    slotCheckedWithFile,
    slotMountedWithFile,
    panelDisabled,
    dockFullscreen,
    shownWidths,
    dockMaxWidth,
    assistantVisible,
    onSessionsSurface,
    dockIssueId,
    dockIssueGroup,
    groupKey,
    assistantTools,
    assistantActiveToolId,
    dockTabOrder,
    previewTitle,
    shownPreviewEpoch,
    shownPreviewUrl,
    shownForward,
    shownForwardError,
    diffView,
    recentDiffFiles,
    issueRecentDiffFiles,
    state,
    effectiveWorkdir,
    dockWorkdir,
    fileTreeWorkdir,
    revealFileTree,
    sessionBaseBranch,
    paneId,
    vscode,
    postToHost,
    selectBotPanel,
    openBotTerminal,
    openBotPreview,
    focusBotTool,
    closeBotTool,
    restartBotTerminal,
    handleAddPanel,
    handleSelectPanel,
    handleTogglePanel,
    handleToggleDock,
    toggleAssistantDock,
    handleToggleFullscreen,
    handleDockWidthChangeAndPin,
    onWidthPreview,
    handlePreviewNavigate,
    handleRemotePreviewRetry,
    handleAddComment,
    acquireForward,
    updatePreviewGroup,
    previewGroupKeyRef,
    restoreAssistantToolsRef,
    setAssistantDockOpen,
    handleOpenFile,
    handleOpenFilePin,
    openChangedFile,
    openArtifact,
    openArtifactInBrowser,
    loadIssue,
    loadClosedIssuePage,
    loadIssueUpdates,
    completeIssue,
    cancelIssue,
    generateIssueSummary,
    revealOpenedFile,
    handleRefreshOpenFile,
    sendIssueMessage,
    fileView,
    shownFileTabs,
    shownActiveFilePath,
    selectShownFileTab,
    closeShownFileTab,
    pinShownFileTab,
    botComposerFocused,
    assistantInputRef,
    messageInputRef,
    shownFileTree,
    handleFileTreeChange,
    fileSidebarMode,
    handleFileSidebarModeChange,
    shownContentSearch,
    handleContentSearchChange,
    handleOpenLocalFilePreview,
    handleRevealInFinder,
    openPreviewHandler,
  } = { ...extras, ...surface, ...board };
  const detailSelection = (() => {
    const panel = workspace.panel;
    if (panel.kind === "issue") {
      const found =
        (host?.issueGroups ?? []).find(
          (group) => group.issueId === panel.issueId,
        ) ??
        (host?.closedIssueGroups ?? []).find(
          (group) => group.issueId === panel.issueId,
        );
      return found
        ? { kind: "issue" as const, issue: found }
        : { kind: "none" as const };
    }
    if (panel.kind === "queue") {
      const found = botQueue.find((item) => item.id === panel.id);
      return found
        ? {
            kind: "queue" as const,
            typeLabel: found.kind,
            title: found.title,
            body: "",
          }
        : { kind: "none" as const };
    }
    return { kind: "none" as const };
  })();
  const detailPanel = workspace.panel;
  const detailIssueGroup =
    detailPanel.kind === "issue"
      ? ((host?.issueGroups ?? []).find(
          (group) => group.issueId === detailPanel.issueId,
        ) ??
        (host?.closedIssueGroups ?? []).find(
          (group) => group.issueId === detailPanel.issueId,
        ))
      : undefined;
  const detailActionLabel =
    detailIssueGroup && issueTabSessionId(detailIssueGroup)
      ? sessionActionLabel(workspace, detailIssueGroup.issueId)
      : null;
  const detailTitle =
    detailSelection.kind === "issue"
      ? detailSelection.issue.title
      : detailSelection.kind === "queue"
        ? detailSelection.title
        : undefined;
  const pendingPermissionIds = useMemo(
    () =>
      new Set(
        state.pendingConfirmations.map((confirmation) => confirmation.confirmationId),
      ),
    [state.pendingConfirmations],
  );
  const closedIssueGroups = host?.closedIssueGroups;
  const dockClosedIssues = useMemo(
    () => (closedIssueGroups ?? []).map(toDockClosedIssue),
    [closedIssueGroups],
  );
  const onLoadClosedIssues = useMemo(() => {
    if (!loadClosedIssuePage) return undefined;
    return async (offset: number, limit: number) => {
      const page = await loadClosedIssuePage(offset, limit);
      return {
        issues: page.issues.map(toDockClosedIssue),
        hasMore: page.hasMore,
        total: page.total,
      };
    };
  }, [loadClosedIssuePage]);

  // Shared dock payload: the 4 panel slots + dock chrome (rendered by
  // ChatContainer when a bound session is showing).
  // The highlighted kind and the visible pane follow the chrome tab.
  // The other group's active must not paint through when it differs.
  // Panes share workspace.dock, and an unfocused pane does not write it.
  // If that chrome kind is not in this pane's checked set, show this pane's
  // detail layer. Leave the shared chrome alone until this pane can write.
  const chromeKindMissing =
    workspace.dock !== DOCK_DETAIL_TAB &&
    !chromeChecked.includes(workspace.dock);
  const issueDiffView = useMemo<DiffViewState | null>(
    () => (dockIssueId ? { mode: "unstaged" } : null),
    [dockIssueId],
  );
  // 详情只属于 Muse Bot / Issue。会话页用自己目录里正在打开的那种面板，
  // 不因为这边停在详情就把那边也打开。
  const showIssueDetail = assistantVisible;
  const sessionChromeKind =
    workspace.dock !== DOCK_DETAIL_TAB && chromeChecked.includes(workspace.dock)
      ? workspace.dock
      : activePanel;
  const dock: DesktopPanelSlotsProps = {
    checked: slotCheckedWithFile,
    active: showIssueDetail
      ? workspace.dock === DOCK_DETAIL_TAB
        ? chromeActive
        : workspace.dock
      : sessionChromeKind,
    mounted: slotMountedWithFile,
    disabledPanels: panelDisabled,
    fullscreen: dockFullscreen,
    widths: shownWidths,
    dockMaxWidth,
    onSelect: (kind) => {
      if (showIssueDetail || onSessionsSurface) workspace.selectDock(kind);
      handleSelectPanel(kind);
    },
    onSelectDetail: showIssueDetail
      ? () => {
          workspace.selectDock(DOCK_DETAIL_TAB);
        }
      : undefined,
    detailTitle: showIssueDetail ? detailTitle : undefined,
    detailPresence:
      showIssueDetail && detailIssueGroup
        ? issueTabPresence[detailIssueGroup.issueId] ?? null
        : null,
    detailActive:
      showIssueDetail &&
      (workspace.dock === DOCK_DETAIL_TAB || chromeKindMissing),
    detail: showIssueDetail ? (
      <DockDetail
        selection={detailSelection}
        actionLabel={detailActionLabel}
        onOpenSession={workspace.openIssueSession}
        onOpenInEditor={(workdir) =>
          postToHost({ command: "desktopOpenInEditor", workdir })
        }
        onRevealInFinder={(workdir) =>
          postToHost({ command: "revealInFinder", path: workdir })
        }
        issues={botIssues.map((item) => ({
          issueId: item.issueId,
          title: item.title,
          type: item.type,
          priority: item.priority,
          ...(item.statusLabel ? { statusLabel: item.statusLabel } : {}),
          ...(item.latestUpdate ? { latestUpdate: item.latestUpdate } : {}),
          ...(item.unreadCount ? { unreadCount: item.unreadCount } : {}),
          presence: item.presence,
        }))}
        closedIssues={dockClosedIssues}
        onSelectIssue={(issueId) => selectBotPanel({ kind: "issue", issueId })}
        onLoadClosedIssues={onLoadClosedIssues}
        onLoadIssue={loadIssue}
        onOpenChangedFile={openChangedFile}
        onOpenArtifact={openArtifact}
        onOpenArtifactInBrowser={openArtifactInBrowser}
        onLoadUpdates={loadIssueUpdates}
        pendingPermissionIds={pendingPermissionIds}
        currentSessionId={state.currentSession?.id}
        onCompleteIssue={completeIssue}
        onCancelIssue={cancelIssue}
        onGenerateSummary={generateIssueSummary}
      />
    ) : undefined,
    onCloseTab: handleTogglePanel,
    onAddPanel: (kind, options) => {
      if (assistantVisible && kind === "terminal") {
        openBotTerminal(options?.placeAtEnd);
        return;
      }
      if (assistantVisible && kind === "preview") {
        openBotPreview(options?.placeAtEnd);
        return;
      }
      if (kind === "file") {
        if (assistantVisible) {
          revealFileTree();
        } else if (groupKey) {
          // Session dock: same browser mode, but its tree lives on the
          // session/workdir group.
          usePanelGroupStore.getState().patchGroup(groupKey, (group) => ({
            fileTree: {
              ...(group.fileTree ?? emptyFileTreeState()),
              collapsed: false,
            },
            activeFilePath: null,
            active: "file",
          }));
        }
        workspace.selectDock("file");
        handleAddPanel(kind, options);
        return;
      }
      handleAddPanel(kind, options);
      if (assistantVisible) workspace.selectDock(kind);
      if (!onSessionsSurface || !groupKey) return;
      const opened = usePanelGroupStore.getState().groups[groupKey];
      if (opened?.checked.includes(kind)) workspace.selectDock(kind);
    },
    tools: assistantVisible ? assistantTools : EMPTY_DOCK_TOOLS,
    activeToolId: assistantActiveToolId,
    onSelectTool: focusBotTool,
    onCloseTool: closeBotTool,
    onRestartTool: restartBotTerminal,
    tabOrder: dockTabOrder,
    onTabOrderChange: (order) => {
      const key = assistantVisible ? ASSISTANT_PANEL_GROUP_KEY : groupKey;
      if (!key) return;
      usePanelGroupStore.getState().patchGroup(key, { tabOrder: order });
    },
    onToolPreviewNavigate: (id, url) => {
      focusBotTool(id);
      handlePreviewNavigate(url);
    },
    onPreviewLocationChange: (url) => {
      updatePreviewGroup({ previewUrl: url });
    },
    onPreviewTitleChange: (title) => {
      const next = title || null;
      const key = previewGroupKeyRef.current;
      if (!key) return;
      const current = usePanelGroupStore.getState().groups[key]?.previewTitle ?? null;
      if (current === next) return;
      updatePreviewGroup({ previewTitle: next });
    },
    previewLabel: previewTitle?.trim() || undefined,
    onToolPreviewLocationChange: (id, url) => {
      const store = usePanelGroupStore.getState();
      const tools = store.groups[ASSISTANT_PANEL_GROUP_KEY]?.tools ?? [];
      if (!tools.some((tool) => tool.id === id)) return;
      store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
        tools: patchDockTool(tools, id, { previewUrl: url }),
      });
    },
    onToolPreviewTitle: (id, title) => {
      const store = usePanelGroupStore.getState();
      const tools = store.groups[ASSISTANT_PANEL_GROUP_KEY]?.tools ?? [];
      const tool = tools.find((item) => item.id === id);
      if (!tool || (tool.pageTitle ?? null) === (title || null)) return;
      store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
        tools: patchDockTool(tools, id, { pageTitle: title || null }),
      });
    },
    onToolPreviewRetry: (id) => {
      const tool = assistantTools.find((item) => item.id === id);
      if (!tool?.forward) return;
      focusBotTool(id);
      acquireForward(tool.forward.host, tool.forward.originalUrl);
    },
    onToggleDock: assistantVisible ? toggleAssistantDock : handleToggleDock,
    onCloseDock: () => {
      if (assistantVisible) {
        restoreAssistantToolsRef.current = false;
        setAssistantDockOpen(false);
        return;
      }
      const group = groupKey
        ? usePanelGroupStore.getState().groups[groupKey]
        : undefined;
      if ((group?.checked.length ?? 0) > 0) handleToggleDock();
    },
    onToggleFullscreen: handleToggleFullscreen,
    onWidthChange: handleDockWidthChangeAndPin,
    onWidthPreview,
    vscode,
    paneId,
    isStreaming: state.isStreaming,
    sessionId: dockIssueId
      ? dockIssueGroup
        ? issueTabSessionId(dockIssueGroup)
        : undefined
      : state.currentSession?.id,
    workdir: (assistantVisible || onSessionsSurface ? dockWorkdir : effectiveWorkdir) || undefined,
    fileWorkdir: fileTreeWorkdir ?? undefined,
    baseBranch:
      dockIssueId || assistantVisible ? undefined : sessionBaseBranch,
    homeDir: host?.homeDir,
    previewEpoch: shownPreviewEpoch,
    previewUrl: shownPreviewUrl,
    currentForward: shownForward,
    previewForwardError: shownForwardError,
    onRemotePreviewRetry: handleRemotePreviewRetry,
    onPreviewNavigate: handlePreviewNavigate,
    onAddComment: handleAddComment,
    diffView:
      dockIssueId && diffView?.mode !== "recent" ? issueDiffView : diffView,
    recentFiles: dockIssueId ? issueRecentDiffFiles : recentDiffFiles,
    issues: assistantVisible
      ? (host?.issueGroups ?? []).map((group) => ({
          id: group.issueId,
          title: group.title,
          workdir: issueGroupSessionWorkdir(
            group,
            issueTabSessionId(group) ?? "",
            host?.workdir,
          ),
        }))
      : undefined,
    issueId: assistantVisible ? dockIssueId ?? undefined : undefined,
    onSelectIssue: assistantVisible
      ? (issueId: string) => {
          const group = (host?.issueGroups ?? []).find(
            (item) => item.issueId === issueId,
          );
          const nextWorkdir = group
            ? issueGroupSessionWorkdir(
                group,
                issueTabSessionId(group) ?? "",
                host?.workdir,
              )
            : undefined;
          if (nextWorkdir) {
            const store = usePanelGroupStore.getState();
            const existing = store.groups[ASSISTANT_PANEL_GROUP_KEY];
            const checked = existing?.checked ?? [];
            const mounted = existing?.mounted ?? [];
            // Keep 变更 available for the new issue, but do not pull the
            // visible tab there: switching the issue must not steal the tab
            // the user is reading (文件 / 详情 / 终端 ...).
            store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
              checked: checked.includes("diff") ? checked : [...checked, "diff"],
              mounted: mounted.includes("diff") ? mounted : [...mounted, "diff"],
            });
          }
          selectBotPanel({ kind: "issue", issueId });
        }
      : undefined,
    onOpenFile: (
      path: string,
      startLine?: number,
      endLine?: number,
      pinned?: boolean,
    ) => {
      handleOpenFile(path, startLine, endLine, pinned);
      // Browser mode keeps activeFilePath null; a tree/link click must also
      // select the tab in the group the dock is showing, not just write it.
      selectShownFileTab(path);
    },
    onOpenFilePinned: (path) => {
      handleOpenFilePin(path);
      revealOpenedFile();
      selectShownFileTab(path);
    },
    onRefreshOpenFile: handleRefreshOpenFile,
    onSendMessage: (text) => sendIssueMessage(text),
    fileView,
    fileTabs: shownFileTabs,
    activeFilePath: shownActiveFilePath,
    onSelectFileTab: (path) => {
      if (showIssueDetail || onSessionsSurface) workspace.selectDock("file");
      selectShownFileTab(path);
    },
    onCloseFileTab: closeShownFileTab,
    onPinFileTab: pinShownFileTab,
    onAddFileToChat: (path) => {
      const input = botComposerFocused
        ? assistantInputRef.current ?? messageInputRef.current
        : messageInputRef.current ?? assistantInputRef.current;
      input?.insertFile(path);
    },
    onAddSelectionToChat: (selection) => {
      const input = botComposerFocused
        ? assistantInputRef.current ?? messageInputRef.current
        : messageInputRef.current ?? assistantInputRef.current;
      input?.insertSelection(selection);
    },
    fileTree: shownFileTree,
    onFileTreeChange: handleFileTreeChange,
    fileSidebarMode,
    onFileSidebarModeChange: handleFileSidebarModeChange,
    contentSearch: shownContentSearch,
    onContentSearchChange: handleContentSearchChange,
    onOpenInPreview: handleOpenLocalFilePreview,
    onRevealInFinder: handleRevealInFinder,
    openPreviewHandler,
  };

  return dock;
}
