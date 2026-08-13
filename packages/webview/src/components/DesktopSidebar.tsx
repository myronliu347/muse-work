import React, { useEffect, useMemo, useState } from "react";
import { Tooltip } from "./Tooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import museM from "../assets/muse-m.png";
import type { DesktopSessionGroup, DesktopSessionEntry } from "../types";
import "../styles/DesktopApp.css";

/** dataTransfer MIME carrying { workdir, sessionId } while a sidebar session drags. */
export const SESSION_DRAG_MIME = "application/x-wave-session";

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
  /** Sessions in the 工作空间 section. */
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
}

const dirName = (workdir: string): string =>
  workdir.split(/[\\/]/).filter(Boolean).pop() ?? workdir;

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

export type WorkdirSessionGroup = {
  workdir: string;
  label: string;
  sessions: DesktopSessionEntry[];
};

/** Group recent sessions by workdir; groups ordered by latest activity. */
export function groupRecentSessionsByWorkdir(
  sessions: DesktopSessionEntry[],
): WorkdirSessionGroup[] {
  const map = new Map<string, DesktopSessionEntry[]>();
  for (const session of sessions) {
    const key = session.workdir?.trim() || "";
    const list = map.get(key) ?? [];
    list.push(session);
    map.set(key, list);
  }

  const groups: WorkdirSessionGroup[] = [];
  for (const [workdir, list] of map) {
    const sorted = [...list].sort(
      (a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0),
    );
    groups.push({
      workdir,
      label: workdir ? dirName(workdir) : "未选择目录",
      sessions: sorted,
    });
  }

  groups.sort((a, b) => {
    const aMax = a.sessions[0]?.lastActiveAt ?? 0;
    const bMax = b.sessions[0]?.lastActiveAt ?? 0;
    return bMax - aMax;
  });
  return groups;
}

