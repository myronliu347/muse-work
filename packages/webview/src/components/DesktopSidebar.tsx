import React from "react";
import { Tooltip } from "./Tooltip";
import museM from "../assets/muse-m.png";
import {
  SessionTree,
  SESSION_DRAG_MIME,
  formatRelativeActiveAt,
  groupRecentSessionsByWorkdir,
  isTaskProjectWorkdir,
  partitionRecentSessions,
  resolveSidebarSessions,
} from "./SessionTree";
import type { DesktopSessionGroup, DesktopSessionEntry } from "../types";
import "../styles/DesktopApp.css";

export {
  SESSION_DRAG_MIME,
  SessionTree,
  formatRelativeActiveAt,
  groupRecentSessionsByWorkdir,
  isTaskProjectWorkdir,
  partitionRecentSessions,
  resolveSidebarSessions,
};

export type { WorkdirSessionGroup } from "./SessionTree";

const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().startsWith("MAC");

export interface DesktopSidebarProps {
  onNewSession: () => void;
  /** Cmd/Ctrl+Click on the 新对话 button: start the new session in an additional pane. */
  onNewSessionInPane: () => void;
  /**
   * Start a draft session with this workdir pre-selected (workdir group "+" button).
   */
  onNewSessionInWorkdir?: (workdir: string) => void;
  isStreaming: boolean;
  /** No workdir picked yet — starting a new session is not possible. */
  disabled: boolean;
  /** Opens provider settings from the sidebar footer. */
  onOpenSettings: () => void;
  /**
   * Legacy session tree groups. Prefer `pinnedSessions` / `recentSessions`.
   * When those are omitted, pin/recent groups are derived from workdir
   * `"pin"` / `"recent"` entries (Task 5 `buildSidebarModel`).
   */
  sessionTree?: DesktopSessionGroup[];
  /** Sessions in the 置顶 section. */
  pinnedSessions?: DesktopSessionEntry[];
  /** Sessions in the 工作空间 / 任务 sections (split by workdir kind). */
  recentSessions?: DesktopSessionEntry[];
  /** Active session id — drives current highlight and unread-dot suppression. */
  currentSessionId?: string;
  /** Sessions shown in panes — those other than currentSessionId get a weak highlight. */
  visibleSessionIds?: string[];
  onSelectSession: (workdir: string, sessionId: string) => void;
  /** Cmd/Ctrl+Click: open the session in an additional pane to the right. */
  onOpenPane: (workdir: string, sessionId: string) => void;
  /** Delete a session from the index (also cleans up worktree if applicable). */
  onDeleteSession: (sessionId: string) => void;
  /** Hover pin button: toggle pinned membership. */
  onTogglePin: (sessionId: string, pinned: boolean) => void;
  /** Persist a renamed session title (double-click title to edit). */
  onRenameSession?: (sessionId: string, title: string) => void;
  /** Open the workdir in VS Code via `code <workdir>`. */
  onOpenInEditor?: (workdir: string) => void;
  /** Open the workdir in the system terminal. */
  onOpenInTerminal?: (workdir: string) => void;
}

/**
 * Left rail for the desktop host: "新对话", session tree, and footer.
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  onNewSession,
  onNewSessionInPane,
  onNewSessionInWorkdir,
  isStreaming,
  disabled,
  onOpenSettings,
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
}) => {
  return (
    <div className="desktop-sidebar" data-testid="desktop-sidebar">
      <button
        className="desktop-sidebar-new-chat"
        onClick={(e) => {
          if (isMacPlatform() ? e.metaKey : e.ctrlKey) {
            onNewSessionInPane();
          } else {
            onNewSession();
          }
        }}
        // 新对话仅在无 workdir 时禁用；streaming 中也可开新会话（spec §7）。
        disabled={disabled}
        title={
          isMacPlatform()
            ? "新对话（⌘N，⌘+点击并排打开）"
            : "新对话（Ctrl+N，Ctrl+点击并排打开）"
        }
        data-testid="desktop-new-session"
      >
        <span className="codicon codicon-add"></span>
        <span>新对话</span>
      </button>
      <SessionTree
        sessionTree={sessionTree}
        pinnedSessions={pinnedSessions}
        recentSessions={recentSessions}
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
      />
      <div className="desktop-sidebar-footer" data-testid="desktop-sidebar-footer">
        <span className="desktop-sidebar-logo-wrap" data-testid="desktop-brand">
          <img
            src={museM}
            alt="Muse"
            className="desktop-sidebar-logo"
            draggable={false}
          />
        </span>
        <Tooltip text="设置" position="top">
          <button
            type="button"
            className="desktop-sidebar-settings-btn"
            onClick={onOpenSettings}
            data-testid="desktop-settings-btn"
            aria-label="设置"
          >
            <span className="codicon codicon-settings-gear" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default DesktopSidebar;
