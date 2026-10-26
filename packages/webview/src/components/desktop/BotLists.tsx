import { useEffect, useRef, useState, type CSSProperties } from "react";
import { IssueTypeIcon } from "../issue/IssueTypeIcon";
import { IssuePresenceMark, type IssuePresence } from "../session/SessionStatusGlyph";
import type { PanelSelection } from "./botWorkspace";
import "./BotLists.css";

/** Fallback when the left panel cannot be measured (jsdom). Live layout uses the panel width. */
export const BOT_LISTS_WIDE_MIN_WIDTH = 1176;

/** Message column shrinks from this width before the cards fold. */
export const BOT_MESSAGE_COLUMN_MAX = 800;
/** Narrowest the message column goes while the cards are still open. */
export const BOT_MESSAGE_COLUMN_MIN = 520;
export const BOT_LIST_SIDE_PADDING = 28;
export const BOT_LIST_CARD_WIDTH = 268;
export const BOT_LIST_CARD_RIGHT = 18;
export const BOT_LIST_RAIL_WIDTH = 52;
/** Clear space between the centered column and the floating card. */
export const BOT_LIST_CARD_GAP = 16;

/** Widest centered column that still leaves the card and a gap beside it. */
export function botListsColumnWidth(panelWidth: number): number {
  const content =
    panelWidth - BOT_LIST_RAIL_WIDTH - BOT_LIST_SIDE_PADDING * 2;
  const gutter = BOT_LIST_CARD_WIDTH + BOT_LIST_CARD_RIGHT - BOT_LIST_SIDE_PADDING;
  return content - gutter * 2 - BOT_LIST_CARD_GAP * 2;
}

/**
 * Cards float on the right and the column stays centered. Narrowing shrinks
 * the column, not the padding. Cards stay until the column reaches its
 * minimum, then they fold.
 */
export function botListsWideForPanel(panelWidth: number): boolean {
  return botListsColumnWidth(panelWidth) >= BOT_MESSAGE_COLUMN_MIN;
}

export type BotListQueueItem = {
  id: string;
  kind: string;
  title: string;
  /** 毫秒时间戳。缺省时行上仍留出空时间。 */
  time?: number;
};

export type BotListIssue = {
  issueId: string;
  title: string;
  priority: string;
  /** bug | feature | research | analysis | review | work。缺省 work。 */
  type?: string;
  /** 侧栏同一套：等待确认、正在运行、未读完成。 */
  presence?: IssuePresence | null;
  /** 进行中 / 空闲 / 失败 / 执行中 等。 */
  statusLabel?: string;
  /** 悬停时盖在行右侧。已经停在这条会话上时为空。 */
  openLabel?: "打开会话" | "切到会话" | null;
};

export interface BotListsProps {
  queue: BotListQueueItem[];
  issues: BotListIssue[];
  selected: PanelSelection;
  wide: boolean;
  menu: "queue" | "todo" | null;
  /** Issue 会话只保留事项。缺省两边都显示。 */
  showQueue?: boolean;
  onSelect: (panel: Exclude<PanelSelection, { kind: "none" }>) => void;
  onOpenIssue?: (issueId: string) => void;
  /** Double-click an issue row to open the right-hand dock. */
  onOpenDock?: () => void;
  onToggleMenu: (menu: "queue" | "todo") => void;
  /** Narrow popover: click outside the trigger and menu to close it. */
  onDismissMenu?: () => void;
}

/** Labels already shown by AssistantPage. Missing type keeps this list's own category. */
export function queueKindLabel(type: string | undefined): string {
  if (type === "chat") return "聊天";
  if (type === "issue") return "Issue";
  if (type === "permission") return "权限";
  if (type === "automation") return "自动化";
  return "待处理";
}

function queueTypeKey(type: unknown): string {
  return typeof type === "string" && type.length > 0 ? type : "";
}

/** Client key for a queue row. A string `id` wins. Otherwise type, title, and
 * how many earlier rows share that pair — not the source-array index, so a
 * different item inserted at the front does not renumber an existing row. */
function queueClientKey(
  item: { id?: unknown; type?: unknown; title: string },
  occurrence: number,
): string {
  if (typeof item.id === "string" && item.id.length > 0) return item.id;
  return `${queueTypeKey(item.type)}\0${item.title}\0${occurrence}`;
}

