import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { DesktopIssueGroup, DesktopIssueUpdate } from "../../types";
import { issueSidebarStatusLabel } from "../../utils/issueStatusLabel";
import { FileChip } from "../shared/FileChip";
import { IssueRowContent, type BotListIssue } from "./BotLists";
import { Disclosure } from "../shared/Disclosure";
import type { IssuePresence } from "../session/SessionStatusGlyph";
import { MarkdownView } from "../message/MarkdownView";
import { Tooltip } from "../shared/Tooltip";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import { issueTabSessionId } from "./botWorkspace";
import { beginSplitDrag, widthFromLeftEdge } from "../../muse/splitDrag";

/** Issue column. Docked to the right of the detail pane, like the other panel rails. */
export const DOCK_DETAIL_RAIL_WIDTH = 232;
export const DOCK_DETAIL_RAIL_MIN_WIDTH = 200;
export const DOCK_DETAIL_RAIL_MAX_WIDTH = 360;
/** Narrowest readable detail column left beside the rail. */
export const DOCK_DETAIL_RAIL_MIN_CONTENT = 520;

const RAIL_WIDTH_STORAGE_KEY = "muse.dockDetailRailWidth";
/** Must match the server's first archive page. */
const CLOSED_ISSUE_PAGE_SIZE = 20;

/** Keep the rail wide enough to read and narrow enough to leave the detail room. */
export function clampDockDetailRailWidth(value: number, paneWidth = 0): number {
  const maxByPane =
    paneWidth > 0
      ? Math.max(
          DOCK_DETAIL_RAIL_MIN_WIDTH,
          paneWidth - DOCK_DETAIL_RAIL_MIN_CONTENT,
        )
      : DOCK_DETAIL_RAIL_MAX_WIDTH;
  const max = Math.min(DOCK_DETAIL_RAIL_MAX_WIDTH, maxByPane);
  return Math.min(max, Math.max(DOCK_DETAIL_RAIL_MIN_WIDTH, Math.round(value)));
}

/** True when the dock can hold the issue column without squeezing the detail. */
export function dockDetailRailFits(
  width: number,
  railWidth = DOCK_DETAIL_RAIL_WIDTH,
): boolean {
  if (width <= 0) return false;
  return width >= railWidth + DOCK_DETAIL_RAIL_MIN_CONTENT;
}

function railWidthPersistenceEnabled(): boolean {
  try {
    return process.env.NODE_ENV !== "test";
  } catch {
    return true;
  }
}

export function readDockDetailRailWidth(): number {
  if (!railWidthPersistenceEnabled()) return DOCK_DETAIL_RAIL_WIDTH;
  try {
    const raw = globalThis.localStorage?.getItem(RAIL_WIDTH_STORAGE_KEY);
    const value = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(value)
      ? clampDockDetailRailWidth(value)
      : DOCK_DETAIL_RAIL_WIDTH;
  } catch {
    return DOCK_DETAIL_RAIL_WIDTH;
  }
}

