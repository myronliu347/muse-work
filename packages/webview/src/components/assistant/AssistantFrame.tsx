import type React from "react";
import { AssistantPage } from "./AssistantPage";
import {
  BOT_MESSAGE_COLUMN_MAX,
  botListsColumnWidth,
  botListsWideForPanel,
  BotLists,
  type BotListIssue,
  type BotListQueueItem,
} from "../desktop/BotLists";
import { BotTabs } from "../desktop/BotTabs";
import type { BotWorkspaceContextValue } from "../desktop/BotTabs";
import { DesktopPanelSlots, type DesktopPanelSlotsProps } from "../desktop/DesktopPanelSlots";
import type { PanelSelection } from "../desktop/botWorkspace";
import { ChatBody } from "../chat/ChatBody";
import type { MessageInputHandle } from "../chat/MessageInput";
import { IssueSessionHeader, type IssueViewTab } from "../issue/IssueSessionHeader";
import { PanelToggleControl } from "../panels/PanelToggleControl";
import { type IssuePresence } from "../session/SessionStatusGlyph";
import { Tooltip } from "../shared/Tooltip";
import {
  clampSplitLeftWidth,
  dockFlexGridColumns,
  splitGridColumns,
} from "../../muse/layout";
import { beginSplitDrag } from "../../muse/splitDrag";
import type { BotIssueBoard } from "../../hooks/useBotIssueBoard";
import type { MuseApiClient } from "../../muse/apiClient";
import { isSplitIssueGroup } from "../../utils/issueGroups";
import type {
  ChatAction,
  ChatState,
  ConfirmationDecision,
  DesktopHostProps,
  DesktopIssueGroup,
  ToolBlock,
  VsCodeApi,
} from "../../types";

function AssistantWelcome() {
  return (
    <div className="assistant-welcome">
      <h1 className="welcome-headline" data-testid="welcome-headline">
        灵光一现 迎刃而解
      </h1>
    </div>
  );
}

