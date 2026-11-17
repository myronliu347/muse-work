import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { DesktopIssueGroup, DesktopIssueUpdate } from "../../types";
import { issueSidebarStatusLabel } from "../../utils/issueStatusLabel";
import { FileIcon } from "../panels/FileIcon";
import { isHtmlPreviewPath } from "../assistant/assistantLinks";
import { IssueRowContent, type BotListIssue } from "./BotLists";
import { Disclosure } from "../shared/Disclosure";
import type { IssuePresence } from "../session/SessionStatusGlyph";
import { MarkdownView } from "../message/MarkdownView";
import { Tooltip } from "../shared/Tooltip";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
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
  priority?: string;
  statusLabel?: string;
  latestUpdate?: { summary: string; at: number };
  unreadCount?: number;
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

/** The issue AI summary only changes when the Issue gets new progress. */
const closeSummaryCache = new Map<string, { key: string; summary: string }>();
const closeSummaryRequests = new Map<
  string,
  { key: string; promise: Promise<string> }
>();

const CHECK_STATUS_ORDER = ["running", "pending", "done"] as const;

const CHECK_STATUS_LABEL: Record<string, string> = {
  running: "进行中",
  pending: "待办",
  done: "完成",
};

const UPDATE_KIND_LABEL: Record<DesktopIssueUpdate["kind"], string> = {
  assistant: "助手",
  turn: "回合",
  status: "状态",
  checklist: "清单",
  permission: "待批准",
  result: "结果",
};