function saveDockDetailRailWidth(value: number): void {
  if (!railWidthPersistenceEnabled()) return;
  try {
    globalThis.localStorage?.setItem(RAIL_WIDTH_STORAGE_KEY, String(value));
  } catch {
    /* private mode / blocked storage */
  }
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
  /** Closed issues only: completion time used to group the archive. */
  closedAt?: number;
  /** Closed issues only: raw status, used to build the local read-only preview. */
  status?: string;
  closeNote?: string;
  workdir?: string;
  baseBranch?: string;
  /** Cancelled issues stay out of the rail until 显示已取消 is on. */
  cancelled?: boolean;
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

/** The tree carries no long-form body; fetch it on demand and key by updatedAt. */
type ClosedIssueDetail = {
  issueId: string;
  description: string;
  items: DesktopIssueGroup["items"];
};
const closedIssueDetails = new Map<string, ClosedIssueDetail>();
const closedIssueDetailRequests = new Map<string, Promise<ClosedIssueDetail>>();

function loadClosedIssueDetail(
  load: (issueId: string) => Promise<{
    description?: string;
    items?: DesktopIssueGroup["items"];
  }>,
  issueId: string,
  cacheKey: string,
): Promise<ClosedIssueDetail> {
  const cached = closedIssueDetails.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  const pending = closedIssueDetailRequests.get(cacheKey);
  if (pending) return pending;
  const request = load(issueId)
    .then((detail) => {
      const next: ClosedIssueDetail = {
        issueId,
        description: detail.description ?? "",
        items: detail.items ?? [],
      };
      closedIssueDetails.set(cacheKey, next);
      return next;
    })
    .finally(() => {
      closedIssueDetailRequests.delete(cacheKey);
    });
  closedIssueDetailRequests.set(cacheKey, request);
  return request;
}

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
  /** Completed / cancelled issues, folded under 已完成 in the same rail. */
  closedIssues?: DockDetailIssue[];
  onSelectIssue?: (issueId: string) => void;
  /** 已结束事项按页加载；不一次拉回整个归档。 */
  onLoadClosedIssues?: (
    offset: number,
    limit: number,
  ) => Promise<{
    issues: DockDetailIssue[];
    hasMore: boolean;
    total: number;
  }>;
  /** 点击本轮改动文件：打开 diff。 */
  onOpenChangedFile?: (path: string) => void;
  /** 点击产物附件：图片看大图（同组图片可左右切换）、HTML 进浏览器、其余开文件。 */
  onOpenArtifact?: (
    path: string,
    workdir?: string,
    /** 当前展示的全部产物路径，图片预览用它组画廊。 */
    gallery?: string[],
  ) => void;
  /** 已结束 Issue 的描述 / 清单不在 grouped 接口里，选中后按需拉取。 */
  onLoadIssue?: (issueId: string) => Promise<{
    description?: string;
    items?: DesktopIssueGroup["items"];
  }>;
  /** 加载这个 Issue 的完整进展（详情默认只拿到最近 8 条）。 */
  onLoadUpdates?: (
    issueId: string,
    opts?: { limit?: number; before?: string },
  ) => Promise<{ updates: DesktopIssueUpdate[]; hasMore: boolean }>;
  /** 当前会话里仍未处理的审批；用来立刻隐藏已经批过的旧卡。 */
  pendingPermissionIds?: ReadonlySet<string>;
  currentSessionId?: string;
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

function completionDateLabel(at: number, now: number): string {
  if (!at) return "更早";
  const date = new Date(at);
  const today = new Date(now);
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const dayDiff = Math.round(
    (startOfDay(today) - startOfDay(date)) / 86_400_000,
  );
  if (dayDiff <= 0) return "今天";
  if (dayDiff === 1) return "昨天";
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === today.getFullYear()
    ? monthDay
    : `${date.getFullYear()}年${monthDay}`;
}

function groupByCompletionDate(
  issues: DockDetailIssue[],
): Array<{ label: string; issues: DockDetailIssue[] }> {
  const now = Date.now();
  const groups = new Map<string, DockDetailIssue[]>();
  const sorted = [...issues].sort(
    (a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0),
  );
  for (const issue of sorted) {
    const label = completionDateLabel(issue.closedAt ?? 0, now);
    const rows = groups.get(label);
    if (rows) rows.push(issue);
    else groups.set(label, [issue]);
  }
  return [...groups].map(([label, rows]) => ({ label, issues: rows }));
}

function RailRow({
  issue,
  current,
  closed = false,
  onSelect,
}: {
  issue: DockDetailIssue;
  current: boolean;
  closed?: boolean;
  onSelect: (issueId: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`dock-detail-rail-row${closed ? " dock-detail-rail-row--closed" : ""}`}
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
}

function IssueRail({
  issues,
  closedIssues,
  currentId,
  mode,
  open,
  railWidth,
  onSelect,
  onSelectClosed,
  onResizeStart,
  onLoadMore,
  loadingMore = false,
  hasMore = false,
}: {
  issues: DockDetailIssue[];
  closedIssues: DockDetailIssue[];
  currentId: string;
  mode: "column" | "peek";
  open: boolean;
  railWidth: number;
  onSelect: (issueId: string) => void;
  onSelectClosed: (issueId: string) => void;
  onResizeStart?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  hasMore?: boolean;
}) {
  const [closedOpen, setClosedOpen] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);
  const collapsed = mode === "column" && !open;
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (collapsed) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [collapsed]);
  const completed = closedIssues.filter((issue) => !issue.cancelled);
  const cancelled = closedIssues.filter((issue) => issue.cancelled);
  const completedGroups = groupByCompletionDate(completed);
  const cancelledGroups = groupByCompletionDate(cancelled);
  return (
    <aside
      className={`dock-detail-rail${mode === "peek" ? " dock-detail-rail--peek" : ""}${mode === "column" && !open ? " dock-detail-rail--collapsed" : ""}`}
      data-testid="dock-detail-rail"
      data-mode={mode}
      data-open={open ? "true" : "false"}
      style={
        mode === "peek"
          ? ({ "--dock-detail-rail-width": `${railWidth}px` } as CSSProperties)
          : undefined
      }
      aria-label="事项"
      aria-hidden={mode === "column" && !open ? true : undefined}
    >
      <div className="dock-detail-rail-inner" ref={innerRef}>
        <h3 className="dock-detail-rail-title">
          事项
          <span>{issues.length}</span>
        </h3>
        <div className="dock-detail-rail-body">
          <ul className="dock-detail-rail-rows">
            {issues.map((issue) => (
              <RailRow
                key={issue.issueId}
                issue={issue}
                current={issue.issueId === currentId}
                onSelect={onSelect}
              />
            ))}
          </ul>
          {closedIssues.length > 0 ? (
            <section className="dock-detail-rail-closed">
              <button
                type="button"
                className="dock-detail-rail-closed-toggle"
                data-testid="dock-detail-rail-closed-toggle"
                aria-expanded={closedOpen}
                onClick={() => setClosedOpen((value) => !value)}
              >
                <span className="dock-detail-rail-closed-label">已完成</span>
                <span className="dock-detail-rail-closed-count">
                  {completed.length}
                  {hasMore ? "+" : ""}
                </span>
                <i
                  className={`codicon codicon-chevron-${closedOpen ? "down" : "right"}`}
                  aria-hidden
                />
              </button>
              {closedOpen ? (
                <div data-testid="dock-detail-rail-closed-rows">
                  {completedGroups.map((group) => (
                    <div className="dock-detail-rail-date" key={group.label}>
                      <div className="dock-detail-rail-date-label">
                        {group.label}
                      </div>
                      <ul className="dock-detail-rail-rows">
                        {group.issues.map((issue) => (
                          <RailRow
                            key={issue.issueId}
                            issue={issue}
                            current={issue.issueId === currentId}
                            closed
                            onSelect={onSelectClosed}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                  {cancelled.length > 0 ? (
                    <>
                      {showCancelled ? (
                        <div data-testid="dock-detail-rail-cancelled">
                          {cancelledGroups.map((group) => (
                            <div
                              className="dock-detail-rail-date"
                              key={`cancelled-${group.label}`}
                            >
                              <div className="dock-detail-rail-date-label">
                                已取消 · {group.label}
                              </div>
                              <ul className="dock-detail-rail-rows">
                                {group.issues.map((issue) => (
                                  <RailRow
                                    key={issue.issueId}
                                    issue={issue}
                                    current={issue.issueId === currentId}
                                    closed
                                    onSelect={onSelectClosed}
                                  />
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="dock-detail-rail-cancelled-toggle"
                        data-testid="dock-detail-rail-cancelled-toggle"
                        aria-expanded={showCancelled}
                        onClick={() => setShowCancelled((value) => !value)}
                      >
                        {showCancelled
                          ? "隐藏已取消"
                          : `显示已取消 ${cancelled.length}`}
                      </button>
                    </>
                  ) : null}
                  {hasMore ? (
                    <button
                      type="button"
                      className="dock-detail-rail-load-more"
                      data-testid="dock-detail-rail-load-more"
                      disabled={loadingMore}
                      onClick={onLoadMore}
                    >
                      {loadingMore ? "加载中…" : "加载更多"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
      {mode === "column" ? (
        <div
          className="dock-detail-rail-resize"
          data-testid="dock-detail-rail-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整事项列表宽度"
          onPointerDown={onResizeStart}
        />
      ) : null}
    </aside>
  );
}

function dockIssueToGroup(issue: DockDetailIssue): DesktopIssueGroup {
  return {
    issueId: issue.issueId,
    title: issue.title,
    description: "",
    priority: issue.priority ?? "p1",
    ...(issue.type ? { type: issue.type } : {}),
    status:
      issue.status ?? (issue.cancelled ? "cancelled" : "completed"),
    items: [],
    ...(issue.closeNote ? { closeNote: issue.closeNote } : {}),
    ...(issue.closedAt !== undefined ? { closedAt: issue.closedAt } : {}),
    ...(issue.closedAt !== undefined ? { updatedAt: issue.closedAt } : {}),
    ...(issue.workdir ? { workdir: issue.workdir } : {}),
    ...(issue.baseBranch ? { baseBranch: issue.baseBranch } : {}),
    sessions: [],
  };
}

export function DockDetail({
  selection: selectionProp,
  actionLabel,
  onOpenSession,
  onOpenInEditor,
  onRevealInFinder,
  issues = [],
  closedIssues = [],
  onSelectIssue,
  onLoadClosedIssues,
  onOpenChangedFile,
  onOpenArtifact,
  onLoadIssue,
  onLoadUpdates,
  pendingPermissionIds,
  currentSessionId,
  onCompleteIssue,
  onCancelIssue,
  onGenerateSummary,
}: DockDetailProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLDivElement>(null);
  // A closed issue is previewed locally: it must not replace the current issue
  // or its tab. The parent selection still drives the rest of the workspace.
  const [previewIssue, setPreviewIssue] = useState<DesktopIssueGroup | null>(null);
  const selection: DockDetailSelection = previewIssue
    ? { kind: "issue", issue: previewIssue }
    : selectionProp;
  const width = useBoxWidth(rootRef, selection.kind);
  const [railWidth, setRailWidth] = useState(readDockDetailRailWidth);
  // A persisted width from a wider window must not hide the rail in a smaller
  // one; clamp it for this pane without overwriting the preference.
  const effectiveRailWidth = clampDockDetailRailWidth(railWidth, width);
  const fits = dockDetailRailFits(width, effectiveRailWidth);
  const [open, setOpen] = useState(true);
  const [peek, setPeek] = useState(false);
  const [loadedIssue, setLoadedIssue] = useState<ClosedIssueDetail | null>(null);
  const [closedLoading, setClosedLoading] = useState(false);
  const [extraClosedIssues, setExtraClosedIssues] = useState<DockDetailIssue[]>([]);
  const [closedHasMore, setClosedHasMore] = useState(
    closedIssues.length >= CLOSED_ISSUE_PAGE_SIZE,
  );
  const [closedMoreLoading, setClosedMoreLoading] = useState(false);
  const [latestExpanded, setLatestExpanded] = useState(false);
  const [extraUpdates, setExtraUpdates] = useState<DesktopIssueUpdate[]>([]);
  const [updatesExpanded, setUpdatesExpanded] = useState(false);
  const [updatesLoaded, setUpdatesLoaded] = useState(false);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [closeKind, setCloseKind] = useState<"complete" | "cancel" | null>(null);
  const [closeNote, setCloseNote] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeLoading, setCloseLoading] = useState(false);
  const [closePreview, setClosePreview] = useState(true);
  const closeRequestRef = useRef(0);
  const closedKey = closedIssues.map((issue) => issue.issueId).join("\0");
  const allClosedIssues = useMemo(() => {
    const byId = new Map<string, DockDetailIssue>();
    for (const issue of [...closedIssues, ...extraClosedIssues]) {
      byId.set(issue.issueId, issue);
    }
    return [...byId.values()].sort(
      (a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0),
    );
  }, [closedIssues, extraClosedIssues]);
  const parentSelectionKey =
    selectionProp.kind === "issue"
      ? `issue:${selectionProp.issue.issueId}`
      : selectionProp.kind;
  const railCurrentId =
    previewIssue?.issueId ??
    (selectionProp.kind === "issue" ? selectionProp.issue.issueId : "");
  const railIssues = issues.length + allClosedIssues.length;
  // The empty page always offers the list: a column when it fits, otherwise
  // the same peek overlay used by a narrow dock.
  const emptyPage = selectionProp.kind === "none" && previewIssue === null;
  const columnVisible =
    railIssues > 0 && fits && (emptyPage || selection.kind === "issue");
  const showColumn = columnVisible && (open || emptyPage);
  const showPeek =
    railIssues > 0 &&
    !fits &&
    (emptyPage || (peek && selection.kind === "issue"));

  useEffect(() => {
    setPreviewIssue(null);
  }, [parentSelectionKey]);

  useEffect(() => {
    setExtraClosedIssues([]);
    setClosedHasMore(closedIssues.length >= CLOSED_ISSUE_PAGE_SIZE);
    setClosedMoreLoading(false);
  }, [closedKey]);

  const selectOpenIssue = (issueId: string) => {
    if (emptyPage) setOpen(true);
    setPreviewIssue(null);
    onSelectIssue?.(issueId);
  };

  const selectClosedIssue = (issueId: string) => {
    const issue = allClosedIssues.find((item) => item.issueId === issueId);
    if (!issue) return;
    if (emptyPage) setOpen(true);
    setPreviewIssue(dockIssueToGroup(issue));
    // Keep the overlay open in a narrow dock so the list does not vanish when
    // the read-only preview takes over the detail pane.
    if (!fits) setPeek(true);
  };

  const loadMoreClosedIssues = async (): Promise<void> => {
    if (!onLoadClosedIssues || closedMoreLoading || !closedHasMore) return;
    setClosedMoreLoading(true);
    try {
      const page = await onLoadClosedIssues(
        allClosedIssues.length,
        CLOSED_ISSUE_PAGE_SIZE,
      );
      setExtraClosedIssues((current) => [...current, ...page.issues]);
      setClosedHasMore(page.hasMore);
    } catch {
      /* Keep the button so the user can retry. */
    } finally {
      setClosedMoreLoading(false);
    }
  };

  const selectedIssue = selection.kind === "issue" ? selection.issue : undefined;
  const selectedIssueId = selectedIssue?.issueId ?? "";
  // Open and closed issues both arrive without their body now; short
  // descriptions may still ride in older payloads, so only fetch when blank.
  const selectedNeedsBody = selectedIssue
    ? !selectedIssue.description?.trim()
    : false;
  const selectedBodyKey = `${selectedIssueId}:${selectedIssue?.descriptionUpdatedAt ?? 0}`;

  useEffect(() => {
    if (fits) setPeek(false);
  }, [fits]);

  useEffect(() => {
    setLoadedIssue(null);
    setClosedLoading(false);
  }, [selectedIssueId]);

  useEffect(() => {
    if (!selectedNeedsBody || !selectedIssueId || !onLoadIssue) return;
    let cancelled = false;
    const cached = closedIssueDetails.get(selectedBodyKey);
    if (cached) {
      setLoadedIssue(cached);
      setClosedLoading(false);
      return;
    }
    setClosedLoading(true);
    loadClosedIssueDetail(onLoadIssue, selectedIssueId, selectedBodyKey)
      .then((detail) => {
        if (!cancelled) setLoadedIssue(detail);
      })
      .catch(() => {
        const empty: ClosedIssueDetail = {
          issueId: selectedIssueId,
          description: "",
          items: [],
        };
        // Show the fallback, but do not cache a failed fetch: the effect only
        // reruns when the body key changes, so a reopen should get a retry.
        if (!cancelled) setLoadedIssue(empty);
      })
      .finally(() => {
        if (!cancelled) setClosedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onLoadIssue, selectedBodyKey, selectedIssueId, selectedNeedsBody]);

  useEffect(() => {
    setLatestExpanded(false);
    setExtraUpdates([]);
    setUpdatesExpanded(false);
    setUpdatesLoaded(false);
    setCloseKind(null);
    setCloseNote("");
    setCloseBusy(false);
    setCloseError(null);
    setCloseLoading(false);
    setClosePreview(true);
    closeRequestRef.current += 1;
  }, [selection.kind === "issue" ? selection.issue.issueId : ""]);

  useEffect(() => {
    // The empty page has no toolbar to reopen the list, so its auto-peek stays.
    if (!showPeek || emptyPage) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (railRef.current?.contains(target)) return;
      if (toggleRef.current?.contains(target)) return;
      setPeek(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [emptyPage, showPeek]);

  const beginRailResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = effectiveRailWidth;
    const paneWidth = width;
    beginSplitDrag(event, {
      startValue: startWidth,
      value: (moveEvent) =>
        widthFromLeftEdge(startX, startWidth, moveEvent, (next) =>
          clampDockDetailRailWidth(next, paneWidth),
        ),
      preview: (next) => {
        stageRef.current?.style.setProperty(
          "--dock-detail-rail-width",
          `${next}px`,
        );
      },
      commit: (next) => {
        const clamped = clampDockDetailRailWidth(next, paneWidth);
        setRailWidth(clamped);
        saveDockDetailRailWidth(clamped);
      },
    });
  };

  const renderRail = (mode: "column" | "peek", railW: number, isOpen: boolean) => (
    <IssueRail
      issues={issues}
      closedIssues={allClosedIssues}
      currentId={railCurrentId}
      mode={mode}
      open={isOpen}
      railWidth={railW}
      onSelect={(issueId) => {
        selectOpenIssue(issueId);
        setPeek(false);
      }}
      onSelectClosed={selectClosedIssue}
      onResizeStart={beginRailResize}
      onLoadMore={() => void loadMoreClosedIssues()}
      loadingMore={closedMoreLoading}
      hasMore={closedHasMore}
    />
  );

  if (selection.kind === "none") {
    return (
      <div className="dock-detail" data-testid="dock-detail" ref={rootRef}>
        <div
          className="dock-detail-stage"
          ref={stageRef}
          style={
            {
              "--dock-detail-rail-width": `${effectiveRailWidth}px`,
            } as CSSProperties
          }
        >
          <div className="dock-detail-scroll dock-detail-scroll--empty">
            <div className="dock-detail-empty" data-testid="dock-detail-empty">
              <i className="codicon codicon-note" aria-hidden />
              <p>选择一个事项查看详情</p>
            </div>
          </div>
          {showColumn ? renderRail("column", effectiveRailWidth, true) : null}
          {showPeek ? (
            <div ref={railRef}>
              {renderRail("peek", railWidth, true)}
            </div>
          ) : null}
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
  const closed = issue.status === "completed" || issue.status === "cancelled";
  const status = closed
    ? issue.status === "cancelled"
      ? "已取消"
      : "已完成"
    : issueSidebarStatusLabel({
        status: issue.status,
        agentMode: issue.agentMode,
        running: issue.sessions.some((session) => session.running),
        sessionStatus: issue.sessions.find((session) => session.sessionStatus)
          ?.sessionStatus,
      });
  const loadedForIssue =
    loadedIssue?.issueId === issue.issueId ? loadedIssue : null;
  const description =
    loadedForIssue?.description?.trim() || issue.description?.trim() || "";
  const checklistItems = loadedForIssue?.items ?? issue.items;
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
  // The expand/collapse control is about timeline rows, not the raw update
  // count: hidden turn rows can make "查看全部" fetch more data without adding
  // a single visible row. Do not leave a dead "收起" behind for that case.
  const canLoadMore =
    Boolean(onLoadUpdates) &&
    (timelineUpdates.length > 8 ||
      (!updatesLoaded &&
        (issue.updateCount ?? baseUpdates.length) > baseUpdates.length));
  const permissionUpdate = updates.find((update) => {
    if (
      update.kind !== "permission" ||
      !update.permissionId ||
      !update.sessionId ||
      update.resolved
    ) {
      return false;
    }
    if (
      updates.some(
        (entry) =>
          entry.kind === "status" &&
          entry.permissionId === update.permissionId,
      )
    ) {
      return false;
    }
    // The live confirmation list is authoritative for the session on screen.
    // Old progress rows can lack a resolution record, so do not trust them
    // when we can see that this session is no longer waiting.
    if (
      pendingPermissionIds &&
      currentSessionId &&
      update.sessionId === currentSessionId
    ) {
      return pendingPermissionIds.has(update.permissionId);
    }
    return true;
  });
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
    // Completion reads the generated conclusion; cancellation starts as an
    // editable reason because there is no AI summary to preview.
    setClosePreview(kind === "complete");
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
      setUpdatesLoaded(true);
      setUpdatesExpanded(true);
    } finally {
      setLoadingUpdates(false);
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
          {!closed && closable && (onCompleteIssue || onCancelIssue) ? (
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
          {!closed && actionLabel ? (
            <DetailIconButton
              label={actionLabel}
              onClick={() => onOpenSession(issue.issueId)}
            >
              <i className="codicon codicon-comment" aria-hidden />
            </DetailIconButton>
          ) : null}
          {!closed ? (
            <>
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
            </>
          ) : null}
          {railIssues > 0 ? (
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
      <div
        className="dock-detail-stage"
        ref={stageRef}
        style={
          {
            "--dock-detail-rail-width": `${effectiveRailWidth}px`,
          } as CSSProperties
        }
      >
        <div className="dock-detail-scroll">
          <div className="dock-detail-content">
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
                      <FileChip
                        key={filePath}
                        path={filePath}
                        onOpen={(path) =>
                          onOpenArtifact?.(
                            path,
                            selectedIssue?.workdir,
                            artifactFiles,
                          )
                        }
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {closed && issue.closeNote?.trim() ? (
              <section className="dock-detail-result" data-testid="dock-detail-result">
                <div className="dock-detail-progress-head">
                  <span className="dock-detail-section">
                    {issue.status === "cancelled" ? "取消原因" : "完成结论"}
                  </span>
                </div>
                <DetailMarkdown text={issue.closeNote} />
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
                <p className="dock-detail-progress-note">
                  在对话里的确认框处理这次审批。
                </p>
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
                  ) : updatesLoaded ? (
                    <span className="dock-detail-updates-done">没有更多</span>
                  ) : null}
                </div>
                <ol className="dock-detail-update-list">
                  {visibleUpdates.map((update) => (
                    <li key={update.id} data-kind={update.kind}>
                      <span className="dock-detail-update-time">{formatUpdateTime(update.at)}</span>
                      <span className="dock-detail-update-kind">
                        {update.kind === "permission" && update.resolved
                          ? "已处理"
                          : UPDATE_KIND_LABEL[update.kind]}
                      </span>
                      <span className="dock-detail-update-text">{update.summary}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {closed && closedLoading ? (
              <p
                className="dock-detail-progress-note"
                data-testid="dock-detail-closed-loading"
              >
                正在加载事项描述…
              </p>
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
            {checklistItems.length > 0 ? (
              <Checklist items={checklistItems} />
            ) : null}
          </div>
        </div>
        {columnVisible ? renderRail("column", effectiveRailWidth, showColumn) : null}
        {showPeek ? (
          <div ref={railRef}>
            {renderRail("peek", railWidth, true)}
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

