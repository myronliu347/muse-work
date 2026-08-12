import React, { useState } from "react";
import { Tooltip } from "./Tooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { MoreIcon } from "./HeaderIcons";
import { MoreMenu } from "./MoreMenu";
import type { DesktopSessionGroup, DesktopSessionEntry } from "../types";
import "../styles/DesktopApp.css";

/** dataTransfer MIME carrying { workdir, sessionId } while a sidebar session drags. */
export const SESSION_DRAG_MIME = "application/x-wave-session";

export interface DesktopSidebarProps {
  onNewSession: () => void;
  /** Cmd/Ctrl+Click on the 新对话 button: start the new session in an additional pane. */
  onNewSessionInPane: () => void;
  isStreaming: boolean;
  /** No workdir picked yet — starting a new session is not possible. */
  disabled: boolean;
  /** Desktop host: the more menu (settings/login) lives here. */
  onOpenSettings: () => void;
  onLogin: () => void;
  onLogout: () => void;
  isAuthenticated: boolean;
  /**
   * Host the focused pane runs on ('local' or an SSH host name). Labels the
   * more menu's 登录/退出登录 entry so it names the auth subject it acts on.
   */
  hostLabel?: string;
  /**
   * Legacy session tree groups. Prefer `pinnedSessions` / `recentSessions`.
   * When those are omitted, pin/recent groups are derived from workdir
   * `"pin"` / `"recent"` entries (Task 5 `buildSidebarModel`).
   */
  sessionTree?: DesktopSessionGroup[];
  /** Sessions in the Pin section. */
  pinnedSessions?: DesktopSessionEntry[];
  /** Sessions in the 最近 section. */
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
}

const dirName = (workdir: string): string =>
  workdir.split("/").filter(Boolean).pop() ?? workdir;

const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().startsWith("MAC");

/** Resolve pin/recent lists from explicit props or legacy sessionTree groups. */
export function resolveSidebarSessions(props: {
  sessionTree?: DesktopSessionGroup[];
  pinnedSessions?: DesktopSessionEntry[];
  recentSessions?: DesktopSessionEntry[];
}): {
  pinnedSessions: DesktopSessionEntry[];
  recentSessions: DesktopSessionEntry[];
} {
  if (props.pinnedSessions !== undefined || props.recentSessions !== undefined) {
    return {
      pinnedSessions: props.pinnedSessions ?? [],
      recentSessions: props.recentSessions ?? [],
    };
  }
  const tree = props.sessionTree ?? [];
  return {
    pinnedSessions: tree.find((g) => g.workdir === "pin")?.sessions ?? [],
    recentSessions: tree.find((g) => g.workdir === "recent")?.sessions ?? [],
  };
}

