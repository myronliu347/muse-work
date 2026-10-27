import type { ReactNode } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { DesktopIssueGroup } from "../../types";
import { issueSidebarStatusLabel } from "../../utils/issueStatusLabel";
import { Tooltip } from "../shared/Tooltip";
import { issueTabSessionId } from "./botWorkspace";

const CHECK_STATUS_ORDER = ["running", "pending", "done"] as const;

const CHECK_STATUS_LABEL: Record<string, string> = {
  running: "进行中",
  pending: "待办",
  done: "完成",
};

function detailMarkdown(text: string): string {
  const html = marked.parse(text, { gfm: true, breaks: true });
  return DOMPurify.sanitize(typeof html === "string" ? html : "", {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "code",
      "pre",
      "ul",
      "ol",
      "li",
      "a",
      "h1",
      "h2",
      "h3",
      "h4",
      "blockquote",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "del",
    ],
    ALLOWED_ATTR: ["href"],
  });
}

function DetailMarkdown({ text }: { text: string }) {
  return (
    <div
      className="dock-detail-md"
      dangerouslySetInnerHTML={{ __html: detailMarkdown(text) }}
    />
  );
}

export type DockDetailSelection =
  | { kind: "issue"; issue: DesktopIssueGroup }
  | { kind: "queue"; typeLabel: string; title: string; body: string }
  | { kind: "none" };

export interface DockDetailProps {
  selection: DockDetailSelection;
  actionLabel: "打开会话" | "切到会话" | null;
  onOpenSession: (issueId: string) => void;
  onOpenInEditor?: (workdir: string) => void;
  onRevealInFinder?: (workdir: string) => void;
}

function priorityText(priority: string): string {
  return /^p\d$/i.test(priority) ? priority.toUpperCase() : priority;
}

function workdirLabel(workdir: string): string {
  const normalized = workdir.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || workdir;
}

function issueEnvironment(issue: DesktopIssueGroup): {
  workdir: string;
  worktree: string;
  baseBranch: string;
} {
  const sessionId = issueTabSessionId(issue);
  const session =
    issue.sessions.find((item) => item.sessionId === sessionId) ??
    issue.sessions[0];
  const worktree = [session?.worktreeName, session?.worktreeBranch]
    .filter((part) => part && part.length > 0)
    .join(" · ");
  return {
    workdir: session?.workdir || issue.workdir || "",
    worktree,
    baseBranch: session?.baseBranch || issue.baseBranch || "",
  };
}

function DetailIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip text={label} position="bottom">
      <button
        type="button"
        className="dock-detail-action"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function DockDetail({
  selection,
  actionLabel,
  onOpenSession,
  onOpenInEditor,
  onRevealInFinder,
}: DockDetailProps) {
  if (selection.kind === "none") {
    return (
      <div className="dock-detail dock-detail--empty" data-testid="dock-detail">
        <div className="dock-detail-empty" data-testid="dock-detail-empty">
          <i className="codicon codicon-note" aria-hidden />
          <p>选择一个事项查看详情</p>
        </div>
      </div>
    );
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
  const description = issue.description?.trim() ?? "";
  const environment = issueEnvironment(issue);
  const workdir = environment.workdir;

  const priority = priorityText(issue.priority);
  const priorityKey = priority.toLowerCase();

  return (
    <div className="dock-detail" data-testid="dock-detail">
      <div className="dock-detail-sheet">
        <div className="dock-detail-head">
          <div className="dock-detail-heading">
            <h2 className="dock-detail-title">{issue.title}</h2>
            <div className="dock-detail-tags">
              <span className="dock-detail-tag">{status}</span>
              <span className={`dock-detail-tag dock-detail-tag--${priorityKey}`}>
                {priority}
              </span>
            </div>
          </div>
          <div className="dock-detail-actions">
            {actionLabel ? (
              <DetailIconButton
                label={actionLabel}
                onClick={() => onOpenSession(issue.issueId)}
              >
                <SessionActionIcon />
              </DetailIconButton>
            ) : null}
            <DetailIconButton
              label="在 IDE 中打开"
              disabled={!workdir}
              onClick={() => {
                if (workdir) onOpenInEditor?.(workdir);
              }}
            >
              <IdeActionIcon />
            </DetailIconButton>
            <DetailIconButton
              label="在访达中打开"
              disabled={!workdir}
              onClick={() => {
                if (workdir) onRevealInFinder?.(workdir);
              }}
            >
              <FinderActionIcon />
            </DetailIconButton>
          </div>
        </div>
        {description ? (
          <div className="dock-detail-description" data-testid="dock-detail-description">
            <DetailMarkdown text={description} />
          </div>
        ) : null}
        <dl className="dock-detail-fields">
          <div>
            <dt>工作目录</dt>
            <dd>
              {workdir ? (
                <Tooltip text={workdir} position="bottom">
                  <span className="dock-detail-workdir">{workdirLabel(workdir)}</span>
                </Tooltip>
              ) : (
                "—"
              )}
            </dd>
          </div>
          {environment.worktree ? (
            <div>
              <dt>Worktree</dt>
              <dd>{environment.worktree}</dd>
            </div>
          ) : null}
          {environment.baseBranch ? (
            <div>
              <dt>分支名称</dt>
              <dd>{environment.baseBranch}</dd>
            </div>
          ) : null}
        </dl>
        {issue.items.length > 0 ? (
          <Checklist items={issue.items} />
        ) : null}
      </div>
    </div>
  );
}

function Checklist({
  items,
}: {
  items: DesktopIssueGroup["items"];
}) {
  const ranked = [...items].sort((a, b) => {
    const ai = CHECK_STATUS_ORDER.indexOf(a.status as (typeof CHECK_STATUS_ORDER)[number]);
    const bi = CHECK_STATUS_ORDER.indexOf(b.status as (typeof CHECK_STATUS_ORDER)[number]);
    return (ai === -1 ? CHECK_STATUS_ORDER.length : ai) - (bi === -1 ? CHECK_STATUS_ORDER.length : bi);
  });
  const counts = ranked.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  const summary = [...CHECK_STATUS_ORDER, ...Object.keys(counts).filter(
    (status) => !CHECK_STATUS_ORDER.includes(status as (typeof CHECK_STATUS_ORDER)[number]),
  )].filter((status) => counts[status]);

  return (
    <section className="dock-detail-checks" data-testid="dock-detail-checklist">
      <div className="dock-detail-check-head">
        <h3 className="dock-detail-section">执行清单</h3>
        <div className="dock-detail-check-summary">
          {summary.map((status) => (
            <span key={status} data-status={status}>
              {CHECK_STATUS_LABEL[status] ?? status} {counts[status]}
            </span>
          ))}
        </div>
      </div>
      <ol className="dock-detail-check-list">
        {ranked.map((item) => (
          <li key={item.id} data-status={item.status}>
            <span className="dock-detail-check-badge">
              {CHECK_STATUS_LABEL[item.status] ?? item.status}
            </span>
            <DetailMarkdown text={item.content} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function SessionActionIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M3 4.2h10v6.2H6.2L3.4 12.6V4.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IdeActionIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M6.2 4.2 2.8 8l3.4 3.8M9.8 4.2 13.2 8l-3.4 3.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FinderActionIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M3.2 6.2h9.6v6.2H3.2V6.2Z M3.2 6.2 4.6 3.6h6.8l1.4 2.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
