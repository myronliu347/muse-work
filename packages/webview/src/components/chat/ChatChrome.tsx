import { forwardRef, type Dispatch } from "react";
import { ChatHeader } from "./ChatHeader";
import { ChatBody, type ChatBodyProps } from "./ChatBody";
import type {
  ChatAction,
  DesktopPanelKind,
  Message,
  SessionMetadata,
  VsCodeApi,
} from "../../types";
import type { PaneGitBranches } from "../../stores";
import type { ChatAppCore } from "../../hooks/useChatAppCore";

export interface ChatChromeProps extends ChatBodyProps {
  onNewSession: () => void;
  onAbortMessage: () => void;
  messages: Message[];
  currentSession?: SessionMetadata;
  onOpenSettings: () => void;
  onLogin: () => void;
  onLogout: () => void;
  isAuthenticated: boolean;
  postToHost: ChatAppCore["postToHost"];
  patchPane: ChatAppCore["patchPane"];
  dispatch: Dispatch<ChatAction>;
  gitBranches: PaneGitBranches | null;
  isDraftSession: boolean;
  effectiveWorkdir?: string;
  checkedPanels: DesktopPanelKind[];
  onToggleDock: () => void;
  vscode: VsCodeApi;
}

/**
 * Conversation chrome: the header (incl. the command menu items and the dock
 * panel-toggle hint) above the chat body. headerGitContext is re-derived here
 * from the branch/workdir props instead of being passed down.
 */
export const ChatChrome = forwardRef<
  { scrollToBottom: (behavior?: ScrollBehavior) => void },
  ChatChromeProps
>(function ChatChrome(
  {
    onNewSession,
    onAbortMessage,
    messages,
    currentSession,
    onOpenSettings,
    onLogin,
    onLogout,
    isAuthenticated,
    postToHost,
    patchPane,
    dispatch,
    gitBranches,
    isDraftSession,
    effectiveWorkdir,
    checkedPanels,
    onToggleDock,
    vscode,
    ...bodyProps
  },
  ref,
) {
  const sessionGitMeta = currentSession as
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

  return (
    <>
      <ChatHeader
        onNewSession={onNewSession}
        newSessionDisabled={false}
        onAbortMessage={onAbortMessage}
        messages={messages}
        currentSession={currentSession}
        onOpenSettings={onOpenSettings}
        onLogin={onLogin}
        onLogout={onLogout}
        isAuthenticated={isAuthenticated}
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
            onClick: onNewSession,
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
                onToggleDock,
              }
            : undefined
        }
      />
      <ChatBody
        ref={ref}
        vscode={vscode}
        messages={messages}
        currentSession={currentSession}
        isAuthenticated={isAuthenticated}
        onLogin={onLogin}
        {...bodyProps}
      />
    </>
  );
});
