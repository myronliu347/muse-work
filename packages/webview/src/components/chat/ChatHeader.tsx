import React, { useState } from "react";
import { Tooltip } from "../shared/Tooltip";
import { NewSessionIcon, HistoryIcon, MoreIcon } from "../shared/HeaderIcons";
import { SessionListPopup } from "../dialogs/SessionListPopup";
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
  sessions,
  currentSession,
  onSessionSelect,
  sessionsLoading,
  onOpenSettings,
  onLogin,
  onLogout,
  isAuthenticated,
  hideSessionButtons = false,
  hideMoreButton = false,
  panelToggle,
  gitContext,
}) => {
  const [showSessionList, setShowSessionList] = useState(false);
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
            <Tooltip text="历史对话" position="bottom">
              <button
                className="header-button"
                onClick={() => setShowSessionList((prev) => !prev)}
                data-testid="history-btn"
                aria-label="历史对话"
              >
                <HistoryIcon />
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
      {showSessionList && (
        <SessionListPopup
          sessions={sessions}
          currentSession={currentSession}
          onSessionSelect={onSessionSelect}
          loading={sessionsLoading}
          onClose={() => setShowSessionList(false)}
        />
      )}
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
