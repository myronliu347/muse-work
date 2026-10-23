import type { DesktopIssueGroup } from "../../types";
import { issueSidebarStatusLabel } from "../../utils/issueStatusLabel";

/** 侧栏会话状态：等待确认 > 正在运行 > 未读完成。 */
export type IssuePresence = "waiting" | "running" | "unread";

export function SessionStatusGlyph({
  kind,
  label,
}: {
  kind: "running" | "waiting";
  label?: string;
}) {
  const title = label ?? (kind === "waiting" ? "等待确认" : "正在运行");
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

export function IssuePresenceMark({ presence }: { presence: IssuePresence | null }) {
  if (presence === "waiting") return <SessionStatusGlyph kind="waiting" />;
  if (presence === "running") return <SessionStatusGlyph kind="running" />;
  if (presence === "unread") {
    return <span className="desktop-session-unread-dot" data-testid="desktop-session-unread-dot" />;
  }
  return null;
}

/** 和侧栏 Issue 行同一套：等待确认、正在运行、未读完成，以及状态文案。 */
export function issueGroupActivity(
  group: DesktopIssueGroup,
  opts: { currentSessionId?: string; isStreaming?: boolean } = {},
): { presence: IssuePresence | null; label: string } {
  const sessions = group.sessions ?? [];
  const statusSession =
    sessions.find((session) => session.waitingConfirmation || session.running || session.unreadDone) ??
    sessions[0];
  const statusCurrent = Boolean(
    statusSession?.sessionId && statusSession.sessionId === opts.currentSessionId,
  );
  const running = Boolean(statusSession?.running) || (statusCurrent && Boolean(opts.isStreaming));
  const waiting = Boolean(statusSession?.waitingConfirmation);
  const unread = Boolean(statusSession?.unreadDone) && !statusCurrent;
  const presence: IssuePresence | null = waiting ? "waiting" : running ? "running" : unread ? "unread" : null;
  return {
    presence,
    label: issueSidebarStatusLabel({
      status: group.status,
      agentMode: group.agentMode,
      running,
      sessionStatus: statusSession?.sessionStatus,
    }),
  };
}

/** 当前打开的那条会话是否还在生成。等待确认不算正在处理。 */
export function issueSessionBusy(
  group: DesktopIssueGroup,
  sessionId: string | undefined,
  opts: { currentSessionId?: string; isStreaming?: boolean },
): boolean {
  if (!sessionId) return false;
  const session = group.sessions.find((item) => item.sessionId === sessionId);
  if (session?.waitingConfirmation) return false;
  if (session?.running) return true;
  return sessionId === opts.currentSessionId && Boolean(opts.isStreaming);
}
