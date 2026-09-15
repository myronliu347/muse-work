import React, { useEffect, useMemo, useState } from "react";
import { Tooltip } from "../shared/Tooltip";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import { WorktreeInfoCard } from "../shared/WorktreeInfoCard";
import { IssueChecklistCard } from "../issue/IssueChecklistCard";
import { formatRelativeActiveAt } from "../../utils/time";
import type {
  DesktopSessionGroup,
  DesktopSessionEntry,
  DesktopIssueGroup,
} from "../../types";
import type { PopoChatSummary } from "../../muse/apiClient";
import { bodyPortal } from "../../utils/bodyPortal";

/** dataTransfer MIME carrying { workdir, sessionId } while a sidebar session drags. */
export const SESSION_DRAG_MIME = "application/x-wave-session";

const dirName = (workdir: string): string =>
  workdir.split(/[\\/]/).filter(Boolean).pop() ?? workdir;

const ISSUE_STATUS_LABEL: Record<string, string> = {
  pending: "待规划",
  planning: "规划中",
  executing: "执行中",
  review: "待审核",
};

const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().startsWith("MAC");

function SessionStatusGlyph({
  kind,
  label,
}: {
  kind: "running" | "waiting";
  label?: string;
}) {
  const title =
    label ?? (kind === "waiting" ? "等待确认" : "正在运行");
  if (kind === "waiting") {
    return (
      <svg
        className="desktop-session-status-icon desktop-session-status-icon--waiting"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        data-testid="desktop-session-status-waiting"
        aria-hidden="true"
      >
        <title>{title}</title>
        <rect x="4.4" y="3" width="2.4" height="10" rx="0.9" />
        <rect x="9.2" y="3" width="2.4" height="10" rx="0.9" />
      </svg>
    );
  }
  return (
    <svg
      className="desktop-session-status-icon desktop-session-status-icon--running"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      data-testid="desktop-session-status-running"
      aria-hidden="true"
    >
      <title>{title}</title>
      <rect
        className="desktop-session-status-bar desktop-session-status-bar--a"
        x="3.2"
        y="4"
        width="2.2"
        height="8"
        rx="1"
      />
      <rect
        className="desktop-session-status-bar desktop-session-status-bar--b"
        x="6.9"
        y="4"
        width="2.2"
        height="8"
        rx="1"
      />
      <rect
        className="desktop-session-status-bar desktop-session-status-bar--c"
        x="10.6"
        y="4"
        width="2.2"
        height="8"
        rx="1"
      />
    </svg>
  );
}

const ISSUE_PRIORITY_LABEL: Record<string, string> = {
  p0: "紧急",
  p1: "普通",
  p2: "较低",
};

