import type { DesktopIssueGroup } from "../../types";
import { issueSidebarStatusLabel } from "../../utils/issueStatusLabel";

export type DockDetailSelection =
  | { kind: "issue"; issue: DesktopIssueGroup }
  | { kind: "queue"; typeLabel: string; title: string; body: string }
  | { kind: "none" };

export interface DockDetailProps {
  selection: DockDetailSelection;
  actionLabel: "打开会话" | "切到会话" | null;
  onOpenSession: (issueId: string) => void;
}

function priorityText(priority: string): string {
  return /^p\d$/i.test(priority) ? priority.toUpperCase() : priority;
}

export function DockDetail({
  selection,
  actionLabel,
  onOpenSession,
}: DockDetailProps) {
  if (selection.kind === "none") {
    return <div className="dock-detail" data-testid="dock-detail" />;
  }

  if (selection.kind === "queue") {
    return (
      <div className="dock-detail" data-testid="dock-detail">
        <p className="dock-detail-kind">{selection.typeLabel}</p>
        <h2 className="dock-detail-title">{selection.title}</h2>
        {selection.body ? (
          <p className="dock-detail-body">{selection.body}</p>
        ) : null}
      </div>
    );
  }

  const issue = selection.issue;
  const status = issueSidebarStatusLabel({
    status: issue.status,
    agentMode: issue.agentMode,
    running: issue.sessions.some((session) => session.running),
    sessionStatus: issue.sessions.find((session) => session.sessionStatus)
      ?.sessionStatus,
  });

  return (
    <div className="dock-detail" data-testid="dock-detail">
      <h2 className="dock-detail-title">{issue.title}</h2>
      <p className="dock-detail-meta">{`${status} · ${priorityText(issue.priority)}`}</p>
      <ul className="dock-detail-items">
        {issue.items.map((item) => (
          <li key={item.id}>{item.content}</li>
        ))}
      </ul>
      {actionLabel ? (
        <button
          type="button"
          className="dock-detail-action"
          onClick={() => onOpenSession(issue.issueId)}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
