import React from "react";
import { Tooltip } from "../shared/Tooltip";
import { WorktreeInfoCard } from "../shared/WorktreeInfoCard";
import { NewSessionIcon, MoreIcon } from "../shared/HeaderIcons";
import { MoreMenu } from "../shared/MoreMenu";
import { CommandsMenu } from "../shared/CommandsMenu";
import { PanelToggleControl } from "../panels/PanelToggleControl";
import { getSessionTitle } from "../../utils/session";
import type { ChatHeaderProps } from "../../types";
import "../../styles/ChatHeader.css";

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onNewSession,
  newSessionDisabled = false,
  messages,
  currentSession,
  onOpenSettings,
  onLogin,
  onLogout,
  isAuthenticated,
  hideSessionButtons = false,
  hideMoreButton = false,
  hideTitle = false,
  panelToggle,
  gitContext,
  commandMenuItems,
}) => {
  const title = getSessionTitle(currentSession, messages);

  // Worktree sessions show the same metadata card as the sidebar row on
  // title hover (branch / worktree name / workdir).
  const hasWorktreeMeta =
    gitContext &&
    (gitContext.worktreeName || gitContext.branch) &&
    gitContext.workdir;

  return (
    <div className="chat-header" data-testid="chat-header">
      {!hideTitle ? (
        <div className="header-title-group">
          {hasWorktreeMeta ? (
            <Tooltip
              text=""
              content={
                <WorktreeInfoCard
                  branch={gitContext.branch}
                  worktreeName={gitContext.worktreeName}
                  workdir={gitContext.workdir}
                />
              }
              position="bottom-right"
              className="chat-header-title-tooltip"
            >
              <div className="header-title">{title}</div>
            </Tooltip>
          ) : (
            <div className="header-title">{title}</div>
          )}
        </div>
      ) : null}
      <div className="header-buttons">
        {commandMenuItems && commandMenuItems.length > 0 && (
          <Tooltip text="会话指令" position="bottom">
            <CommandsMenu
              items={commandMenuItems}
              trigger={
                <button
                  className="header-button header-command-menu-btn"
                  data-testid="header-command-menu-btn"
                  aria-label="会话指令"
                >
                  <i className="codicon codicon-ellipsis"></i>
                </button>
              }
            />
          </Tooltip>
        )}
        {!hideSessionButtons && (
          <>
            <Tooltip text="新建对话" position="bottom">
              <button
                className="header-button"
                onClick={onNewSession}
                disabled={newSessionDisabled}
                data-testid="new-session-btn"
                aria-label="新建对话"
              >
                <NewSessionIcon />
              </button>
            </Tooltip>
          </>
        )}
        {!hideMoreButton && (
          <Tooltip text="更多" position="bottom">
            <MoreMenu
              trigger={
                <button
                  className="header-button"
                  data-testid="more-btn"
                  aria-label="更多"
                >
                  <MoreIcon />
                </button>
              }
              onOpenSettings={onOpenSettings}
              onLogin={onLogin}
              onLogout={onLogout}
              isAuthenticated={isAuthenticated}
            />
          </Tooltip>
        )}
        {panelToggle && <PanelToggleControl {...panelToggle} />}
      </div>
    </div>
  );
};