function IssuePriorityFlag({ priority }: { priority: string }) {
  const key = priority === "p0" || priority === "p2" ? priority : "p1";
  const label = ISSUE_PRIORITY_LABEL[key] ?? "普通";
  return (
    <svg
      className={`desktop-session-issue-icon desktop-session-issue-icon--${key}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      data-testid="desktop-session-issue-icon"
      data-priority={key}
      aria-hidden="true"
    >
      <title>{`待办 · ${key.toUpperCase()} ${label}`}</title>
      <path
        className="desktop-session-issue-icon-pole"
        d="M4.2 2.35 v11.3"
      />
      <path
        className="desktop-session-issue-icon-cloth"
        d="M4.2 3.15 C7.45 2.1 9.15 4.45 12.55 3.2 V8.15 C9.15 9.4 7.45 7.05 4.2 8.1 Z"
      />
    </svg>
  );
}

/** 去掉会话标题末尾的「· 规划/执行」，避免和侧栏前缀叠两层。 */
export function stripIssueSessionRoleSuffix(title: string): string {
  return title.replace(/\s*·\s*(规划|执行)\s*$/u, "").trim() || title;
}

export function issueSessionRole(
  sessionId: string,
  group: Pick<DesktopIssueGroup, "planningSessionId" | "executionSessionId">,
): "planning" | "execution" | undefined {
  if (group.planningSessionId && sessionId === group.planningSessionId) {
    return "planning";
  }
  if (group.executionSessionId && sessionId === group.executionSessionId) {
    return "execution";
  }
  return undefined;
}

/** 嵌套在 Issue 标题下，只标角色，不再重复父标题。 */
export function formatIssueSessionTitle(
  role: "planning" | "execution",
): string {
  return role === "planning" ? "规划" : "执行";
}

/**
 * Auto-minted task projects live under `~/.muse-work/projects/<id>` (or
 * `~/.dev-muse-work/…` on MUSE_HOME_DIR dev instances)
 * (see `@muse-work/provider` `createDefaultProjectWorkdir`).
 */
export function isTaskProjectWorkdir(workdir: string): boolean {
  const normalized = workdir.replace(/\\/g, "/");
  return /(^|\/)(\.muse-work|\.dev-muse-work)\/projects\//.test(normalized);
}

/** 相对时间格式化已抽到公共 utils（src/utils/time.ts），保持 re-export 兼容。 */
export { formatRelativeActiveAt } from "../../utils/time";

/** Split non-pinned sessions into workspace vs auto task projects. */
export function partitionRecentSessions(sessions: DesktopSessionEntry[]): {
  workspace: DesktopSessionEntry[];
  tasks: DesktopSessionEntry[];
} {
  const workspace: DesktopSessionEntry[] = [];
  const tasks: DesktopSessionEntry[] = [];
  for (const session of sessions) {
    if (isTaskProjectWorkdir(session.workdir ?? "")) {
      tasks.push(session);
    } else {
      workspace.push(session);
    }
  }
  return { workspace, tasks };
}

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

/**
 * Group recent sessions by workdir; groups ordered by latest activity.
 * Worktree sessions group under their main repo root (`worktreeRepoRoot`)
 * so all worktrees of the same repository share one folder group.
 */
export function groupRecentSessionsByWorkdir(
  sessions: DesktopSessionEntry[],
): WorkdirSessionGroup[] {
  const map = new Map<string, DesktopSessionEntry[]>();
  for (const session of sessions) {
    const key =
      session.worktreeRepoRoot?.trim() || session.workdir?.trim() || "";
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

type SectionId = "pin" | "issues" | "popo" | "tasks" | "workspace";

export interface SessionTreeProps {
  sessionTree?: DesktopSessionGroup[];
  pinnedSessions?: DesktopSessionEntry[];
  recentSessions?: DesktopSessionEntry[];
  /** Issue 分组：规划会话 + 执行会话（侧栏「待办事项」折叠展示）。 */
  issueGroups?: DesktopIssueGroup[];
  currentSessionId?: string;
  visibleSessionIds?: string[];
  isStreaming: boolean;
  onSelectSession: (workdir: string, sessionId: string) => void;
  onOpenPane: (workdir: string, sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onTogglePin: (sessionId: string, pinned: boolean) => void;
  onRenameSession?: (sessionId: string, title: string) => void;
  onNewSessionInWorkdir?: (workdir: string) => void;
  onOpenInEditor?: (workdir: string) => void;
  onOpenInTerminal?: (workdir: string) => void;
  onRevealInFinder?: (workdir: string) => void;
  /** 待办事项 section 头「+」：打开新建 Issue 对话框。 */
  onNewIssue?: () => void;
  /** 无会话的 Issue 空态：「打开会话」。 */
  onOpenPlanning?: (issueId: string) => void;
  /** 分组行更多菜单「完成」。 */
  onCompleteIssue?: (issueId: string) => void;
  /** 分组行更多菜单「取消」。 */
  onCancelIssue?: (issueId: string) => void;
  /** 本地已配置 POPO 时展示侧栏会话栏。 */
  popoEnabled?: boolean;
  popoChats?: PopoChatSummary[];
  selectedPopoChatKey?: string | null;
  onSelectPopoChat?: (chatKey: string) => void;
  onDeletePopoChat?: (chatKey: string) => void;
}

function CollapsibleBody({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`desktop-session-collapse${open ? "" : " desktop-session-collapse--closed"}`}
      aria-hidden={!open}
    >
      <div className="desktop-session-collapse-inner">{children}</div>
    </div>
  );
}

/**
 * Pin / 待办事项 / 任务 / 工作空间 / POPO session tree for the desktop sidebar.
 */
export const SessionTree: React.FC<SessionTreeProps> = ({
  sessionTree,
  pinnedSessions: pinnedProp,
  recentSessions: recentProp,
  issueGroups,
  currentSessionId,
  visibleSessionIds,
  isStreaming,
  onSelectSession,
  onOpenPane,
  onDeleteSession,
  onTogglePin,
  onRenameSession,
  onNewSessionInWorkdir,
  onOpenInEditor,
  onOpenInTerminal,
  onRevealInFinder,
  onNewIssue,
  onOpenPlanning,
  onCompleteIssue,
  onCancelIssue,
  popoEnabled,
  popoChats,
  selectedPopoChatKey,
  onSelectPopoChat,
  onDeletePopoChat,
}) => {
  const [pendingDelete, setPendingDelete] = useState<{
    sessionId: string;
    title: string;
    description?: string;
  } | null>(null);
  const [pendingPopoDelete, setPendingPopoDelete] = useState<{
    chatKey: string;
    title: string;
  } | null>(null);
  const [pendingIssueAction, setPendingIssueAction] = useState<{
    issueId: string;
    title: string;
    kind: "complete" | "cancel";
  } | null>(null);
  const [collapsedWorkdirs, setCollapsedWorkdirs] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedIssues, setCollapsedIssues] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedSections, setCollapsedSections] = useState<Set<SectionId>>(
    () => new Set(),
  );
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [workdirMenu, setWorkdirMenu] = useState<{
    x: number;
    y: number;
    workdir: string;
  } | null>(null);
  const [issueMenu, setIssueMenu] = useState<{
    x: number;
    y: number;
    issueId: string;
  } | null>(null);

  useEffect(() => {
    if (!workdirMenu && !issueMenu) return;
    const close = () => {
      setWorkdirMenu(null);
      setIssueMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [workdirMenu, issueMenu]);

  const { pinnedSessions, recentSessions } = resolveSidebarSessions({
    sessionTree,
    pinnedSessions: pinnedProp,
    recentSessions: recentProp,
  });

  const { workspaceGroups, taskSessions } = useMemo(() => {
    const { workspace, tasks } = partitionRecentSessions(recentSessions);
    const sortedTasks = [...tasks].sort(
      (a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0),
    );
    return {
      workspaceGroups: groupRecentSessionsByWorkdir(workspace),
      taskSessions: sortedTasks,
    };
  }, [recentSessions]);

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

  const toggleWorkdirCollapsed = (workdir: string) => {
    setCollapsedWorkdirs((prev) => {
      const next = new Set(prev);
      if (next.has(workdir)) next.delete(workdir);
      else next.add(workdir);
      return next;
    });
  };

  const toggleSectionCollapsed = (sectionId: SectionId) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const toggleIssueCollapsed = (issueId: string) => {
    setCollapsedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  };

  const renderSession = (
    session: DesktopSessionEntry,
    opts?: {
      hideWorkdir?: boolean;
      hideActions?: boolean;
      displayTitle?: string;
    },
  ) => {
    const running =
      session.running ||
      (session.sessionId === currentSessionId && isStreaming);
    const waiting = session.waitingConfirmation ?? false;
    const isCurrent = session.sessionId === currentSessionId;
    const isVisible =
      !isCurrent && (visibleSessionIds?.includes(session.sessionId) ?? false);
    const showUnread = Boolean(session.unreadDone) && !isCurrent;
    const workdir = session.workdir ?? "";
    const shortName = workdir ? dirName(workdir) : "";
    const isEditing = editingSessionId === session.sessionId;

    // Worktree sessions get a branch icon next to the relative time, and a
    // hover card on the right showing branch / worktree name / workdir.
    const listTitle = opts?.displayTitle || session.title || "新对话";
    const worktreeInfo =
      session.hasWorktree && (session.worktreeName || session.worktreeBranch)
        ? {
            title: listTitle,
            branch: session.worktreeBranch,
            worktreeName: session.worktreeName,
            workdir: session.workdir,
          }
        : null;

    const row = (
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
            // jsdom DataTransfer may expose a read-only effectAllowed.
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
          {waiting ? (
            <SessionStatusGlyph kind="waiting" />
          ) : running ? (
            <SessionStatusGlyph kind="running" />
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
              {listTitle}
            </span>
          )}
          {!opts?.hideWorkdir && shortName ? (
            <span className="desktop-session-workdir" title={workdir}>
              {shortName}
            </span>
          ) : null}
        </span>
        {session.hasWorktree ? (
          <span
            className="desktop-session-worktree-badge"
            data-testid={`desktop-session-worktree-badge-${session.sessionId}`}
            title={
              session.worktreeName
                ? `worktree ${session.worktreeName}`
                : undefined
            }
          >
            <span className="codicon codicon-worktree" aria-hidden="true" />
          </span>
        ) : null}
        {session.lastActiveAt ? (
          <span
            className="desktop-session-active-at"
            data-testid={`desktop-session-active-at-${session.sessionId}`}
            title={new Date(session.lastActiveAt).toLocaleString()}
          >
            {formatRelativeActiveAt(session.lastActiveAt)}
          </span>
        ) : null}
        {!opts?.hideActions && (
          <span className="desktop-session-actions">
            <Tooltip text={session.pinned ? "取消置顶" : "置顶"} position="bottom">
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
            <Tooltip text="删除会话" position="bottom">
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
          </span>
        )}
      </li>
    );

    // Worktree rows show a hover card on the right (matches the Cursor
    // metadata popover). `wrap={false}` keeps the <li> a direct flex child
    // of `.desktop-session-items`; the box renders as a fixed sibling.
    return worktreeInfo ? (
      <Tooltip
        key={session.sessionId}
        text=""
        content={<WorktreeInfoCard {...worktreeInfo} />}
        position="right"
        wrap={false}
      >
        {row}
      </Tooltip>
    ) : (
      row
    );
  };

  const renderSectionHeader = (opts: {
    sectionId: SectionId;
    title: string;
    testId: string;
    /** 会话数量，跟随标题展示（如「置顶（2）」）。 */
    count?: number;
    /** 标题行右侧额外操作（如「+」新建）。 */
    trailing?: React.ReactNode;
  }) => {
    const collapsed = collapsedSections.has(opts.sectionId);
    return (
      <div className="desktop-session-section-header-row">
        <button
          type="button"
          className="desktop-session-section-header desktop-session-section-header--toggle"
          onClick={() => toggleSectionCollapsed(opts.sectionId)}
          data-testid={`${opts.testId}-toggle`}
          aria-expanded={!collapsed}
        >
          <span className="desktop-session-section-title">{opts.title}</span>
          {opts.count !== undefined ? (
            <span className="desktop-session-count">（{opts.count}）</span>
          ) : null}
          <span
            className={`codicon codicon-chevron-down desktop-session-section-chevron${collapsed ? " desktop-session-section-chevron--collapsed" : ""}`}
            aria-hidden="true"
          />
        </button>
        {opts.trailing}
      </div>
    );
  };

  const renderFlatSection = (opts: {
    sectionId: SectionId;
    title: string;
    testId: string;
    sessions: DesktopSessionEntry[];
    hideWorkdir?: boolean;
  }) => {
    const open = !collapsedSections.has(opts.sectionId);
    return (
      <div className="desktop-session-section" data-testid={opts.testId}>
        {renderSectionHeader({
          ...opts,
          count: opts.sessions.length,
        })}
        <CollapsibleBody open={open}>
          {opts.sessions.length === 0 ? (
            <div className="desktop-session-empty">无会话</div>
          ) : (
            <ul className="desktop-session-items">
              {opts.sessions.map((session) =>
                renderSession(session, { hideWorkdir: opts.hideWorkdir }),
              )}
            </ul>
          )}
        </CollapsibleBody>
      </div>
    );
  };

  /** 待办事项 section：Issue 分组（规划/执行会话）。 */
  const renderIssuesSection = () => {
    const open = !collapsedSections.has("issues");
    const groups = issueGroups ?? [];
    const count = groups.length;
    return (
      <div
        className="desktop-session-section"
        data-testid="desktop-session-section-issues"
      >
        {renderSectionHeader({
          sectionId: "issues",
          title: "待办事项",
          testId: "desktop-session-section-issues",
          count,
          trailing: onNewIssue ? (
            <Tooltip text="新建 Issue" position="top">
              <button
                type="button"
                className="desktop-session-section-add"
                onClick={(e) => {
                  e.stopPropagation();
                  onNewIssue();
                }}
                data-testid="desktop-session-section-issues-add"
                aria-label="新建 Issue"
              >
                <span className="codicon codicon-add" aria-hidden="true" />
              </button>
            </Tooltip>
          ) : null,
        })}
        <CollapsibleBody open={open}>
          {groups.length === 0 ? (
            <div className="desktop-session-empty issue-sidebar-section-empty">
              暂无 Issue
            </div>
          ) : (
            <>
              {groups.map((group) => {
                const collapsed = collapsedIssues.has(group.issueId);
                const priority = group.priority || "p1";
                const sessions = group.sessions ?? [];
                const statusLabel =
                  ISSUE_STATUS_LABEL[group.status] ?? group.status;
                return (
                  <div
                    key={group.issueId}
                    className="issue-sidebar-group"
                    data-testid={`desktop-session-issue-group-${group.issueId}`}
                  >
                    <Tooltip
                      text=""
                      content={
                        <IssueChecklistCard
                          issueId={group.issueId}
                          title={group.title}
                          description={group.description}
                          status={group.status}
                          items={group.items ?? []}
                        />
                      }
                      position="right"
                      wrap={false}
                    >
                      <div
                        className="issue-sidebar-row"
                        onClick={() => toggleIssueCollapsed(group.issueId)}
                        data-testid={`desktop-session-issue-row-${group.issueId}`}
                      >
                        <span
                          className="desktop-session-workdir-icon-slot"
                          aria-hidden="true"
                        >
                          <span className="desktop-session-workdir-folder">
                            <IssuePriorityFlag priority={priority} />
                          </span>
                          <span
                            className={`codicon codicon-chevron-down desktop-session-workdir-chevron${collapsed ? " desktop-session-workdir-chevron--collapsed" : ""}`}
                          />
                        </span>
                        <span
                          className="issue-sidebar-title"
                          title={group.title}
                        >
                          {group.title}
                        </span>
                        <span className="issue-sidebar-meta">
                          {statusLabel ? (
                            <span
                              className={`issue-sidebar-status issue-sidebar-status-${group.status}`}
                            >
                              {statusLabel}
                            </span>
                          ) : null}
                          <span
                            className={`issue-sidebar-priority issue-sidebar-priority-${priority}`}
                          >
                            {priority.toUpperCase()}
                          </span>
                          {onCompleteIssue || onCancelIssue ? (
                            <button
                              type="button"
                              className="desktop-session-workdir-add issue-sidebar-more"
                              data-testid={`desktop-session-issue-more-${group.issueId}`}
                              aria-label="更多"
                              onClick={(e) => {
                                e.stopPropagation();
                                setIssueMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  issueId: group.issueId,
                                });
                              }}
                            >
                              <span
                                className="codicon codicon-ellipsis"
                                aria-hidden="true"
                              />
                            </button>
                          ) : null}
                        </span>
                      </div>
                    </Tooltip>
                    <CollapsibleBody open={open && !collapsed}>
                      {sessions.length === 0 ? (
                        <div className="desktop-session-empty issue-sidebar-empty">
                          {onOpenPlanning ? (
                            <button
                              type="button"
                              className="issue-sidebar-open-planning"
                              data-testid={`desktop-session-issue-open-planning-${group.issueId}`}
                              onClick={() => onOpenPlanning(group.issueId)}
                            >
                              <span
                                className="codicon codicon-play"
                                aria-hidden="true"
                              />
                              打开会话
                            </button>
                          ) : (
                            "无会话"
                          )}
                        </div>
                      ) : (
                        <ul className="desktop-session-items desktop-session-items--nested">
                          {sessions.map((session) => {
                            const role = issueSessionRole(
                              session.sessionId,
                              group,
                            );
                            return renderSession(session, {
                              hideWorkdir: true,
                              // 待办事项（Issue 规划/执行）会话不允许置顶/删除
                              hideActions: true,
                              displayTitle: role
                                ? formatIssueSessionTitle(role)
                                : undefined,
                            });
                          })}
                        </ul>
                      )}
                    </CollapsibleBody>
                  </div>
                );
              })}
            </>
          )}
        </CollapsibleBody>
      </div>
    );
  };

  const renderPopoSection = () => {
    if (!popoEnabled) return null;
    const chats = popoChats ?? [];
    const open = !collapsedSections.has("popo");
    return (
      <div
        className="desktop-session-section"
        data-testid="desktop-session-section-popo"
      >
        {renderSectionHeader({
          sectionId: "popo",
          title: "POPO",
          testId: "desktop-session-section-popo",
          count: chats.length,
        })}
        <CollapsibleBody open={open}>
          {chats.length === 0 ? (
            <div className="desktop-session-empty">暂无会话</div>
          ) : (
            <ul className="desktop-session-items">
              {chats.map((chat) => {
                const current = selectedPopoChatKey === chat.chatKey;
                return (
                  <li key={chat.chatKey}>
                    <div
                      role="button"
                      tabIndex={0}
                      className={`desktop-session-item${current ? " desktop-session-item--current" : ""}`}
                      data-testid={`desktop-popo-item-${chat.chatKey}`}
                      onClick={() => onSelectPopoChat?.(chat.chatKey)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectPopoChat?.(chat.chatKey);
                        }
                      }}
                    >
                      <span className="desktop-session-status-slot" aria-hidden="true">
                        {chat.processing ? (
                          <SessionStatusGlyph kind="running" label="正在处理" />
                        ) : null}
                      </span>
                      <span className="desktop-session-title" title={chat.title}>
                        {chat.title}
                      </span>
                      <span className="desktop-popo-type">
                        {chat.type === "team" ? "群聊" : "私聊"}
                      </span>
                      <span className="desktop-session-active-at">
                        {formatRelativeActiveAt(chat.updatedAt)}
                      </span>
                      <span className="desktop-session-actions">
                          <Tooltip text="删除会话" position="bottom">
                            <button
                              type="button"
                              className="desktop-session-delete"
                              data-testid={`desktop-popo-delete-${chat.chatKey}`}
                              aria-label="删除会话"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingPopoDelete({
                                  chatKey: chat.chatKey,
                                  title: chat.title,
                                });
                              }}
                            >
                              <span className="codicon codicon-trash" />
                            </button>
                          </Tooltip>
                        </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CollapsibleBody>
      </div>
    );
  };

  /** 任务 section：自动任务项目会话。 */
  const renderTasksSection = () => {
    const open = !collapsedSections.has("tasks");
    return (
      <div className="desktop-session-section" data-testid="desktop-session-section-tasks">
        {renderSectionHeader({
          sectionId: "tasks",
          title: "任务",
          testId: "desktop-session-section-tasks",
          count: taskSessions.length,
        })}
        <CollapsibleBody open={open}>
          {taskSessions.length === 0 ? (
            <div className="desktop-session-empty">无会话</div>
          ) : (
            <ul className="desktop-session-items">
              {taskSessions.map((session) =>
                renderSession(session, { hideWorkdir: true }),
              )}
            </ul>
          )}
        </CollapsibleBody>
      </div>
    );
  };

  const renderWorkspaceSection = () => {
    const open = !collapsedSections.has("workspace");
    return (
      <div
        className="desktop-session-section"
        data-testid="desktop-session-section-recent"
      >
        {renderSectionHeader({
          sectionId: "workspace",
          title: "工作空间",
          testId: "desktop-session-section-recent",
          count: workspaceGroups.reduce((sum, g) => sum + g.sessions.length, 0),
        })}
        <CollapsibleBody open={open}>
          {workspaceGroups.length === 0 ? (
            <div className="desktop-session-empty">无会话</div>
          ) : (
            <div className="desktop-session-workdir-groups">
              {workspaceGroups.map((group) => {
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
                        if (
                          !group.workdir ||
                          (!onOpenInEditor && !onOpenInTerminal && !onRevealInFinder)
                        )
                          return;
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
                        className="desktop-session-workdir-icon-slot"
                        aria-hidden="true"
                      >
                        <span
                          className={`codicon ${collapsed ? "codicon-folder" : "codicon-folder-opened"} desktop-session-workdir-folder`}
                        />
                        <span
                          className={`codicon codicon-chevron-down desktop-session-workdir-chevron${collapsed ? " desktop-session-workdir-chevron--collapsed" : ""}`}
                        />
                      </span>
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
                    <CollapsibleBody open={open && !collapsed}>
                      <ul className="desktop-session-items desktop-session-items--nested">
                        {group.sessions.map((session) =>
                          renderSession(session, { hideWorkdir: true }),
                        )}
                      </ul>
                    </CollapsibleBody>
                  </div>
                );
              })}
            </div>
          )}
        </CollapsibleBody>
      </div>
    );
  };

  return (
    <div className="desktop-session-tree" data-testid="desktop-session-tree">
      {renderFlatSection({
        sectionId: "pin",
        title: "置顶",
        testId: "desktop-session-section-pin",
        sessions: pinnedSessions,
      })}
      {renderIssuesSection()}
      {renderTasksSection()}
      {renderWorkspaceSection()}
      {renderPopoSection()}

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
      {pendingPopoDelete && (
        <ConfirmDialog
          title={`确定删除会话「${pendingPopoDelete.title}」？`}
          description="仅从 Muse 侧栏移除记录；之后该会话再有 POPO 消息会重新出现。"
          onConfirm={() => {
            onDeletePopoChat?.(pendingPopoDelete.chatKey);
            setPendingPopoDelete(null);
          }}
          onCancel={() => setPendingPopoDelete(null)}
        />
      )}
      {pendingIssueAction && (
        <ConfirmDialog
          title={
            pendingIssueAction.kind === "complete"
              ? `完成「${pendingIssueAction.title}」？`
              : `取消「${pendingIssueAction.title}」？`
          }
          description="关闭后不会删除会话，仅从待办事项中消失。"
          confirmText={
            pendingIssueAction.kind === "complete" ? "完成" : "取消 Issue"
          }
          onConfirm={() => {
            if (pendingIssueAction.kind === "complete") {
              onCompleteIssue?.(pendingIssueAction.issueId);
            } else {
              onCancelIssue?.(pendingIssueAction.issueId);
            }
            setPendingIssueAction(null);
          }}
          onCancel={() => setPendingIssueAction(null)}
        />
      )}
      {issueMenu &&
        bodyPortal(
        <div
          className="desktop-context-menu"
          style={{ left: issueMenu.x, top: issueMenu.y }}
          data-testid={`desktop-session-issue-menu-${issueMenu.issueId}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {onCompleteIssue ? (
            <button
              type="button"
              className="desktop-context-menu-item"
              data-testid={`desktop-session-issue-complete-${issueMenu.issueId}`}
              onClick={() => {
                const group = (issueGroups ?? []).find(
                  (g) => g.issueId === issueMenu.issueId,
                );
                setIssueMenu(null);
                setPendingIssueAction({
                  issueId: issueMenu.issueId,
                  title: group?.title ?? issueMenu.issueId,
                  kind: "complete",
                });
              }}
            >
              完成
            </button>
          ) : null}
          {onCancelIssue ? (
            <button
              type="button"
              className="desktop-context-menu-item"
              data-testid={`desktop-session-issue-cancel-${issueMenu.issueId}`}
              onClick={() => {
                const group = (issueGroups ?? []).find(
                  (g) => g.issueId === issueMenu.issueId,
                );
                setIssueMenu(null);
                setPendingIssueAction({
                  issueId: issueMenu.issueId,
                  title: group?.title ?? issueMenu.issueId,
                  kind: "cancel",
                });
              }}
            >
              取消
            </button>
          ) : null}
        </div>,
        )}
      {workdirMenu &&
        bodyPortal(
        <div
          className="desktop-context-menu"
          style={{ left: workdirMenu.x, top: workdirMenu.y }}
          data-testid="desktop-workdir-context-menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {onOpenInEditor ? (
            <button
              type="button"
              className="desktop-context-menu-item"
              data-testid="desktop-workdir-open-in-editor"
              onClick={() => {
                onOpenInEditor(workdirMenu.workdir);
                setWorkdirMenu(null);
              }}
            >
              在编辑器打开
            </button>
          ) : null}
          {onOpenInTerminal ? (
            <button
              type="button"
              className="desktop-context-menu-item"
              data-testid="desktop-workdir-open-in-terminal"
              onClick={() => {
                onOpenInTerminal(workdirMenu.workdir);
                setWorkdirMenu(null);
              }}
            >
              在终端打开
            </button>
          ) : null}
          {onRevealInFinder ? (
            <button
              type="button"
              className="desktop-context-menu-item"
              data-testid="desktop-workdir-reveal-in-finder"
              onClick={() => {
                onRevealInFinder(workdirMenu.workdir);
                setWorkdirMenu(null);
              }}
            >
              在 Finder 中打开
            </button>
          ) : null}
        </div>,
        )}
    </div>
  );
};

export default SessionTree;