export function AssistantFrame({
  leftPanelWidth,
  botListsWide,
  workspace,
  assistantVisible,
  dockFullscreen,
  assistantView,
  board,
  setAssistantDockOpen,
  openIssueViewTab,
  setIssueTabChoice,
  assistantDockOpen,
  toggleAssistantDock,
  chatPaneWidth,
  chatContainerRef,
  layoutChatMin,
  chatMinWidth,
  issueTitles,
  museApi,
  vscode,
  assistantInputRef,
  messageInputRef,
  onAssistantViewMode,
  openMessageFile,
  openIssueMessageFile,
  handleOpenPreview,
  host,
  setBotComposerFocused,
  issueShowWelcome,
  shownIssueMessages,
  state,
  handleLogin,
  issueLoading,
  issueStreaming,
  handleRewindToMessage,
  dockWorkdir,
  handleOpenAgentTranscript,
  loadOlderIssueMessages,
  handleRevertFileHistory,
  revertingFileHistory,
  openFileHistoryDiff,
  postToHost,
  dispatch,
  handleEditQueuedMessage,
  handleDeleteQueuedMessage,
  handleConfirmation,
  handleRejection,
  composer,
  dock,
}: {
  leftPanelWidth: number;
  botListsWide: boolean;
  workspace: BotWorkspaceContextValue;
  assistantVisible: boolean;
  dockFullscreen: boolean;
  assistantView: "chat" | "transcript";
  board: BotIssueBoard;
  setAssistantDockOpen: (open: boolean) => void;
  openIssueViewTab: IssueViewTab;
  setIssueTabChoice: (choice: { issueId: string; tab: IssueViewTab }) => void;
  assistantDockOpen: boolean;
  toggleAssistantDock: () => void;
  chatPaneWidth: number | null;
  chatContainerRef: React.Ref<HTMLDivElement>;
  layoutChatMin: number;
  chatMinWidth: number;
  issueTitles: Record<string, string>;
  museApi: MuseApiClient;
  vscode: VsCodeApi;
  assistantInputRef: React.RefObject<MessageInputHandle>;
  messageInputRef: React.RefObject<MessageInputHandle>;
  onAssistantViewMode: (mode: "chat" | "transcript") => void;
  openMessageFile: (path: string, startLine?: number, endLine?: number) => void;
  openIssueMessageFile: (path: string, startLine?: number, endLine?: number) => void;
  handleOpenPreview: (url: string) => void;
  host: DesktopHostProps | undefined;
  setBotComposerFocused: (focused: boolean) => void;
  issueShowWelcome: boolean;
  shownIssueMessages: ChatState["messages"];
  state: ChatState;
  handleLogin: () => void;
  /** The issue session is still being activated; its chat state is not ours yet. */
  issueLoading: boolean;
  issueStreaming: boolean;
  handleRewindToMessage: (messageId: string) => void;
  dockWorkdir: string | null | undefined;
  handleOpenAgentTranscript: (toolBlock: ToolBlock) => void;
  loadOlderIssueMessages: () => void;
  handleRevertFileHistory: (messageIds: string[]) => void;
  revertingFileHistory: boolean;
  openFileHistoryDiff: (path: string) => void;
  postToHost: (message: Record<string, unknown>) => void;
  dispatch: React.Dispatch<ChatAction>;
  handleEditQueuedMessage: (id: string) => void;
  handleDeleteQueuedMessage: (id: string) => void;
  handleConfirmation: (confirmationId: string, decision?: ConfirmationDecision) => void;
  handleRejection: (confirmationId: string) => void;
  composer: React.ReactNode;
  dock: DesktopPanelSlotsProps;
}) {
  const {
    botQueue,
    botIssues,
    botMenu,
    selectBotPanel,
    setBotMenu,
    clearIssueUnreadRef,
    shownIssueGroup,
    threeColumns,
    setThreeColumnsOn,
    issueTabPresence,
    setBotSwitchHost,
    splitLeftWidth,
    setSplitLeftWidth,
    botSwitchHost,
    focusShownIssueFromSender,
  } = board;
  const showWideCards =
    leftPanelWidth > 0 ? botListsWideForPanel(leftPanelWidth) : botListsWide;
  const onBotHome = workspace.active === "bot";
  const showCards = onBotHome && showWideCards && !threeColumns;
  const showBotLists =
    assistantVisible &&
    !dockFullscreen &&
    !(onBotHome && assistantView === "transcript");
  const botColumnMax =
    showCards && showBotLists && leftPanelWidth > 0
      ? Math.min(BOT_MESSAGE_COLUMN_MAX, Math.floor(botListsColumnWidth(leftPanelWidth)))
      : undefined;
  const botLists = showBotLists ? (
    <BotLists
      queue={botQueue}
      issues={botIssues}
      selected={workspace.panel}
      wide={showCards}
      menu={botMenu}
      showQueue={onBotHome}
      onSelect={selectBotPanel}
      onOpenIssue={(issueId) => {
        workspace.openIssueSession(issueId);
        workspace.selectPanel({ kind: "issue", issueId });
        setBotMenu(null);
        clearIssueUnreadRef.current(issueId);
      }}
      onOpenDock={() => setAssistantDockOpen(true)}
      onToggleMenu={(next) => setBotMenu((current) => (current === next ? null : next))}
      onDismissMenu={() => setBotMenu(null)}
    />
  ) : null;

  const shownIssueHeader = shownIssueGroup ? (
    <IssueSessionHeader
      placement="corner"
      title={shownIssueGroup.title}
      activeTab={openIssueViewTab}
      onTabChange={(tab) => {
        if (tab === "execution" && !shownIssueGroup.executionSessionId) return;
        setIssueTabChoice({ issueId: shownIssueGroup.issueId, tab });
      }}
      showTabs={isSplitIssueGroup(shownIssueGroup)}
      executionEnabled={Boolean(shownIssueGroup.executionSessionId)}
    />
  ) : null;

  const columnToggle = (
    <Tooltip text="分栏" position="bottom" wrap={false}>
      <button
        type="button"
        className={`header-button${threeColumns ? " active" : ""}`}
        data-testid="assistant-column-toggle"
        aria-label="三栏"
        aria-pressed={threeColumns}
        disabled={workspace.openIssueIds.length === 0}
        onClick={() => setThreeColumnsOn((on) => !on)}
      >
        <svg className="header-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M1.5 2.5h3v11h-3v-11Zm5 0h3v11h-3v-11Zm5 0h3v11h-3v-11Z"
          />
        </svg>
      </button>
    </Tooltip>
  );
  const dockToggle = assistantDockOpen ? null : (
    <div className="bot-frame-dock-toggle">
      <PanelToggleControl onToggleDock={toggleAssistantDock} />
    </div>
  );
  return (
    <div
      className={`chat-container assistant-frame${threeColumns ? " assistant-frame--split" : ""}${chatPaneWidth != null && assistantDockOpen && !dockFullscreen ? " assistant-frame--dock-flex" : ""}`}
      ref={chatContainerRef}
      data-testid="assistant-frame"
      style={
        {
          ...(botColumnMax != null ? { "--bot-column-max": `${botColumnMax}px` } : {}),
          ...(threeColumns
            ? { "--chat-main-min-width": `${layoutChatMin}px` }
            : {}),
          ...(chatPaneWidth != null && assistantDockOpen && !dockFullscreen
            ? {
                gridTemplateColumns: dockFlexGridColumns(
                  chatPaneWidth,
                  chatMinWidth,
                ),
              }
            : {}),
        } as React.CSSProperties
      }
    >
      {threeColumns ? null : (
        <div className="bot-frame-bar">
          <BotTabs
            state={workspace}
            titles={issueTitles}
            presence={issueTabPresence}
            onFocus={workspace.focusTab}
            onClose={workspace.closeIssueTab}
          />
          <div className="bot-frame-switch" ref={setBotSwitchHost}>
            {shownIssueHeader}
          </div>
          {showCards ? null : botLists}
          <div className="bot-frame-end">
            {columnToggle}
            {dockToggle}
          </div>
        </div>
      )}
      <div className="desktop-chat-body">
        <div
          className="desktop-chat-main"
          style={
            threeColumns
              ? {
                  display: "grid",
                  gridTemplateColumns: splitGridColumns(
                    splitLeftWidth ?? chatMinWidth,
                  ),
                }
              : undefined
          }
        >
          {threeColumns ? (
            <div className="assistant-split-bot">
              <div className="assistant-split-bar">
                <BotTabs
                  state={workspace}
                  titles={issueTitles}
                  presence={issueTabPresence}
                  lockBotTab
                  scope="bot"
                  onFocus={workspace.focusTab}
                  onClose={workspace.closeIssueTab}
                />
                <div className="bot-frame-switch" ref={setBotSwitchHost} />
                {botLists}
              </div>
              <AssistantPage
                api={museApi}
                vscode={vscode}
                showPanelToggle={false}
                inputRef={assistantInputRef}
                onToggleDock={toggleAssistantDock}
                onViewModeChange={onAssistantViewMode}
                onOpenFile={openMessageFile}
                onOpenUrl={handleOpenPreview}
                hideQueue={assistantVisible}
                mentionIssues={(host?.issueGroups ?? []).map((group) => ({
                  id: group.issueId,
                  title: group.title,
                }))}
                onSelectIssue={(issueId) => selectBotPanel({ kind: "issue", issueId })}
                emptyState={<AssistantWelcome />}
                viewSwitchHost={botSwitchHost}
                onComposerFocusChange={setBotComposerFocused}
              />
            </div>
          ) : null}
          {threeColumns ? (
            <div
              className="assistant-split-handle"
              data-testid="assistant-split-handle"
              onPointerDown={(event) => {
                const main = event.currentTarget.parentElement;
                if (!main) return;
                const rect = main.getBoundingClientRect();
                // Live drag writes the grid on the column itself; the width
                // reaches the board state once, on release, so the transcript
                // and dock do not re-render per pointer event.
                beginSplitDrag(event, {
                  startValue: splitLeftWidth ?? chatMinWidth,
                  value: (ev) =>
                    clampSplitLeftWidth(
                      rect.width,
                      ev.clientX - rect.left,
                      chatMinWidth,
                    ),
                  preview: (left) => {
                    main.style.gridTemplateColumns = splitGridColumns(left);
                  },
                  commit: setSplitLeftWidth,
                });
              }}
            />
          ) : null}
          {shownIssueGroup ? (
            <div
              className={threeColumns ? "assistant-split-issue" : "assistant-split-passthrough"}
            >
            {threeColumns ? (
              <div className="assistant-split-bar">
                <BotTabs
                  state={workspace}
                  titles={issueTitles}
                  presence={issueTabPresence}
                  scope="issues"
                  onFocus={workspace.focusTab}
                  onClose={workspace.closeIssueTab}
                />
                <div className="bot-frame-switch">{shownIssueHeader}</div>
                <div className="bot-frame-end">
                  {columnToggle}
                  {dockToggle}
                </div>
              </div>
            ) : null}
            <div className="issue-tab-transcript" data-testid="issue-tab-transcript">
              {issueLoading ? (
                <div
                  className="issue-tab-loading"
                  data-testid="issue-tab-loading"
                  role="status"
                >
                  正在切换会话…
                </div>
              ) : (
                <ChatBody
                  hideWelcome={!issueShowWelcome}
                  onSelectPrompt={(text) => messageInputRef.current?.setText(text)}
                  isRestoring={false}
                  messages={shownIssueMessages}
                  initialized
                  isAuthenticated={state.isAuthenticated}
                  configurationData={state.configurationData}
                  onLogin={handleLogin}
                  queuedMessages={state.queuedMessages}
                  isStreaming={issueStreaming}
                  isCompacting={state.isCompacting}
                  vscode={vscode}
                  onRewindToMessage={handleRewindToMessage}
                  workdir={dockWorkdir ?? undefined}
                  onOpenPreview={handleOpenPreview}
                  onOpenFile={openIssueMessageFile}
                  onOpenAgentTranscript={handleOpenAgentTranscript}
                  hasOlderMessages={state.hasOlderMessages}
                  onLoadOlder={loadOlderIssueMessages}
                  onRevertFileHistory={handleRevertFileHistory}
                  revertingFileHistory={revertingFileHistory}
                  onOpenFileHistoryFile={openFileHistoryDiff}
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
                  onToggleTaskList={() => dispatch({ type: "TOGGLE_TASK_LIST_COLLAPSE" })}
                  isQueueCollapsed={state.isQueueCollapsed}
                  onToggleQueueCollapse={() => dispatch({ type: "TOGGLE_QUEUE_COLLAPSE" })}
                  onEditQueuedMessage={handleEditQueuedMessage}
                  onDeleteQueuedMessage={handleDeleteQueuedMessage}
                  editingQueuedId={state.editingQueuedId}
                  pendingConfirmations={state.pendingConfirmations}
                  onConfirm={handleConfirmation}
                  onReject={handleRejection}
                  currentSession={state.currentSession}
                  composer={composer}
                  onComposerFocus={threeColumns ? focusShownIssueFromSender : undefined}
                />
              )}
            </div>
            </div>
          ) : (
            <AssistantPage
              api={museApi}
              vscode={vscode}
              showPanelToggle={false}
              onToggleDock={toggleAssistantDock}
              onViewModeChange={onAssistantViewMode}
              onOpenFile={openMessageFile}
              onOpenUrl={handleOpenPreview}
              hideQueue={assistantVisible}
              inputRef={messageInputRef}
              mentionIssues={(host?.issueGroups ?? []).map((group) => ({
                id: group.issueId,
                title: group.title,
              }))}
              onSelectIssue={(issueId) => selectBotPanel({ kind: "issue", issueId })}
              emptyState={<AssistantWelcome />}
              viewSwitchHost={botSwitchHost}
            />
          )}
          {showCards ? botLists : null}
        </div>
        {assistantDockOpen ? <DesktopPanelSlots {...dock} /> : null}
      </div>
    </div>
  )
}