export function readBotQueue(items: readonly unknown[]): BotListQueueItem[] {
  const seen = new Map<string, number>();
  return items.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as {
      id?: unknown;
      type?: unknown;
      title?: unknown;
      timestamp?: unknown;
    };
    if (typeof item.title !== "string" || item.title.length === 0) return [];
    const type = queueTypeKey(item.type);
    const bucket = `${type}\0${item.title}`;
    const occurrence = seen.get(bucket) ?? 0;
    seen.set(bucket, occurrence + 1);
    const kindType = type.length > 0 ? type : undefined;
    const time = typeof item.timestamp === "number" ? item.timestamp : undefined;
    return [{
      id: queueClientKey(item, occurrence),
      kind: queueKindLabel(kindType),
      title: item.title,
      ...(time !== undefined ? { time } : {}),
    }];
  });
}

export function useBotListsWide(): boolean {
  const query = `(min-width: ${BOT_LISTS_WIDE_MIN_WIDTH}px)`;
  const [wide, setWide] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const sync = () => setWide(media.matches);
    sync();
    media.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, [query]);
  return wide;
}

const columnStyle: CSSProperties = {
  width: 268,
  alignSelf: "flex-start",
  flex: "0 0 auto",
  height: "auto",
  position: "absolute",
  top: 8,
  right: 18,
  zIndex: 3,
};

const cardStyle: CSSProperties = {
  borderRadius: 14,
};

const toolStyle: CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
};

function priorityLabel(priority: string): string {
  return /^p\d$/i.test(priority) ? priority.toUpperCase() : priority;
}

