import { useEffect, useState, type CSSProperties } from "react";
import type { PanelSelection } from "./botWorkspace";
import "./BotLists.css";

export const BOT_LISTS_WIDE_MIN_WIDTH = 1240;

export type BotListQueueItem = {
  id: string;
  kind: string;
  title: string;
};

export type BotListIssue = {
  issueId: string;
  title: string;
  priority: string;
};

export interface BotListsProps {
  queue: BotListQueueItem[];
  issues: BotListIssue[];
  selected: PanelSelection;
  wide: boolean;
  menu: "queue" | "todo" | null;
  onSelect: (panel: Exclude<PanelSelection, { kind: "none" }>) => void;
  onToggleMenu: (menu: "queue" | "todo") => void;
}

/** Labels already shown by AssistantPage. Missing type keeps this list's own category. */
export function queueKindLabel(type: string | undefined): string {
  if (type === "chat") return "聊天";
  if (type === "issue") return "Issue";
  if (type === "permission") return "权限";
  if (type === "automation") return "自动化";
  return "待处理";
}

export function readBotQueue(items: readonly unknown[]): BotListQueueItem[] {
  return items.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const item = value as { id?: unknown; type?: unknown; title?: unknown };
    if (typeof item.title !== "string" || item.title.length === 0) return [];
    const id = typeof item.id === "string" && item.id.length > 0 ? item.id : String(index);
    const type = typeof item.type === "string" && item.type.length > 0 ? item.type : undefined;
    return [{ id, kind: queueKindLabel(type), title: item.title }];
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
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    setWide(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return wide;
}

const columnStyle: CSSProperties = {
  width: 268,
  alignSelf: "flex-start",
  flex: "0 0 auto",
  position: "relative",
  height: "auto",
};

const cardStyle: CSSProperties = {
  borderRadius: 14,
  boxShadow: "0 16px 40px rgba(0, 0, 0, 0.38)",
};

const toolStyle: CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
};

function priorityLabel(priority: string): string {
  return /^p\d$/i.test(priority) ? priority.toUpperCase() : priority;
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
}: {
  issues: BotListIssue[];
  selected: PanelSelection;
  onSelect: BotListsProps["onSelect"];
}) {
  return (
    <ul className="bot-list-rows">
      {issues.map((issue) => {
        const current = selected.kind === "issue" && selected.issueId === issue.issueId;
        return (
          <li key={issue.issueId}>
            <button
              type="button"
              className="bot-list-row"
              aria-current={current ? "true" : undefined}
              onClick={() => onSelect({ kind: "issue", issueId: issue.issueId })}
            >
              <span className="bot-list-title">{issue.title}</span>
              <span className="bot-list-priority">{priorityLabel(issue.priority)}</span>
            </button>
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
}) {
  return (
    <section className="bot-list-card" style={cardStyle} aria-label="待办事项">
      <h2 className="bot-list-card-title">
        待办事项
        <span>{props.issues.length}</span>
      </h2>
      <IssueRows issues={props.issues} selected={props.selected} onSelect={props.onSelect} />
    </section>
  );
}

export function BotLists({
  queue,
  issues,
  selected,
  wide,
  menu,
  onSelect,
  onToggleMenu,
}: BotListsProps) {
  if (wide) {
    return (
      <aside className="bot-lists" style={columnStyle} data-testid="bot-lists">
        <QueueCard queue={queue} selected={selected} onSelect={onSelect} />
        <TodoCard issues={issues} selected={selected} onSelect={onSelect} />
      </aside>
    );
  }

  return (
    <div className="bot-lists-tools">
      <button
        type="button"
        className="bot-lists-tool"
        style={toolStyle}
        aria-label="待处理"
        aria-expanded={menu === "queue"}
        onClick={() => onToggleMenu("queue")}
      >
        <InboxIcon />
        <span className="bot-lists-badge">{queue.length}</span>
        <span className="bot-lists-tip">待处理</span>
      </button>
      <button
        type="button"
        className="bot-lists-tool"
        style={toolStyle}
        aria-label="待办"
        aria-expanded={menu === "todo"}
        onClick={() => onToggleMenu("todo")}
      >
        <TodoIcon />
        <span className="bot-lists-badge">{issues.length}</span>
        <span className="bot-lists-tip">待办</span>
      </button>
      {menu ? (
        <div className="bot-lists-pop" data-testid="bot-lists-menu">
          {menu === "queue" ? (
            <>
              <h2 className="bot-list-card-title">待处理</h2>
              <QueueRows queue={queue} selected={selected} onSelect={onSelect} />
            </>
          ) : (
            <>
              <h2 className="bot-list-card-title">待办事项</h2>
              <IssueRows issues={issues} selected={selected} onSelect={onSelect} />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
