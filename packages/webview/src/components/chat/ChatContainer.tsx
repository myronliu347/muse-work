import type { FC, RefObject } from "react";
import LoadingLogo from "./LoadingLogo";
import { ChatBody } from "./ChatBody";
import { ChatChrome, type ChatChromeProps } from "./ChatChrome";
import { DesktopPanelSlots, type DesktopPanelSlotsProps } from "../desktop/DesktopPanelSlots";
import type { MainView } from "../ChatApp";
import type {
  SessionMetadata,
  VsCodeApi,
} from "../../types";
import type { ChatAppCore } from "../../hooks/useChatAppCore";

export interface ChatContainerProps extends ChatChromeProps {
  /** The chat column element; measured for dock width planning + focus routing. */
  chatContainerRef: RefObject<HTMLDivElement>;
  queueEditWarning: string | null;
  onDismissQueueEditWarning: () => void;
  view: MainView;
  postToHost: ChatAppCore["postToHost"];
  currentSession?: SessionMetadata;
  initialized: boolean;
  /** Computed once here and shared by every render consumer (composer/dock/dialogs). */
  effectiveWorkdir?: string;
  dock: DesktopPanelSlotsProps;
  vscode: VsCodeApi;
}

/**
 * The chat column: queue-edit warning bar, the view router (new-session
 * page / conversation chrome) and the shared panel dock.
 * isDraftSession / showNewSessionPage are re-derived from the session props.
 */
export const ChatContainer: FC<ChatContainerProps> = ({
  chatContainerRef,
  queueEditWarning,
  onDismissQueueEditWarning,
  view,
  postToHost,
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
          {isDraftSession && !initialized ? (
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
        {view === "chat" &&
          !isDraftSession &&
          dock.checked.length > 0 &&
          dock.active && <DesktopPanelSlots {...dock} />}
      </div>
    </div>
  );
};
