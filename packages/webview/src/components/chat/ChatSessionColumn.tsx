import type { Dispatch, ReactNode, RefObject } from "react";
import { ChatContainer } from "./ChatContainer";
import type { MessageInputHandle } from "./MessageInput";
import type { MainView } from "../ChatApp";
import type { ChatAppCore } from "../../hooks/useChatAppCore";
import type { ChatComposerProps } from "./ChatComposer";
import type { DesktopPanelSlotsProps } from "../desktop/DesktopPanelSlots";
import type {
  ChatAction,
  ChatState,
  ConfirmationDecision,
  DesktopPanelKind,
  ToolBlock,
  VsCodeApi,
} from "../../types";

/** The ordinary session column: messages, dock, and the shared composer. */
export function ChatSessionColumn(input: {
  state: ChatState;
  chatContainerRef: RefObject<HTMLDivElement>;
  queueEditWarning: string | null;
  patchPane: ChatAppCore["patchPane"];
  view: MainView;
  postToHost: ChatAppCore["postToHost"];
  effectiveWorkdir?: string;
  dock: DesktopPanelSlotsProps;
  vscode: VsCodeApi;
  handleClearChat: () => void;
  handleAbortMessage: () => void;
  messageInputRef: RefObject<MessageInputHandle>;
  handleOpenSettings: () => void;
  handleLogin: () => void;
  handleLogout: () => void;
  dispatch: Dispatch<ChatAction>;
  gitBranches: ChatComposerProps["gitBranches"];
  isDraftSession: boolean;
  checkedPanels: DesktopPanelKind[];
  handleToggleDock: () => void;
  handleRewindToMessage: (messageId: string) => void;
  openPreviewHandler: (url: string) => void;
  openMessageFile: (path: string, startLine?: number, endLine?: number) => void;
  handleOpenAgentTranscript: (toolBlock: ToolBlock) => void;
  handleRevertFileHistory: (messageIds: string[]) => void;
  revertingFileHistory: boolean;
  openFileHistoryDiff: (path: string) => void;
  handleEditQueuedMessage: (id: string) => void;
  handleDeleteQueuedMessage: (id: string) => void;
  handleConfirmation: (confirmationId: string, decision?: ConfirmationDecision) => void;
  handleRejection: (confirmationId: string) => void;
  composer: ReactNode;
  issueSessionHeader: ReactNode;
  showIssueChrome: boolean;
}) {
  const {
    state,
    chatContainerRef,
    queueEditWarning,
    patchPane,
    view,
    postToHost,
    effectiveWorkdir,
    dock,
    vscode,
    handleClearChat,
    handleAbortMessage,
    messageInputRef,
    handleOpenSettings,
    handleLogin,
    handleLogout,
    dispatch,
    gitBranches,
    isDraftSession,
    checkedPanels,
    handleToggleDock,
    handleRewindToMessage,
    openPreviewHandler,
    openMessageFile,
    handleOpenAgentTranscript,
    handleRevertFileHistory,
    revertingFileHistory,
    openFileHistoryDiff,
    handleEditQueuedMessage,
    handleDeleteQueuedMessage,
    handleConfirmation,
    handleRejection,
    composer,
    issueSessionHeader,
    showIssueChrome,
  } = input;
  return (
    <ChatContainer
      chatContainerRef={chatContainerRef}
      queueEditWarning={queueEditWarning}
      onDismissQueueEditWarning={() => patchPane({ queueEditWarning: null })}
      view={view}
      postToHost={postToHost}
      patchPane={patchPane}
      currentSession={state.currentSession}
      initialized={state.initialized}
      hideWelcome={state.transcriptPending}
      effectiveWorkdir={effectiveWorkdir}
      dock={dock}
      vscode={vscode}
      // ChatChrome / ChatBody props
      onNewSession={handleClearChat}
      onAbortMessage={handleAbortMessage}
      messages={state.messages}
      hasOlderMessages={state.hasOlderMessages}
      onLoadOlder={() => {
        const before = state.messages[0]?.id;
        if (before) postToHost({ command: "loadOlderMessages", before });
      }}
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
      onOpenFile={openMessageFile}
      onOpenAgentTranscript={handleOpenAgentTranscript}
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
      issueSessionHeader={issueSessionHeader}
      hideChatTitle={showIssueChrome}
    />
  );
}
