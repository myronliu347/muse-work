import React, { forwardRef, type Dispatch } from "react";
import { ChatHeader } from "./ChatHeader";
import { Tooltip } from "../shared/Tooltip";
import { CommandsMenu } from "../shared/CommandsMenu";
import { PanelToggleControl } from "../panels/PanelToggleControl";
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
  /** Issue 详情：标题 + 规划/执行 Tab，渲染在顶栏与会话正文之间。 */
  issueSessionHeader?: React.ReactNode;
  hideChatTitle?: boolean;
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
    issueSessionHeader,
    hideChatTitle = false,
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

  const commandMenuItems = [
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
        ];
  const panelToggle =
    checkedPanels.length === 0
      ? {
          onToggleDock,
        }
      : undefined;
  const issueHeaderToolbar = (
    <div className="header-buttons">
      {commandMenuItems.length > 0 ? (
        <Tooltip text="会话指令" position="bottom">
          <CommandsMenu
            items={commandMenuItems}
            trigger={
              <button
                className="header-button header-command-menu-btn"
                data-testid="header-command-menu-btn"
                aria-label="会话指令"
              >
                <i className="codicon codicon-ellipsis" />
              </button>
            }
          />
        </Tooltip>
      ) : null}
      {panelToggle ? <PanelToggleControl {...panelToggle} /> : null}
    </div>
  );

  const issueHeaderWithToolbar =
    issueSessionHeader && hideChatTitle
      ? React.isValidElement(issueSessionHeader)
        ? React.cloneElement(issueSessionHeader, {
            actions: issueHeaderToolbar,
          })
        : issueSessionHeader
      : issueSessionHeader;

  return (
    <>
      {!hideChatTitle ? (
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
          commandMenuItems={commandMenuItems}
          panelToggle={panelToggle}
        />
      ) : null}
      <div className="chat-conversation-stack">
        {issueHeaderWithToolbar}
        <ChatBody
          ref={ref}
          vscode={vscode}
          messages={messages}
          currentSession={currentSession}
          isAuthenticated={isAuthenticated}
          onLogin={onLogin}
          {...bodyProps}
        />
      </div>
    </>
  );
});