/**
 * Left rail for the desktop host: "新对话", pin / 工作空间 session list,
 * and a footer with brand logo + settings.
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  onNewSession,
  onNewSessionInPane,
  onNewSessionInWorkdir,
  isStreaming,
  disabled,
  onOpenSettings,
  sessionTree,
  pinnedSessions: pinnedProp,
  recentSessions: recentProp,
  currentSessionId,
  visibleSessionIds,
  onSelectSession,
  onOpenPane,
  onDeleteSession,
  onTogglePin,
  onRenameSession,
  onOpenInEditor,
}) => {
  // Session awaiting delete confirmation; non-null shows the ConfirmDialog.
  const [pendingDelete, setPendingDelete] = useState<{
    sessionId: string;
    title: string;
    description?: string;
  } | null>(null);
  /** Collapsed workdir keys in the 工作空间 section (default: all expanded). */
  const [collapsedWorkdirs, setCollapsedWorkdirs] = useState<Set<string>>(
    () => new Set(),
  );
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [workdirMenu, setWorkdirMenu] = useState<{
    x: number;
    y: number;
    workdir: string;
  } | null>(null);

  useEffect(() => {
    if (!workdirMenu) return;
    const close = () => setWorkdirMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [workdirMenu]);

  const { pinnedSessions, recentSessions } = resolveSidebarSessions({
    sessionTree,
    pinnedSessions: pinnedProp,
    recentSessions: recentProp,
  });

  const recentGroups = useMemo(
    () => groupRecentSessionsByWorkdir(recentSessions),
    [recentSessions],
  );

  const commitRename = (sessionId: string) => {
    const next = editingTitle.trim();
    setEditingSessionId(null);
    if (!next || !onRenameSession) return;
    const current =
      pinnedSessions.find((s) => s.sessionId === sessionId) ??
      recentSessions.find((s) => s.sessionId === sessionId);
    if ((current?.title || "新对话") === next) return;
    onRenameSession(sessionId, next);
  };

  const renderSession = (
    session: DesktopSessionEntry,
    opts?: { hideWorkdir?: boolean },
  ) => {
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
    const isEditing = editingSessionId === session.sessionId;

    return (
      <li
        key={session.sessionId}
        className={`desktop-session-item${isCurrent ? " desktop-session-item--current" : ""}${isVisible ? " desktop-session-item--visible" : ""}`}
        draggable={!isEditing}
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
          if (isEditing) return;
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
          {isEditing ? (
            <input
              className="desktop-session-title-input"
              value={editingTitle}
              autoFocus
              data-testid={`desktop-session-title-input-${session.sessionId}`}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditingTitle(e.target.value)}
              onBlur={() => commitRename(session.sessionId)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename(session.sessionId);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditingSessionId(null);
                }
              }}
            />
          ) : (
            <span
              className="desktop-session-title"
              title="双击修改标题"
              onDoubleClick={(e) => {
                if (!onRenameSession) return;
                e.stopPropagation();
                setEditingSessionId(session.sessionId);
                setEditingTitle(session.title || "新对话");
              }}
            >
              {session.title || "新对话"}
            </span>
          )}
          {!opts?.hideWorkdir && shortName ? (
            <span className="desktop-session-workdir" title={workdir}>
              {shortName}
            </span>
          ) : null}
        </span>
        <Tooltip text={session.pinned ? "取消置顶" : "置顶"} position="top">
          <button
            className={`desktop-session-pin${session.pinned ? " desktop-session-pin--active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(session.sessionId, !session.pinned);
            }}
            data-testid={`desktop-session-pin-${session.sessionId}`}
            aria-label={session.pinned ? "取消置顶" : "置顶"}
          >
            <span className="codicon codicon-pinned"></span>
          </button>
        </Tooltip>
        <Tooltip text="删除会话" position="top">
          <button
            className="desktop-session-delete"
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
            aria-label="删除会话"
          >
            <span className="codicon codicon-trash"></span>
          </button>
        </Tooltip>
      </li>
    );
  };

  const toggleWorkdirCollapsed = (workdir: string) => {
    setCollapsedWorkdirs((prev) => {
      const next = new Set(prev);
      if (next.has(workdir)) next.delete(workdir);
      else next.add(workdir);
      return next;
    });
  };

  const renderPinSection = () => (
    <div
      className="desktop-session-section"
      data-testid="desktop-session-section-pin"
    >
      <div className="desktop-session-section-header">置顶</div>
      {pinnedSessions.length === 0 ? (
        <div className="desktop-session-empty">无会话</div>
      ) : (
        <ul className="desktop-session-items">
          {pinnedSessions.map((session) => renderSession(session))}
        </ul>
      )}
    </div>
  );

  const renderRecentSection = () => (
    <div
      className="desktop-session-section"
      data-testid="desktop-session-section-recent"
    >
      <div className="desktop-session-section-header">工作空间</div>
      {recentGroups.length === 0 ? (
        <div className="desktop-session-empty">无会话</div>
      ) : (
        <div className="desktop-session-workdir-groups">
          {recentGroups.map((group) => {
            const collapsed = collapsedWorkdirs.has(group.workdir);
            const groupKey = group.workdir || "__none__";
            return (
              <div
                key={groupKey}
                className="desktop-session-workdir-group"
                data-testid={`desktop-session-workdir-group-${groupKey}`}
              >
                <div
                  className="desktop-session-workdir-row"
                  onClick={() => toggleWorkdirCollapsed(group.workdir)}
                  onContextMenu={(e) => {
                    if (!group.workdir || !onOpenInEditor) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setWorkdirMenu({
                      x: e.clientX,
                      y: e.clientY,
                      workdir: group.workdir,
                    });
                  }}
                  data-testid={`desktop-session-workdir-row-${groupKey}`}
                >
                  <span
                    className={`codicon codicon-chevron-${collapsed ? "right" : "down"} desktop-session-workdir-chevron`}
                    aria-hidden="true"
                  />
                  <span
                    className="codicon codicon-folder desktop-session-workdir-folder"
                    aria-hidden="true"
                  />
                  <span
                    className="desktop-session-workdir-label"
                    title={group.workdir || undefined}
                  >
                    {group.label}
                  </span>
                  {group.workdir && onNewSessionInWorkdir ? (
                    <Tooltip text="在此目录新建对话" position="top">
                      <button
                        type="button"
                        className="desktop-session-workdir-add"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNewSessionInWorkdir(group.workdir);
                        }}
                        data-testid={`desktop-session-workdir-add-${groupKey}`}
                        aria-label="在此目录新建对话"
                      >
                        <span className="codicon codicon-add"></span>
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
                {!collapsed ? (
                  <ul className="desktop-session-items desktop-session-items--nested">
                    {group.sessions.map((session) =>
                      renderSession(session, { hideWorkdir: true }),
                    )}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

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
            ? "新对话（Cmd+Click 并排打开）"
            : "新对话（Ctrl+Click 并排打开）"
        }
        data-testid="desktop-new-session"
      >
        <span className="codicon codicon-add"></span>
        <span>新对话</span>
      </button>
      <div className="desktop-session-tree" data-testid="desktop-session-tree">
        {renderPinSection()}
        {renderRecentSection()}
      </div>
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
      {workdirMenu && (
        <div
          className="desktop-context-menu"
          style={{ left: workdirMenu.x, top: workdirMenu.y }}
          data-testid="desktop-workdir-context-menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="desktop-context-menu-item"
            data-testid="desktop-workdir-open-in-editor"
            onClick={() => {
              onOpenInEditor?.(workdirMenu.workdir);
              setWorkdirMenu(null);
            }}
          >
            在编辑器打开
          </button>
        </div>
      )}
    </div>
  );
};

export default DesktopSidebar;
