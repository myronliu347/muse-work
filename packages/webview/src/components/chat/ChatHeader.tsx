import React, { useState } from "react";
import { Tooltip } from "../shared/Tooltip";
import { NewSessionIcon, MoreIcon } from "../shared/HeaderIcons";
import { MoreMenu } from "../shared/MoreMenu";
import { PanelToggleControl } from "../panels/PanelToggleControl";
import { DesktopGitContext } from "../desktop/DesktopGitContext";
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
  panelToggle,
  gitContext,
}) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const title = getSessionTitle(currentSession, messages);

  return (
    <div className="chat-header" data-testid="chat-header">
      <div className="header-title">{title}</div>
      {gitContext ? (
        <DesktopGitContext
          branch={gitContext.branch}
          worktreeName={gitContext.worktreeName}
        />
      ) : null}
      <div className="header-buttons">
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
            <button
              className="header-button"
              onClick={() => setShowMoreMenu((prev) => !prev)}
              data-testid="more-btn"
              aria-label="更多"
            >
              <MoreIcon />
            </button>
          </Tooltip>
        )}
        {panelToggle && <PanelToggleControl {...panelToggle} />}
      </div>
      {showMoreMenu && !hideMoreButton && (
        <MoreMenu
          onOpenSettings={onOpenSettings}
          onLogin={onLogin}
          onLogout={onLogout}
          isAuthenticated={isAuthenticated}
          onClose={() => setShowMoreMenu(false)}
        />
      )}
    </div>
  );
};