/**
 * Left rail for the desktop host: app title, "新对话" button, and the global
 * pin / 最近 session list (spec §7).
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  onNewSession,
  onNewSessionInPane,
  isStreaming,
  disabled,
  onOpenSettings,
  onLogin,
  onLogout,
  isAuthenticated,
  hostLabel,
  sessionTree,
  pinnedSessions: pinnedProp,
  recentSessions: recentProp,
  currentSessionId,
  visibleSessionIds,
  onSelectSession,
  onOpenPane,
  onDeleteSession,
  onTogglePin,
}) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // Session awaiting delete confirmation; non-null shows the ConfirmDialog.
  const [pendingDelete, setPendingDelete] = useState<{
    sessionId: string;
    title: string;
    description?: string;
  } | null>(null);

  const { pinnedSessions, recentSessions } = resolveSidebarSessions({
    sessionTree,
    pinnedSessions: pinnedProp,
    recentSessions: recentProp,
  });

  const renderSession = (session: DesktopSessionEntry) => {
    // Prefer host-derived running; fall back to local streaming for the
    // focused session so the spinner appears before the next tree refresh.
    const running =
      session.running ||
      (session.sessionId === currentSessionId && isStreaming);
    // Waiting takes precedence over running.
    const waiting = session.waitingConfirmation ?? false;
    const isCurrent = session.sessionId === currentSessionId;
    const isVisible =
      !isCurrent && (visibleSessionIds?.includes(session.sessionId) ?? false);
    const showUnread = Boolean(session.unreadDone) && !isCurrent;
    const workdir = session.workdir ?? "";
    const shortName = workdir ? dirName(workdir) : "";

    return (
      <li
        key={session.sessionId}
        className={`desktop-session-item${isCurrent ? " desktop-session-item--current" : ""}${isVisible ? " desktop-session-item--visible" : ""}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            SESSION_DRAG_MIME,
            JSON.stringify({
              workdir,
              sessionId: session.sessionId,
            }),
          );
          try {
            e.dataTransfer.effectAllowed = "copy";
          } catch {
            // jsdom's DataTransfer polyfill exposes a read-only effectAllowed.
          }
        }}
        onClick={(e) => {
          if (isMacPlatform() ? e.metaKey : e.ctrlKey) {
            onOpenPane(workdir, session.sessionId);
          } else {
            onSelectSession(workdir, session.sessionId);
          }
        }}
        data-testid={`desktop-session-item-${session.sessionId}`}
      >
        <span className="desktop-session-status-slot" aria-hidden="true">
          {running || waiting ? (
            <i
              className={`codicon codicon-${waiting ? "bell" : "loading codicon-modifier-spin"} desktop-session-status-icon`}
              style={{
                color: waiting
                  ? "var(--vscode-charts-purple, #b180d7)"
                  : "var(--vscode-charts-blue, #59a4f9)",
              }}
              title={waiting ? "等待确认" : "正在运行"}
            />
          ) : showUnread ? (
            <span className="desktop-session-unread-dot" />
          ) : null}
        </span>
        <span className="desktop-session-text">
          <span className="desktop-session-title">
            {session.title || "新对话"}
          </span>
          {shortName ? (
            <span className="desktop-session-workdir" title={workdir}>
              {shortName}
            </span>
          ) : null}
        </span>
        <button
          className={`desktop-session-pin${session.pinned ? " desktop-session-pin--active" : ""}`}
          title={session.pinned ? "取消置顶" : "置顶"}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(session.sessionId, !session.pinned);
          }}
          data-testid={`desktop-session-pin-${session.sessionId}`}
        >
          <span className="codicon codicon-pinned"></span>
        </button>
        <button
          className="desktop-session-delete"
          title="删除会话"
          onClick={(e) => {
            e.stopPropagation();
            const label = session.title || "新对话";
            setPendingDelete({
              sessionId: session.sessionId,
              title: `确定删除会话「${label}」？`,
              description: session.hasWorktree
                ? "该会话的 worktree 目录与临时分支将一并删除，未提交的改动将丢失。"
                : undefined,
            });
          }}
          data-testid={`desktop-session-delete-${session.sessionId}`}
        >
          <span className="codicon codicon-trash"></span>
        </button>
      </li>
    );
  };

  const renderSection = (
    key: "pin" | "recent",
    label: string,
    sessions: DesktopSessionEntry[],
  ) => (
    <div
      className="desktop-session-section"
      data-testid={`desktop-session-section-${key}`}
    >
      <div className="desktop-session-section-header">{label}</div>
      {sessions.length === 0 ? (
        <div className="desktop-session-empty">无会话</div>
      ) : (
        <ul className="desktop-session-items">
          {sessions.map((session) => renderSession(session))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="desktop-sidebar" data-testid="desktop-sidebar">
      <div className="desktop-sidebar-header">
        <span className="desktop-sidebar-title">Muse Work</span>
        <Tooltip text="更多" position="bottom">
          <button
            className="desktop-sidebar-more-btn"
            onClick={() => setShowMoreMenu((prev) => !prev)}
            data-testid="desktop-more-btn"
            aria-label="更多"
          >
            <MoreIcon />
          </button>
        </Tooltip>
      </div>
      {showMoreMenu && (
        <MoreMenu
          onOpenSettings={onOpenSettings}
          onLogin={onLogin}
          onLogout={onLogout}
          isAuthenticated={isAuthenticated}
          hostLabel={hostLabel === "local" ? undefined : hostLabel}
          onClose={() => setShowMoreMenu(false)}
        />
      )}
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
            ? "新对话（Cmd+Click 并排打开）"
            : "新对话（Ctrl+Click 并排打开）"
        }
        data-testid="desktop-new-session"
      >
        <span className="codicon codicon-add"></span>
        <span>新对话</span>
      </button>
      <div className="desktop-session-tree" data-testid="desktop-session-tree">
        {renderSection("pin", "Pin", pinnedSessions)}
        {renderSection("recent", "最近", recentSessions)}
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.title}
          description={pendingDelete.description}
          onConfirm={() => {
            onDeleteSession(pendingDelete.sessionId);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};

export default DesktopSidebar;
