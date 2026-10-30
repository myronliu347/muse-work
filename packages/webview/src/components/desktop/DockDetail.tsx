import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { DesktopIssueGroup } from "../../types";
import { issueSidebarStatusLabel } from "../../utils/issueStatusLabel";
import { IssueTypeIcon } from "../issue/IssueTypeIcon";
import { IssuePresenceMark, type IssuePresence } from "../session/SessionStatusGlyph";
import { MarkdownView } from "../message/MarkdownView";
import { Tooltip } from "../shared/Tooltip";
import { issueTabSessionId } from "./botWorkspace";

/** Floating issue column. It sits in the right margin and must not cover the sheet. */
export const DOCK_DETAIL_RAIL_WIDTH = 232;
export const DOCK_DETAIL_SHEET_MAX = 560;
export const DOCK_DETAIL_RAIL_GAP = 20;

/** True when the right margin can hold the issue column without covering the sheet. */
export function dockDetailRailFits(width: number): boolean {
  if (width <= 0) return false;
  const sheet = Math.min(width, DOCK_DETAIL_SHEET_MAX);
  const margin = (width - sheet) / 2;
  return margin >= DOCK_DETAIL_RAIL_WIDTH + DOCK_DETAIL_RAIL_GAP;
}

export type DockDetailIssue = {
  issueId: string;
  title: string;
  type?: string;
  presence?: IssuePresence | null;
};

function useBoxWidth(ref: { current: HTMLElement | null }, watch: unknown): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, watch]);
  return width;
}

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
    ALLOWED_ATTR: ["href", "class"],
  });
}

function DetailMarkdown({ text }: { text: string }) {
  return (
    <MarkdownView className="dock-detail-md" html={detailMarkdown(text)} />
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
  /** Open issues. The detail page lists them in the right rail. */
  issues?: DockDetailIssue[];
  onSelectIssue?: (issueId: string) => void;
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
  pressed,
  testId,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  testId?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip text={label} position="bottom">
      <button
        type="button"
        className="preview-pane-button"
        aria-label={label}
        aria-pressed={pressed}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function IssueRail({
  issues,
  currentId,
  mode,
  onSelect,
}: {
  issues: DockDetailIssue[];
  currentId: string;
  mode: "column" | "peek";
  onSelect: (issueId: string) => void;
}) {
  return (
    <aside
      className={`dock-detail-rail${mode === "peek" ? " dock-detail-rail--peek" : ""}`}
      data-testid="dock-detail-rail"
      data-mode={mode}
      aria-label="事项"
    >
      <h3 className="dock-detail-rail-title">
        事项
        <span>{issues.length}</span>
      </h3>
      <ul className="dock-detail-rail-rows">
        {issues.map((issue) => {
          const current = issue.issueId === currentId;
          return (
            <li key={issue.issueId}>
              <button
                type="button"
                className="dock-detail-rail-row"
                aria-current={current ? "true" : undefined}
                onClick={() => onSelect(issue.issueId)}
              >
                <span className="issue-sidebar-icon-slot">
                  <IssueTypeIcon type={issue.type} />
                  {issue.presence ? (
                    <span className="issue-sidebar-status-cover" aria-hidden="true">
                      <IssuePresenceMark presence={issue.presence} />
                    </span>
                  ) : null}
                </span>
                <span className="dock-detail-rail-name">{issue.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export function DockDetail({
  selection,
  actionLabel,
  onOpenSession,
  onOpenInEditor,
  onRevealInFinder,
  issues = [],
  onSelectIssue,
}: DockDetailProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLDivElement>(null);
  const width = useBoxWidth(rootRef, selection.kind);
  const fits = dockDetailRailFits(width);
  const [open, setOpen] = useState(true);
  const [peek, setPeek] = useState(false);
  const showColumn = open && fits && issues.length > 0 && selection.kind === "issue";
  const showPeek = peek && !fits && issues.length > 0 && selection.kind === "issue";

  useEffect(() => {
    if (fits) setPeek(false);
  }, [fits]);

  useEffect(() => {
    if (!showPeek) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (railRef.current?.contains(target)) return;
      if (toggleRef.current?.contains(target)) return;
      setPeek(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showPeek]);

  if (selection.kind === "none") {
    return (
      <div className="dock-detail dock-detail--empty" data-testid="dock-detail" ref={rootRef}>
        <div className="dock-detail-empty" data-testid="dock-detail-empty">
          <i className="codicon codicon-note" aria-hidden />
          <p>选择一个事项查看详情</p>
        </div>
      </div>
    );
  }

  if (selection.kind === "queue") {
    return (
      <div className="dock-detail dock-detail--queue" data-testid="dock-detail" ref={rootRef}>
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
    <div className="dock-detail" data-testid="dock-detail" ref={rootRef}>
      <div className="preview-pane-toolbar dock-detail-toolbar" data-testid="dock-detail-toolbar">
        <div className="dock-detail-toolbar-main">
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
              <i className="codicon codicon-comment" aria-hidden />
            </DetailIconButton>
          ) : null}
          <DetailIconButton
            label="在 IDE 中打开"
            disabled={!workdir}
            onClick={() => {
              if (workdir) onOpenInEditor?.(workdir);
            }}
          >
            <i className="codicon codicon-code" aria-hidden />
          </DetailIconButton>
          <DetailIconButton
            label="在访达中打开"
            disabled={!workdir}
            onClick={() => {
              if (workdir) onRevealInFinder?.(workdir);
            }}
          >
            <i className="codicon codicon-folder" aria-hidden />
          </DetailIconButton>
          {issues.length > 0 ? (
            <div ref={toggleRef}>
              <DetailIconButton
                label={showColumn || showPeek ? "收起事项列表" : "事项列表"}
                pressed={showColumn || showPeek}
                testId="dock-detail-issues-toggle"
                onClick={() => {
                  if (fits) {
                    setOpen((value) => !value);
                    return;
                  }
                  setPeek((value) => !value);
                }}
              >
                <i className="codicon codicon-list-tree" aria-hidden />
              </DetailIconButton>
            </div>
          ) : null}
        </div>
      </div>
      <div className="dock-detail-stage">
        <div className="dock-detail-scroll">
          <div className="dock-detail-sheet">
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
        {showColumn ? (
          <IssueRail
            issues={issues}
            currentId={issue.issueId}
            mode="column"
            onSelect={(issueId) => onSelectIssue?.(issueId)}
          />
        ) : null}
        {showPeek ? (
          <div ref={railRef}>
            <IssueRail
              issues={issues}
              currentId={issue.issueId}
              mode="peek"
              onSelect={(issueId) => {
                onSelectIssue?.(issueId);
                setPeek(false);
              }}
            />
          </div>
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