function formatQueueTime(time: number | undefined): string {
  if (typeof time !== "number" || !Number.isFinite(time)) return "";
  const date = new Date(time);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 13.2 6.2 5.8A1.6 1.6 0 0 1 7.7 4.7h8.6a1.6 1.6 0 0 1 1.5 1.1L20 13.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M4 13.2h4.1l1.1 2.2h5.6l1.1-2.2H20V18a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18v-4.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TodoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5.3 7.1 6.4 8.2 8.3 6.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 7h8M12 12h8M12 17h8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect x="4" y="14.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function QueueRows({
  queue,
  selected,
  onSelect,
}: {
  queue: BotListQueueItem[];
  selected: PanelSelection;
  onSelect: BotListsProps["onSelect"];
}) {
  return (
    <ul className="bot-list-rows">
      {queue.map((item) => {
        const current = selected.kind === "queue" && selected.id === item.id;
        return (
          <li key={item.id}>
            <button
              type="button"
              className="bot-list-row"
              aria-current={current ? "true" : undefined}
              onClick={() => onSelect({ kind: "queue", id: item.id })}
            >
              <span className="bot-list-kind">{item.kind}</span>
              <span className="bot-list-title">{item.title}</span>
              <span className="bot-list-time">{formatQueueTime(item.time)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function IssueRows({
  issues,
  selected,
  onSelect,
  onOpenIssue,
  onOpenDock,
}: {
  issues: BotListIssue[];
  selected: PanelSelection;
  onSelect: BotListsProps["onSelect"];
  onOpenIssue?: BotListsProps["onOpenIssue"];
  onOpenDock?: BotListsProps["onOpenDock"];
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  return (
    <ul className="bot-list-rows">
      {issues.map((issue) => {
        const current = selected.kind === "issue" && selected.issueId === issue.issueId;
        const hovered = hoveredId === issue.issueId;
        return (
          <li
            key={issue.issueId}
            className={hovered ? "bot-list-item bot-list-item--hover" : "bot-list-item"}
            onMouseEnter={() => setHoveredId(issue.issueId)}
            onMouseLeave={() =>
              setHoveredId((currentId) => (currentId === issue.issueId ? null : currentId))
            }
          >
            <button
              type="button"
              className="bot-list-row"
              aria-current={current ? "true" : undefined}
              onClick={() => onSelect({ kind: "issue", issueId: issue.issueId })}
              onDoubleClick={() => {
                onSelect({ kind: "issue", issueId: issue.issueId });
                onOpenDock?.();
              }}
            >
              <span className="bot-list-icon-slot">
                <IssueTypeIcon type={issue.type} />
                {issue.presence ? (
                  <span className="issue-sidebar-status-cover" aria-hidden="true">
                    <IssuePresenceMark presence={issue.presence} />
                  </span>
                ) : null}
              </span>
              <span className="bot-list-title">{issue.title}</span>
              {issue.statusLabel ? (
                <span className="bot-list-status">{issue.statusLabel}</span>
              ) : null}
              <span className="bot-list-priority">{priorityLabel(issue.priority)}</span>
            </button>
            {issue.openLabel && onOpenIssue ? (
              <button
                type="button"
                className="bot-list-open"
                onClick={() => onOpenIssue(issue.issueId)}
              >
                {issue.openLabel}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function QueueCard(props: {
  queue: BotListQueueItem[];
  selected: PanelSelection;
  onSelect: BotListsProps["onSelect"];
}) {
  return (
    <section className="bot-list-card" style={cardStyle} aria-label="待处理">
      <h2 className="bot-list-card-title">
        待处理
        <span>{props.queue.length}</span>
      </h2>
      <QueueRows queue={props.queue} selected={props.selected} onSelect={props.onSelect} />
    </section>
  );
}

function TodoCard(props: {
  issues: BotListIssue[];
  selected: PanelSelection;
  onSelect: BotListsProps["onSelect"];
  onOpenIssue?: BotListsProps["onOpenIssue"];
  onOpenDock?: BotListsProps["onOpenDock"];
}) {
  return (
    <section className="bot-list-card" style={cardStyle} aria-label="事项">
      <h2 className="bot-list-card-title">
        事项
        <span>{props.issues.length}</span>
      </h2>
      <IssueRows
        issues={props.issues}
        selected={props.selected}
        onSelect={props.onSelect}
        onOpenIssue={props.onOpenIssue}
        onOpenDock={props.onOpenDock}
      />
    </section>
  );
}

export function BotLists({
  queue,
  issues,
  selected,
  wide,
  menu,
  showQueue = true,
  onSelect,
  onOpenIssue,
  onOpenDock,
  onToggleMenu,
  onDismissMenu,
}: BotListsProps) {
  const openMenu = !showQueue && menu === "queue" ? null : menu;
  const toolsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wide || !openMenu) return;
    const onMouseDown = (event: MouseEvent) => {
      if (toolsRef.current?.contains(event.target as Node)) return;
      onDismissMenu?.();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [wide, openMenu, onDismissMenu]);
  if (wide) {
    return (
      <aside className="bot-lists" style={columnStyle} data-testid="bot-lists">
        <QueueCard queue={queue} selected={selected} onSelect={onSelect} />
        <TodoCard
          issues={issues}
          selected={selected}
          onSelect={onSelect}
          onOpenIssue={onOpenIssue}
          onOpenDock={onOpenDock}
        />
      </aside>
    );
  }

  return (
    <div className="bot-lists-tools" ref={toolsRef}>
      {showQueue ? (
        <button
          type="button"
          className="bot-lists-tool"
          style={toolStyle}
          aria-label="待处理"
          aria-expanded={openMenu === "queue"}
          onClick={() => onToggleMenu("queue")}
        >
          <InboxIcon />
          <span className="bot-lists-badge">{queue.length}</span>
          <span className="bot-lists-tip">待处理</span>
        </button>
      ) : null}
      <button
        type="button"
        className="bot-lists-tool"
        style={toolStyle}
        aria-label="事项"
        aria-expanded={openMenu === "todo"}
        onClick={() => onToggleMenu("todo")}
      >
        <TodoIcon />
        <span className="bot-lists-badge">{issues.length}</span>
        <span className="bot-lists-tip">事项</span>
      </button>
      {openMenu ? (
        <div className="bot-lists-pop" data-testid="bot-lists-menu">
          {openMenu === "queue" ? (
            <>
              <h2 className="bot-list-card-title">待处理</h2>
              <QueueRows queue={queue} selected={selected} onSelect={onSelect} />
            </>
          ) : (
            <>
              <h2 className="bot-list-card-title">事项</h2>
              <IssueRows
                issues={issues}
                selected={selected}
                onSelect={onSelect}
                onOpenIssue={onOpenIssue}
                onOpenDock={onOpenDock}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
