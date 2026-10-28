import { ASSISTANT_TEXT_MAX } from "./messages.js";

export type AssistantChatEvent = {
  type: "chat";
  from: "muse" | "popo" | "popo-group";
  message: string;
  user?: string;
  groupId?: string;
  images?: Array<{ data: string; mediaType: string }>;
  /** 事件触发时的毫秒时间戳。 */
  timestamp?: number;
  retry?: 1;
  turnError?: string;
};

export type AssistantIssueEvent = {
  type: "issue";
  issueId: string;
  title: string;
  workdir: string;
  /** 这一轮用户发出的消息。一轮里有多条时按时间接在一起。 */
  request?: string;
  summary: string;
  /** 事件触发时的毫秒时间戳。 */
  timestamp?: number;
  retry?: 1;
  turnError?: string;
};

export type AssistantAutomationEvent = {
  type: "automation";
  automationId: string;
  name: string;
  runId: string;
  workdir: string;
  status: "succeeded" | "failed" | "stopped" | "skipped";
  trigger: "cron" | "once" | "issue" | "manual";
  /** agent 有执行会话；remind 只是到点把 instruction 交给助手。 */
  mode: "agent" | "remind";
  /** 注册规则时留给助手的话。 */
  instruction?: string;
  error?: string;
  summary?: string;
  /** 事件触发时的毫秒时间戳。 */
  timestamp?: number;
  retry?: 1;
  turnError?: string;
};

export type AssistantPermissionEvent = {
  type: "permission";
  permissionId: string;
  issueId: string;
  title: string;
  workdir: string;
  sessionId: string;
  toolName: string;
  description: string;
  descriptionNote?: string;
  /** 事件触发时的毫秒时间戳。 */
  timestamp?: number;
  retry?: 1;
  turnError?: string;
};

export type AssistantEvent =
  | AssistantChatEvent
  | AssistantIssueEvent
  | AssistantAutomationEvent
  | AssistantPermissionEvent;

export type AssistantQueueView = {
  type: "chat" | "issue" | "automation" | "permission";
  title: string;
  /** 事件触发时的毫秒时间戳。没有则客户端留空时间。 */
  timestamp?: number;
  retry?: true;
  active?: true;
};

function queueView(
  view: AssistantQueueView,
  timestamp: number | undefined,
): AssistantQueueView {
  return typeof timestamp === "number" ? { ...view, timestamp } : view;
}

function clipQueueText(text: string): string {
  const chars = [...text.replace(/\s+/g, " ").trim()];
  if (chars.length <= 80) return chars.join("");
  return `${chars.slice(0, 80).join("")}…`;
}

export function viewAssistantEvent(event: AssistantEvent): AssistantQueueView {
  const retry = event.retry === 1 ? ({ retry: true } as const) : {};
  if (event.type === "chat") {
    const who =
      event.from === "popo-group" ? "POPO 群" : event.from === "popo" ? "POPO" : "Muse";
    const body = clipQueueText(event.message) || (event.images?.length ? "图片" : "空消息");
    return queueView({ type: "chat", title: `${who}：${body}`, ...retry }, event.timestamp);
  }
  if (event.type === "issue") {
    return queueView(
      { type: "issue", title: event.title || event.issueId, ...retry },
      event.timestamp,
    );
  }
  if (event.type === "permission") {
    return queueView(
      {
        type: "permission",
        title: `${event.title || event.issueId} · ${event.toolName}`,
        ...retry,
      },
      event.timestamp,
    );
  }
  return queueView(
    {
      type: "automation",
      title: `${event.name} · ${event.status}`,
      ...retry,
    },
    event.timestamp,
  );
}

export const ASSISTANT_DESCRIPTION_NOTE =
  "description 在这里被截断了。拿不准就问用户，不要凭被截断的参数做决定。";

function truncateCodePoints(text: string, max: number): { text: string; truncated: boolean } {
  const chars = [...text];
  if (chars.length <= max) return { text, truncated: false };
  return { text: chars.slice(0, max).join(""), truncated: true };
}

/** 本地时间，带时区偏移，给模型看这条事件是什么时候触发的。 */
export function formatEventTimestamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
    sign,
    pad(Math.floor(abs / 60)),
    ":",
    pad(abs % 60),
  ].join("");
}

function linesOf(fields: Array<[string, string | undefined]>): string {
  return fields
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

export function formatAssistantEvent(event: AssistantEvent): string {
  let body: string;
  if (event.type === "chat") {
    body = linesOf([
      ["type", "chat"],
      ["timestamp", event.timestamp === undefined ? undefined : formatEventTimestamp(event.timestamp)],
      ["from", event.from],
      ["message", event.message],
      ["user", event.user],
      ["groupId", event.groupId],
      ["images", event.images && event.images.length > 0 ? String(event.images.length) : undefined],
    ]);
  } else if (event.type === "issue") {
    body = linesOf([
      ["type", "issue"],
      ["timestamp", event.timestamp === undefined ? undefined : formatEventTimestamp(event.timestamp)],
      ["issueId", event.issueId],
      ["title", event.title],
      ["workdir", event.workdir],
      ["request", event.request],
      ["summary", event.summary],
    ]);
  } else if (event.type === "permission") {
    const description = truncateCodePoints(event.description, ASSISTANT_TEXT_MAX);
    body = linesOf([
      ["type", "permission"],
      ["timestamp", event.timestamp === undefined ? undefined : formatEventTimestamp(event.timestamp)],
      ["permissionId", event.permissionId],
      ["issueId", event.issueId],
      ["title", event.title],
      ["workdir", event.workdir],
      ["sessionId", event.sessionId],
      ["toolName", event.toolName],
      ["description", description.text],
      [
        "descriptionNote",
        description.truncated ? ASSISTANT_DESCRIPTION_NOTE : event.descriptionNote,
      ],
    ]);
  } else {
    body = linesOf([
      ["type", "automation"],
      ["timestamp", event.timestamp === undefined ? undefined : formatEventTimestamp(event.timestamp)],
      ["automationId", event.automationId],
      ["name", event.name],
      ["runId", event.runId],
      ["workdir", event.workdir],
      ["status", event.status],
      ["trigger", event.trigger],
      ["mode", event.mode],
      ["instruction", event.instruction],
      ["error", event.error],
      ["summary", event.summary],
    ]);
  }
  if (event.retry !== 1) return body;
  return `${body}\nretry: 1\nerror: ${event.turnError ?? ""}`;
}

export function formatAssistantEvents(events: AssistantEvent[]): string {
  return events.map((event) => formatAssistantEvent(event)).join("\n\n");
}
