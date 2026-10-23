import { forwardRef, type ReactNode } from "react";
import { MessageList } from "./MessageList";
import { BackgroundTaskList } from "./BackgroundTaskList";
import { TaskList } from "./TaskList";
import { QueuedMessageList } from "./QueuedMessageList";
import { ConfirmationDialog } from "../dialogs/ConfirmationDialog";
import { NewSessionPage } from "./NewSessionPage";
import WelcomeView from "./WelcomeView";
import LoadingLogo from "./LoadingLogo";
import type {
  BackgroundTaskSummary,
  ConfigurationData,
  ConfirmationRequest,
  ConfirmationDecision,
  Message,
  QueuedMessage,
  SessionMetadata,
  Task,
  ToolBlock,
  VsCodeApi,
} from "../../types";

export interface ChatBodyProps {
  /** Render the new-session page (embedded welcome + composer) instead of the chat body. */
  newSessionPage?: boolean;
  isRestoring: boolean;
  messages: Message[];
  initialized: boolean;
  isAuthenticated: boolean;
  configurationData?: ConfigurationData;
  onLogin: () => void;
  /** Fill the composer with a welcome-card prompt; do not send. */
  onSelectPrompt?: (text: string) => void;
  queuedMessages: QueuedMessage[];
  isStreaming: boolean;
  isCompacting: boolean;
  vscode: VsCodeApi;
  onRewindToMessage: (messageId: string) => void;
  workdir?: string;
  onOpenPreview: (url: string) => void;
  onOpenFile: (path: string, startLine?: number, endLine?: number) => void;
  onOpenAgentTranscript: (toolBlock: ToolBlock) => void;
  hasOlderMessages?: boolean;
  onLoadOlder?: () => void;
  onRevertFileHistory: (messageIds: string[]) => void;
  revertingFileHistory: boolean;
  onOpenFileHistoryFile: (path: string) => void;
  backgroundTasks: BackgroundTaskSummary[];
  isBackgroundTasksCollapsed: boolean;
  onToggleBackgroundTasks: () => void;
  onStopTask: (taskId: string) => void;
  tasks: Task[];
  isTaskListCollapsed: boolean;
  onToggleTaskList: () => void;
  isQueueCollapsed: boolean;
  onToggleQueueCollapse: () => void;
  onEditQueuedMessage: (id: string) => void;
  onDeleteQueuedMessage: (id: string) => void;
  editingQueuedId: string | null;
  pendingConfirmations: ConfirmationRequest[];
  onConfirm: (
    confirmationId: string,
    decision?: ConfirmationDecision,
  ) => void;
  onReject: (confirmationId: string) => void;
  currentSession?: SessionMetadata;
  /** The message composer (rendered both in the new-session page and the input area). */
  composer: ReactNode;
  /** Issue 标签嵌入会话详情时不展示欢迎页。 */
  hideWelcome?: boolean;
}

export const ChatBody = forwardRef<
  { scrollToBottom: (behavior?: ScrollBehavior) => void },
  ChatBodyProps
