import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import { TodoBoard } from "../todo/TodoBoard";
import { PopoRobotView } from "../popo/PopoRobotView";
import LoadingLogo from "./LoadingLogo";
import { ChatBody } from "./ChatBody";
import { ChatChrome, type ChatChromeProps } from "./ChatChrome";
import { DesktopPanelSlots, type DesktopPanelSlotsProps } from "../desktop/DesktopPanelSlots";
import type { MainView } from "../ChatApp";
import type {
  DesktopHostProps,
  SessionMetadata,
  VsCodeApi,
} from "../../types";
import type { MuseApiClient } from "../../muse/apiClient";
import type { ChatAppCore } from "../../hooks/useChatAppCore";

export interface ChatContainerProps extends ChatChromeProps {
  /** The chat column element; measured for dock width planning + focus routing. */
  chatContainerRef: RefObject<HTMLDivElement>;
  queueEditWarning: string | null;
  onDismissQueueEditWarning: () => void;
  view: MainView;
  setView: Dispatch<SetStateAction<MainView>>;
  host?: DesktopHostProps;
  postToHost: ChatAppCore["postToHost"];
  popoApi: MuseApiClient;
  currentSession?: SessionMetadata;
  initialized: boolean;
  /** Computed once here and shared by every render consumer (composer/dock/dialogs). */
  effectiveWorkdir?: string;
  dock: DesktopPanelSlotsProps;
  vscode: VsCodeApi;
}

/**
 * The chat column: queue-edit warning bar, the view router (todo board / POPO
 * robot / new-session page / conversation chrome) and the shared panel dock.
 * isDraftSession / showNewSessionPage are re-derived from the session props.
 */
export const ChatContainer: React.FC<ChatContainerProps> = ({
  chatContainerRef,
  queueEditWarning,
  onDismissQueueEditWarning,
  view,
  setView,
  host,
  postToHost,
  popoApi,
  currentSession,
  initialized,
  effectiveWorkdir,
  dock,
  vscode,
  ...chromeProps
}) => {
  const isDraftSession =
    !currentSession?.id || currentSession.id === "__draft__";
  const showNewSessionPage = isDraftSession && initialized;

  return (
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
            onClick={onDismissQueueEditWarning}
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
          ) : isDraftSession && !initialized ? (
            <LoadingLogo />
          ) : view === "newChat" || showNewSessionPage ? (
            <ChatBody
              {...chromeProps}
              currentSession={currentSession}
              initialized={initialized}
              vscode={vscode}
              newSessionPage
            />
          ) : (
            <ChatChrome
              {...chromeProps}
              currentSession={currentSession}
              postToHost={postToHost}
              initialized={initialized}
              effectiveWorkdir={effectiveWorkdir}
              vscode={vscode}
            />
          )}
        </div>
        {/* 文件/变更等面板只在会话详情（chat 视图）显示，机器人页/新会话页隐藏 */}
        {view === "chat" && !isDraftSession && dock.checked.length > 0 && dock.active && (
          <DesktopPanelSlots {...dock} />
        )}
      </div>
    </div>
  );
};