function formatUpdateTime(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function mergeUpdates(
  base: DesktopIssueUpdate[],
  extra: DesktopIssueUpdate[],
): DesktopIssueUpdate[] {
  const byId = new Map<string, DesktopIssueUpdate>();
  for (const update of [...base, ...extra]) {
    if (!byId.has(update.id)) byId.set(update.id, update);
  }
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of paths) {
    const path = value?.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

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
  /** 点击本轮改动文件：打开 diff。 */
  onOpenChangedFile?: (path: string) => void;
  /** 点击产物附件：打开文件/预览。 */
  onOpenArtifact?: (path: string) => void;
  /** HTML 产物：在内置浏览器打开。 */
  onOpenArtifactInBrowser?: (path: string) => void;
  /** 加载这个 Issue 的完整进展（详情默认只拿到最近 8 条）。 */
  onLoadUpdates?: (
    issueId: string,
    opts?: { limit?: number; before?: string },
  ) => Promise<{ updates: DesktopIssueUpdate[]; hasMore: boolean }>;
  /** 行内处理审批。 */
  onRespondPermission?: (
    sessionId: string,
    permissionId: string,
    decision: "allow" | "deny",
  ) => Promise<void>;
  /** 直接完成/取消 Issue，不需要再发一轮消息。 */
  onCompleteIssue?: (issueId: string, note: string) => Promise<void>;
  onCancelIssue?: (issueId: string, note: string) => Promise<void>;
  onGenerateSummary?: (issueId: string) => Promise<string>;
}

function priorityText(priority: string): string {
  return /^p\d$/i.test(priority) ? priority.toUpperCase() : priority;
}

function workdirLabel(workdir: string): string {
  const normalized = workdir.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || workdir;
}

function fileName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() || filePath;
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
                <IssueRowContent
                  issue={
                    {
                      issueId: issue.issueId,
                      title: issue.title,
                      priority: issue.priority ?? "p1",
                      type: issue.type,
                      presence: issue.presence ?? null,
                      ...(issue.statusLabel ? { statusLabel: issue.statusLabel } : {}),
                      ...(issue.latestUpdate ? { latestUpdate: issue.latestUpdate } : {}),
                      ...(issue.unreadCount ? { unreadCount: issue.unreadCount } : {}),
                    } satisfies BotListIssue
                  }
                />
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
  onOpenChangedFile,
  onOpenArtifact,
  onOpenArtifactInBrowser,
  onLoadUpdates,
  onRespondPermission,
  onCompleteIssue,
  onCancelIssue,
  onGenerateSummary,
}: DockDetailProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLDivElement>(null);
  const width = useBoxWidth(rootRef, selection.kind);
  const fits = dockDetailRailFits(width);
  const [open, setOpen] = useState(true);
  const [peek, setPeek] = useState(false);
  const [latestExpanded, setLatestExpanded] = useState(false);
  const [extraUpdates, setExtraUpdates] = useState<DesktopIssueUpdate[]>([]);
  const [updatesExpanded, setUpdatesExpanded] = useState(false);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [resolvingPermission, setResolvingPermission] = useState<string | null>(null);
  const [resolvedPermissions, setResolvedPermissions] = useState<Set<string>>(new Set());
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [closeKind, setCloseKind] = useState<"complete" | "cancel" | null>(null);
  const [closeNote, setCloseNote] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeLoading, setCloseLoading] = useState(false);
  const [closePreview, setClosePreview] = useState(true);
  const closeRequestRef = useRef(0);
  const showColumn = open && fits && issues.length > 0 && selection.kind === "issue";
  const showPeek = peek && !fits && issues.length > 0 && selection.kind === "issue";

  useEffect(() => {
    if (fits) setPeek(false);
  }, [fits]);

  useEffect(() => {
    setLatestExpanded(false);
    setExtraUpdates([]);
    setUpdatesExpanded(false);
    setResolvingPermission(null);
    setResolvedPermissions(new Set());
    setPermissionError(null);
    setCloseKind(null);
    setCloseNote("");
    setCloseBusy(false);
    setCloseError(null);
    setCloseLoading(false);
    setClosePreview(true);
    closeRequestRef.current += 1;
  }, [selection.kind === "issue" ? selection.issue.issueId : ""]);

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
  const descriptionPreview = description
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^#+\s*/, "")
    .slice(0, 80);
  const environment = issueEnvironment(issue);
  const workdir = environment.workdir;

  const priority = priorityText(issue.priority);
  const priorityKey = priority.toLowerCase();

  const baseUpdates = issue.updates ?? [];
  const updates = mergeUpdates(baseUpdates, extraUpdates);
  const activeIssue =
    issue.status !== "completed" && issue.status !== "cancelled";
  // A result stays in the file after an undo; once the Issue is active again,
  // do not let the old "已完成/已取消" result keep winning the latest card.
  const displayUpdates = activeIssue
    ? updates.filter(
        (update) =>
          !(
            update.kind === "result" &&
            (update.status === "completed" || update.status === "cancelled")
          ),
      )
    : updates;
  const primaryUpdate =
    displayUpdates.find(
      (update) => update.kind === "assistant" || update.kind === "result",
    ) ??
    displayUpdates.find((update) => update.kind === "turn") ??
    displayUpdates[0];
  const nextStep =
    displayUpdates.find((update) => update.kind === "assistant" && update.next)
      ?.next ??
    issue.items.find((item) => item.status !== "done")?.content;
  const changedFiles = uniquePaths(
    updates.flatMap((update) => update.changedFiles ?? []),
  );
  const artifactFiles = uniquePaths(updates.flatMap((update) => update.files ?? []));
  // 主卡已经展示最新一条；时间线只留历史增量。空回合标记没有信息量，
  // 全部从时间线隐藏，避免“回合结束”刷屏；最新的 turn 仍由主卡兜底。
  const timelineUpdates = displayUpdates.filter(
    (update) => update.id !== primaryUpdate?.id && update.kind !== "turn",
  );
  const visibleUpdates = timelineUpdates.slice(0, updatesExpanded ? 30 : 8);
  const latestHasMore =
    Boolean(primaryUpdate) &&
    (primaryUpdate!.summary.length > 180 || Boolean(primaryUpdate!.detail));
  const canLoadMore = Boolean(onLoadUpdates) && (
    updatesExpanded
      ? updates.length > 8
      : (issue.updateCount ?? baseUpdates.length) > baseUpdates.length ||
        timelineUpdates.length > 8
  );
  const permissionUpdate = updates.find(
    (update) =>
      update.kind === "permission" &&
      Boolean(update.permissionId) &&
      Boolean(update.sessionId) &&
      !resolvedPermissions.has(update.permissionId!) &&
      !updates.some(
        (entry) =>
          entry.kind === "status" &&
          entry.permissionId === update.permissionId,
      ),
  );
  const closable =
    issue.status !== "completed" && issue.status !== "cancelled";
  const suggestedCloseNote =
    [...displayUpdates]
      .filter((update) => update.kind === "assistant" || update.kind === "result")
      .sort((a, b) => b.at - a.at)
      .find((update) => update.summary.trim())?.summary.trim() ??
    (changedFiles.length > 0
      ? `完成，改动 ${changedFiles.length} 个文件`
      : "已完成");
  const progressCacheKey = [
    updates[0]?.id ?? "empty",
    issue.title,
    issue.description ?? "",
  ].join("\0");

  const openClose = (kind: "complete" | "cancel") => {
    const requestId = closeRequestRef.current + 1;
    closeRequestRef.current = requestId;
    setCloseKind(kind);
    setCloseNote(kind === "complete" ? suggestedCloseNote : "");
    setClosePreview(true);
    setCloseError(null);
    setCloseLoading(false);
    if (kind !== "complete" || !onGenerateSummary) return;
    const cached = closeSummaryCache.get(issue.issueId);
    if (cached?.key === progressCacheKey) {
      setCloseNote(cached.summary);
      return;
    }
    setCloseLoading(true);
    const pending = closeSummaryRequests.get(issue.issueId);
    let request: Promise<string>;
    if (pending?.key === progressCacheKey) {
      request = pending.promise;
    } else {
      request = onGenerateSummary(issue.issueId);
      closeSummaryRequests.set(issue.issueId, {
        key: progressCacheKey,
        promise: request,
      });
      void request.then(
        () => {
          const current = closeSummaryRequests.get(issue.issueId);
          if (current?.promise === request) {
            closeSummaryRequests.delete(issue.issueId);
          }
        },
        () => {
          const current = closeSummaryRequests.get(issue.issueId);
          if (current?.promise === request) {
            closeSummaryRequests.delete(issue.issueId);
          }
        },
      );
    }
    void request
      .then((summary) => {
        const next = summary.trim();
        if (!next) return;
        // Cache even if the dialog was closed while the request was in flight.
        closeSummaryCache.set(issue.issueId, {
          key: progressCacheKey,
          summary: next,
        });
        if (closeRequestRef.current !== requestId) return;
        // Only replace the fallback if the user has not started editing it.
        setCloseNote((current) =>
          current === suggestedCloseNote ? next : current,
        );
      })
      .catch(() => {
        // Fall back to the latest progress note; the dialog stays usable.
      })
      .finally(() => {
        if (closeRequestRef.current === requestId) setCloseLoading(false);
      });
  };

  const submitClose = async (): Promise<void> => {
    if (!closeKind || closeBusy) return;
    const note = closeNote.trim();
    if (!note) return;
    setCloseBusy(true);
    setCloseError(null);
    try {
      if (closeKind === "complete") {
        await onCompleteIssue?.(issue.issueId, note);
      } else {
        await onCancelIssue?.(issue.issueId, note);
      }
      window.postMessage(
        {
          command: "showToast",
          toast: {
            id: `issue-${closeKind}-${issue.issueId}`,
            message:
              closeKind === "complete"
                ? `已完成「${issue.title}」`
                : `已取消「${issue.title}」`,
            actionLabel: "撤销",
            action: { type: "undoIssueClose", issueId: issue.issueId },
            autoDismissMs: 5000,
          },
        },
        "*",
      );
      setCloseKind(null);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloseBusy(false);
    }
  };

  const loadAllUpdates = async (): Promise<void> => {
    if (updatesExpanded) {
      setUpdatesExpanded(false);
      return;
    }
    if (!onLoadUpdates || loadingUpdates) return;
    setLoadingUpdates(true);
    try {
      const page = await onLoadUpdates(issue.issueId, { limit: 30 });
      setExtraUpdates(page.updates);
      setUpdatesExpanded(true);
    } finally {
      setLoadingUpdates(false);
    }
  };

  const resolvePermission = async (decision: "allow" | "deny"): Promise<void> => {
    if (!permissionUpdate?.permissionId || !permissionUpdate.sessionId || !onRespondPermission) {
      return;
    }
    const permissionId = permissionUpdate.permissionId;
    setResolvingPermission(permissionId);
    setPermissionError(null);
    try {
      await onRespondPermission(
        permissionUpdate.sessionId,
        permissionId,
        decision,
      );
      setResolvedPermissions((current) => new Set(current).add(permissionId));
    } catch (err) {
      setPermissionError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingPermission(null);
    }
  };

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
          {closable && (onCompleteIssue || onCancelIssue) ? (
            <div className="dock-detail-close-actions">
              {onCompleteIssue ? (
                <Tooltip text="完成" position="bottom" wrap={false}>
                  <button
                    type="button"
                    className="dock-detail-complete"
                    aria-label="完成"
                    onClick={() => openClose("complete")}
                  >
                    <i className="codicon codicon-check" aria-hidden />
                  </button>
                </Tooltip>
              ) : null}
              {onCancelIssue ? (
                <Tooltip text="取消" position="bottom" wrap={false}>
                  <button
                    type="button"
                    className="dock-detail-cancel"
                    aria-label="取消"
                    onClick={() => openClose("cancel")}
                  >
                    <i className="codicon codicon-close" aria-hidden />
                  </button>
                </Tooltip>
              ) : null}
            </div>
          ) : null}
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
            {primaryUpdate ? (
              <section className="dock-detail-progress" data-testid="dock-detail-progress">
                <div className="dock-detail-progress-head">
                  <span className="dock-detail-section">
                    {primaryUpdate.kind === "turn" ? "最近状态" : "最新进展"}
                  </span>
                  <span className="dock-detail-progress-time">
                    {formatUpdateTime(primaryUpdate.at)}
                  </span>
                </div>
                {latestExpanded && primaryUpdate.detail ? (
                  <div className="dock-detail-progress-full">
                    <DetailMarkdown text={primaryUpdate.detail} />
                  </div>
                ) : (
                  <p
                    className={
                      latestHasMore && !latestExpanded
                        ? "dock-detail-progress-text is-clamped"
                        : "dock-detail-progress-text"
                    }
                  >
                    {primaryUpdate.summary}
                  </p>
                )}
                {latestHasMore ? (
                  <button
                    type="button"
                    className="dock-detail-progress-more"
                    onClick={() => setLatestExpanded((value) => !value)}
                  >
                    {latestExpanded ? "收起" : "展开全文"}
                  </button>
                ) : null}
                {primaryUpdate.kind === "turn" ? (
                  <p className="dock-detail-progress-note">
                    这一轮的文字结论在会话里；这里只记系统状态。
                  </p>
                ) : null}
                {nextStep ? (
                  <div className="dock-detail-next">
                    <span>下一步</span>
                    <p>{nextStep}</p>
                  </div>
                ) : null}
                {artifactFiles.length > 0 ? (
                  <div className="dock-detail-artifacts-inline" data-testid="dock-detail-artifacts">
                    <span className="dock-detail-artifacts-label">产物</span>
                    {artifactFiles.map((filePath) => (
                      <div
                        key={filePath}
                        className="dock-detail-artifact-row"
                        title={filePath}
                      >
                        <FileIcon
                          name={fileName(filePath)}
                          className="dock-detail-file-chip-icon"
                        />
                        <button
                          type="button"
                          className="dock-detail-artifact-name"
                          onClick={() => onOpenArtifact?.(filePath)}
                        >
                          {fileName(filePath)}
                        </button>
                        <button
                          type="button"
                          className="dock-detail-artifact-action"
                          aria-label="打开文件"
                          title="打开文件"
                          onClick={() => onOpenArtifact?.(filePath)}
                        >
                          <i className="codicon codicon-go-to-file" aria-hidden />
                        </button>
                        {isHtmlPreviewPath(filePath) ? (
                          <button
                            type="button"
                            className="dock-detail-artifact-action"
                            aria-label="在浏览器中打开"
                            title="在浏览器中打开"
                            onClick={() => onOpenArtifactInBrowser?.(filePath)}
                          >
                            <i className="codicon codicon-globe" aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {permissionUpdate ? (
              <section className="dock-detail-permission" data-testid="dock-detail-permission">
                <div className="dock-detail-progress-head">
                  <span className="dock-detail-section">待你批准</span>
                  <span className="dock-detail-progress-time">
                    {formatUpdateTime(permissionUpdate.at)}
                  </span>
                </div>
                <p className="dock-detail-progress-text">{permissionUpdate.summary}</p>
                {permissionUpdate.detail ? (
                  <p className="dock-detail-progress-note">{permissionUpdate.detail}</p>
                ) : null}
                <div className="dock-detail-permission-actions">
                  <button
                    type="button"
                    className="dock-detail-permission-allow"
                    disabled={resolvingPermission !== null}
                    onClick={() => void resolvePermission("allow")}
                  >
                    允许
                  </button>
                  <button
                    type="button"
                    className="dock-detail-permission-deny"
                    disabled={resolvingPermission !== null}
                    onClick={() => void resolvePermission("deny")}
                  >
                    拒绝
                  </button>
                </div>
                {permissionError ? (
                  <p className="dock-detail-permission-error">{permissionError}</p>
                ) : null}
              </section>
            ) : null}

            {changedFiles.length > 0 ? (
              <section className="dock-detail-changes" data-testid="dock-detail-changes">
                <div className="dock-detail-progress-head">
                  <span className="dock-detail-section">本轮改动</span>
                  <span className="dock-detail-progress-time">
                    {changedFiles.length} 个文件
                  </span>
                </div>
                <div className="dock-detail-file-list">
                  {changedFiles.map((filePath) => (
                    <button
                      key={filePath}
                      type="button"
                      className="dock-detail-file-row"
                      title={filePath}
                      onClick={() => onOpenChangedFile?.(filePath)}
                    >
                      <span className="dock-detail-file-icon dock-detail-file-icon--change" aria-hidden>
                        <i className="codicon codicon-diff-modified" />
                      </span>
                      <span className="dock-detail-file-name">{fileName(filePath)}</span>
                      <span className="dock-detail-file-action">查看代码</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {visibleUpdates.length === 1 && visibleUpdates[0].kind === "status" ? (
              <div className="dock-detail-status-line" data-testid="dock-detail-status-line">
                <span>{formatUpdateTime(visibleUpdates[0].at)}</span>
                <span>状态</span>
                <span>{visibleUpdates[0].summary}</span>
              </div>
            ) : visibleUpdates.length > 0 ? (
              <section className="dock-detail-timeline" data-testid="dock-detail-timeline">
                <div className="dock-detail-progress-head">
                  <span className="dock-detail-section">进展</span>
                  <span className="dock-detail-progress-time">
                    {visibleUpdates.length} 条
                  </span>
                  {canLoadMore ? (
                    <button
                      type="button"
                      className="dock-detail-updates-more"
                      disabled={loadingUpdates}
                      onClick={() => void loadAllUpdates()}
                    >
                      {loadingUpdates ? "加载中…" : updatesExpanded ? "收起" : "查看全部"}
                    </button>
                  ) : null}
                </div>
                <ol className="dock-detail-update-list">
                  {visibleUpdates.map((update) => (
                    <li key={update.id} data-kind={update.kind}>
                      <span className="dock-detail-update-time">{formatUpdateTime(update.at)}</span>
                      <span className="dock-detail-update-kind">{UPDATE_KIND_LABEL[update.kind]}</span>
                      <span className="dock-detail-update-text">{update.summary}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {description ? (
              <Disclosure
                key={`${issue.issueId}:${updates.length === 0 ? "open" : "closed"}`}
                className="dock-detail-description"
                testId="dock-detail-description"
                title="任务说明"
                preview={descriptionPreview}
                defaultOpen={updates.length === 0}
              >
                <div className="dock-detail-description-body">
                  <DetailMarkdown text={description} />
                </div>
              </Disclosure>
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

      {closeKind ? (
        <ConfirmDialog
          title={
            closeKind === "complete"
              ? `完成「${issue.title}」？`
              : `取消「${issue.title}」？`
          }
          description={
            closeKind === "complete"
              ? "结果说明会写进这条 Issue 的最终进展。"
              : "取消原因会写进这条 Issue 的最终进展。"
          }
          confirmText={closeKind === "complete" ? "完成" : "取消 Issue"}
          confirmDisabled={closeBusy || closeLoading || !closeNote.trim()}
          onCancel={() => {
            closeRequestRef.current += 1;
            setCloseLoading(false);
            if (!closeBusy) setCloseKind(null);
          }}
          onConfirm={() => void submitClose()}
        >
          <div className="dock-detail-close-tabs">
            <button
              type="button"
              className={closePreview ? "is-active" : undefined}
              aria-pressed={closePreview}
              onClick={() => setClosePreview(true)}
            >
              预览
            </button>
            <button
              type="button"
              className={!closePreview ? "is-active" : undefined}
              aria-pressed={!closePreview}
              onClick={() => setClosePreview(false)}
            >
              编辑
            </button>
          </div>
          {closePreview ? (
            <div className="dock-detail-close-preview" data-testid="dock-detail-close-preview">
              {closeNote.trim() ? (
                <DetailMarkdown text={closeNote} />
              ) : (
                <p className="dock-detail-close-empty">
                  {closeKind === "complete" ? "还没有结果说明" : "还没有取消原因"}
                </p>
              )}
            </div>
          ) : (
            <textarea
              className="dock-detail-close-note"
              data-testid="dock-detail-close-note"
              value={closeNote}
              onChange={(event) => setCloseNote(event.target.value)}
              placeholder={
                closeKind === "complete" ? "一句结果结论" : "一句取消原因"
              }
              autoFocus
            />
          )}
          {closeLoading ? (
            <p className="dock-detail-close-loading" data-testid="dock-detail-close-loading">
              <span className="dock-detail-close-spinner" aria-hidden />
              正在让事项 AI 生成总结…
            </p>
          ) : null}
          {closeError ? (
            <p className="dock-detail-close-error">{closeError}</p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function CheckItem({
  item,
}: {
  item: DesktopIssueGroup["items"][number];
}) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || open) return;
    const measure = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [item.content, open]);

  return (
    <li data-status={item.status} data-expanded={open ? "true" : "false"}>
      <span className="dock-detail-check-badge">
        {CHECK_STATUS_LABEL[item.status] ?? item.status}
      </span>
      <div
        ref={bodyRef}
        className={open ? "dock-detail-check-body" : "dock-detail-check-body is-collapsed"}
        onClick={() => {
          if (!open && overflows) setOpen(true);
        }}
      >
        <DetailMarkdown text={item.content} />
      </div>
      {overflows ? (
        <button
          type="button"
          className="dock-detail-check-more"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "收起" : "查看"}
        </button>
      ) : null}
    </li>
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
          <CheckItem key={item.id} item={item} />
        ))}
      </ol>
    </section>
  );
}