>(function ChatBody(
  {
    newSessionPage,
    isRestoring,
    messages,
    initialized,
    isAuthenticated,
    configurationData,
    onLogin,
    onSelectPrompt,
    queuedMessages,
    isStreaming,
    isCompacting,
    vscode,
    onRewindToMessage,
    workdir,
    onOpenPreview,
    onOpenFile,
    onOpenAgentTranscript,
    hasOlderMessages,
    onLoadOlder,
    onRevertFileHistory,
    revertingFileHistory,
    onOpenFileHistoryFile,
    backgroundTasks,
    isBackgroundTasksCollapsed,
    onToggleBackgroundTasks,
    onStopTask,
    tasks,
    isTaskListCollapsed,
    onToggleTaskList,
    isQueueCollapsed,
    onToggleQueueCollapse,
    onEditQueuedMessage,
    onDeleteQueuedMessage,
    editingQueuedId,
    pendingConfirmations,
    onConfirm,
    onReject,
    currentSession,
    composer,
    hideWelcome,
  },
  ref,
) {
  // A message counts as chat content only when the UI renders it — hidden meta
  // user messages (e.g. SessionStart hook additionalContext, isMeta: true) do
  // not, so they must not suppress the welcome page.
  const hasVisibleMessages = messages.some(
    (m) => !(m.role === "user" && m.isMeta),
  );

  // Welcome page shows only when there are no visible messages yet. Login is optional:
  // a direct-connect config (baseURL/apiKey) works without authentication, so an
  // unauthenticated user who sends a message must still see the chat, not the welcome page.
  const showWelcome = !hideWelcome && !hasVisibleMessages;
  // Withhold the welcome page until the initial state (incl. auth status) has
  // arrived, otherwise logged-in users see the login CTA flash before
  // setInitialState updates isAuthenticated to true.
  const showWelcomeReady = showWelcome && initialized;
  const hasDirectConnectConfig = !!(
    configurationData?.apiKey && configurationData?.baseURL
  );

  if (newSessionPage) {
    return (
      <NewSessionPage
        welcome={
          <WelcomeView
            embedded
            isAuthenticated={isAuthenticated}
            hasDirectConnectConfig={hasDirectConnectConfig}
            onLogin={onLogin}
            onSelectPrompt={onSelectPrompt}
          />
        }
        composer={composer}
      />
    );
  }

  return isRestoring ? (
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
          isAuthenticated={isAuthenticated}
          hasDirectConnectConfig={hasDirectConnectConfig}
          onLogin={onLogin}
          onSelectPrompt={onSelectPrompt}
        />
      ) : showWelcome ? (
        <LoadingLogo />
      ) : (
        <MessageList
          ref={ref}
          messages={messages}
          queuedMessages={queuedMessages}
          isStreaming={isStreaming}
          isCompacting={isCompacting}
          vscode={vscode}
          onRewindToMessage={onRewindToMessage}
          workdir={workdir}
          onOpenPreview={onOpenPreview}
          onOpenFile={onOpenFile}
          onOpenAgentTranscript={onOpenAgentTranscript}
          hasOlderMessages={hasOlderMessages}
          onLoadOlder={onLoadOlder}
          onRevertFileHistory={onRevertFileHistory}
          revertingFileHistory={revertingFileHistory}
          onOpenFileHistoryFile={onOpenFileHistoryFile}
        />
      )}

      <div
        className={`input-area-container${pendingConfirmations.length > 0 ? " input-area-container--confirm" : ""}`}
      >
        <div
          style={{
            display: pendingConfirmations.length === 0 ? "block" : "none",
          }}
        >
          <BackgroundTaskList
            // 按会话 id 重挂载：切换会话时重置"全部完成自动隐藏"的跟踪。
            // 注意与 TaskList 的 key 保持不同——两个兄弟组件用同一 key 会触发
            // React 重复 key 警告（session id 每次渲染都相同）。
            key={`bg-${currentSession?.id ?? "none"}`}
            tasks={backgroundTasks}
            isCollapsed={isBackgroundTasksCollapsed}
            onToggleCollapse={onToggleBackgroundTasks}
            onStopTask={onStopTask}
          />
          <TaskList
            // 按会话 id 重挂载：切换会话时重置“观察过未完成任务”的跟踪，
            // 使全部已完成的新会话立即隐藏，而不是沿用上一会话的 5 秒宽限
            key={`tasks-${currentSession?.id ?? "none"}`}
            tasks={tasks}
            isCollapsed={isTaskListCollapsed}
            onToggleCollapse={onToggleTaskList}
          />
          <QueuedMessageList
            queuedMessages={queuedMessages}
            isCollapsed={isQueueCollapsed}
            onToggleCollapse={onToggleQueueCollapse}
            onEdit={onEditQueuedMessage}
            onDelete={onDeleteQueuedMessage}
            editingQueuedId={editingQueuedId}
            vscode={vscode}
          />
        </div>

        <div
          style={{
            display: pendingConfirmations.length === 0 ? "block" : "none",
          }}
        >
          {composer}
        </div>

        {pendingConfirmations.length > 0 && (
          <ConfirmationDialog
            key={pendingConfirmations[0].confirmationId}
            data-confirmation-id={pendingConfirmations[0].confirmationId}
            confirmation={pendingConfirmations[0]}
            onConfirm={onConfirm}
            onReject={onReject}
          />
        )}
      </div>
    </>
  );
});
