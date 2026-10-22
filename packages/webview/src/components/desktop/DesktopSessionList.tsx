import React from "react";
import {
  SessionTree,
  resolveSidebarSessions,
} from "../session/SessionTree";
import { DESKTOP_SIDEBAR_WIDTH } from "../../muse/layout";
import type {
  DesktopSessionEntry,
  DesktopSessionGroup,
} from "../../types";

/** Width of the ordinary-session column beside the icon rail. */
export const DESKTOP_SESSION_LIST_WIDTH = 232;

export interface DesktopSessionListProps {
  onNewSession: () => void;
  onNewSessionInWorkdir?: (workdir: string) => void;
  isStreaming: boolean;
  disabled?: boolean;
  sessionTree?: DesktopSessionGroup[];
  pinnedSessions?: DesktopSessionEntry[];
  recentSessions?: DesktopSessionEntry[];
  currentSessionId?: string;
  visibleSessionIds?: string[];
  onSelectSession: (workdir: string, sessionId: string) => void;
  onOpenPane: (workdir: string, sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onTogglePin: (sessionId: string, pinned: boolean) => void;
  onRenameSession?: (sessionId: string, title: string) => void;
  onOpenInEditor?: (workdir: string) => void;
  onOpenInTerminal?: (workdir: string) => void;
  onRevealInFinder?: (workdir: string) => void;
}

/**
 * Ordinary sessions beside the icon rail. Issue groups stay out of this column.
 */
export const DesktopSessionList: React.FC<DesktopSessionListProps> = ({
  onNewSession,
  onNewSessionInWorkdir,
  isStreaming,
  disabled = false,
  sessionTree,
  pinnedSessions,
  recentSessions,
  currentSessionId,
  visibleSessionIds,
  onSelectSession,
  onOpenPane,
  onDeleteSession,
  onTogglePin,
  onRenameSession,
  onOpenInEditor,
  onOpenInTerminal,
  onRevealInFinder,
}) => {
  return (
    <aside
      className="desktop-session-list"
      data-testid="desktop-session-list"
      style={{
        width: DESKTOP_SESSION_LIST_WIDTH,
        marginLeft: DESKTOP_SIDEBAR_WIDTH,
      }}
    >
      <button
        type="button"
        className="app-menu"
        data-testid="desktop-new-session"
        disabled={disabled}
        onClick={onNewSession}
      >
        <span className="codicon codicon-add app-menu-icon" aria-hidden="true" />
        新对话
      </button>
      <SessionTree
        {...resolveSidebarSessions({
          sessionTree,
          pinnedSessions,
          recentSessions,
        })}
        currentSessionId={currentSessionId}
        visibleSessionIds={visibleSessionIds}
        isStreaming={isStreaming}
        onSelectSession={onSelectSession}
        onOpenPane={onOpenPane}
        onDeleteSession={onDeleteSession}
        onTogglePin={onTogglePin}
        onRenameSession={onRenameSession}
        onNewSessionInWorkdir={onNewSessionInWorkdir}
        onOpenInEditor={onOpenInEditor}
        onOpenInTerminal={onOpenInTerminal}
        onRevealInFinder={onRevealInFinder}
      />
    </aside>
  );
};
