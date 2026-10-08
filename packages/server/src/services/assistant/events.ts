import { ASSISTANT_TEXT_MAX } from "./messages.js";

export type AssistantChatEvent = {
  type: "chat";
  from: "muse" | "popo" | "popo-group";
  message: string;
  user?: string;
  groupId?: string;
  retry?: 1;
  turnError?: string;
};

export type AssistantIssueEvent = {
  type: "issue";
  issueId: string;
  title: string;
  workdir: string;
  summary: string;
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
  error?: string;
  summary?: string;
  retry?: 1;
  turnError?: string;
};

export type AssistantEvent =
  | AssistantChatEvent
  | AssistantIssueEvent
  | AssistantAutomationEvent;

function truncateCodePoints(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max).join("");
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
      ["from", event.from],
      ["message", event.message],
      ["user", event.user],
      ["groupId", event.groupId],
    ]);
  } else if (event.type === "issue") {
    body = linesOf([
      ["type", "issue"],
      ["issueId", event.issueId],
      ["title", event.title],
      ["workdir", event.workdir],
      ["summary", truncateCodePoints(event.summary, ASSISTANT_TEXT_MAX)],
    ]);
  } else {
    body = linesOf([
      ["type", "automation"],
      ["automationId", event.automationId],
      ["name", event.name],
      ["runId", event.runId],
      ["workdir", event.workdir],
      ["status", event.status],
      ["trigger", event.trigger],
      ["error", event.error],
      ["summary", event.summary === undefined ? undefined : truncateCodePoints(event.summary, ASSISTANT_TEXT_MAX)],
    ]);
  }
  if (event.retry !== 1) return body;
  return `${body}\nretry: 1\nerror: ${event.turnError ?? ""}`;
}
