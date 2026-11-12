import { beginSplitDrag } from "../../muse/splitDrag";
import React from "react";
import {
  SessionTree,
  resolveSidebarSessions,
} from "../session/SessionTree";
import { DESKTOP_SIDEBAR_WIDTH, clampSidebarWidth } from "../../muse/layout";
import { NewSessionIcon } from "../shared/HeaderIcons";
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
  width?: number;
  onWidthChange?: (width: number) => void;
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
  width = DESKTOP_SESSION_LIST_WIDTH,
  onWidthChange,
}) => {
  const onResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onWidthChange) return;
    const startX = event.clientX;
    const startWidth = width;
    const aside = event.currentTarget.parentElement;
    // The list overlays the conversation; the chat is inset by the same width
    // (--desktop-sidebar-width), so the drag has to move both or the list would
    // paint over the text until the release.
    const layout = event.currentTarget.closest<HTMLElement>(".desktop-layout");
    beginSplitDrag(event, {
      startValue: startWidth,
      value: (ev) => clampSidebarWidth(startWidth + ev.clientX - startX),
      preview: (next) => {
        if (aside) aside.style.width = `${next}px`;
        layout?.style.setProperty(
          "--desktop-sidebar-width",
          `${DESKTOP_SIDEBAR_WIDTH + next}px`,
        );
      },
      commit: onWidthChange,
    });
  };
  return (
    <aside
      className="desktop-session-list"
      data-testid="desktop-session-list"
      style={{
        width,
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
        <NewSessionIcon className="app-menu-icon" />
        新对话
      </button>
      {onWidthChange ? (
        <div
          className="desktop-session-list-resize"
          data-testid="desktop-session-list-resize"
          onPointerDown={onResizeStart}
        />
      ) : null}
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
