import { lastAssistantText, lastTurnChangedFiles } from "../issueDispatch.js";
import type { IssueStore } from "../issueStore.js";
import type { IssueUpdate, IssueUpdateInput } from "../issueProgress.js";
import { userMessageText } from "../sessionRunner/serialization.js";
import { ASSISTANT_TEXT_MAX } from "./messages.js";
import {
  ASSISTANT_DESCRIPTION_NOTE,
  type AssistantEvent,
} from "./events.js";
import { takeIssueUserPresent } from "./userPresent.js";

export async function enqueueIssueSessionTurn(args: {
  issues: IssueStore;
  runner: { getMessages(sessionId: string): Promise<unknown[]> };
  recordIssueUpdate?: (
    issueId: string,
    input: IssueUpdateInput,
  ) => IssueUpdate | undefined;
  enqueue: (event: AssistantEvent) => void;
  assistantSessionId?: string;
  sessionId: string;
}): Promise<void> {
  if (args.assistantSessionId && args.sessionId === args.assistantSessionId) {
    return;
  }
  // 规划/单 agent 会话写进展并唤醒助手；执行会话只写进展，不唤醒助手。
  const planningIssue = args.issues
    .listActive()
    .find((item) => item.planningSessionId === args.sessionId);
  const executionIssue = planningIssue
    ? undefined
    : args.issues
        .listActive()
        .find((item) => item.executionSessionId === args.sessionId);
  const issue = planningIssue ?? executionIssue;
  if (!issue?.workdir) return;

  let messages: unknown[] = [];
  try {
    messages = await args.runner.getMessages(args.sessionId);
  } catch {
    messages = [];
  }
  const lastText = lastAssistantText(messages);
  const lastId = lastAssistantMessageId(messages);
  const userPresent = takeIssueUserPresent(args.sessionId, messages);

  const done = issue.items.filter((item) => item.status === "done").length;
  const total = issue.items.length;
  const turnSummary = [
    planningIssue ? "回合结束" : "执行回合结束",
    total > 0 ? `清单 ${done}/${total}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const changedFiles = lastTurnChangedFiles(messages).slice(0, 20);

  if (args.recordIssueUpdate) {
    args.recordIssueUpdate(issue.id, {
      kind: "turn",
      summary: turnSummary,
      sessionId: args.sessionId,
      sessionMessageId: lastId,
      ...(changedFiles.length > 0 ? { changedFiles } : {}),
      status: issue.status,
      userPresent: userPresent ? true : undefined,
      sourceKey: lastId ? `turn:${args.sessionId}:${lastId}` : undefined,
    });
  }

  // 执行会话到此为止：不负责给用户发消息，也不改 replyPending。
  if (!planningIssue) return;

  const request = turnUserRequest(messages);
  const pending = args.issues.markReplyPending(issue.id) ?? issue;
  args.enqueue({
    type: "issue",
    issueId: issue.id,
    title: issue.title,
    workdir: issue.workdir,
    ...(request ? { request } : {}),
    summary: lastText,
    replyPending: true,
    ...(userPresent ? { userPresent: true as const } : {}),
    ...(pending.replyNote ? { replyNote: pending.replyNote } : {}),
  });
}

function lastAssistantMessageId(messages: unknown[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    const role = (message as { role?: unknown }).role;
    if (role !== "assistant") continue;
    const id = (message as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}

/** 这一轮用户发出的正文。往前走到上一轮的助手回复为止，跳过系统注入。 */
export function turnUserRequest(messages: unknown[]): string {
  const texts: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    const role = (message as { role?: string }).role;
    if (role === "assistant") {
      if (texts.length > 0) break;
      continue;
    }
    if (role !== "user") continue;
    const text = conversationUserText(message);
    if (!text) continue;
    texts.unshift(text);
  }
  return texts.join("\n\n");
}

function conversationUserText(message: object): string {
  if ((message as { isMeta?: boolean }).isMeta) return "";
  const blocks = (message as { blocks?: Array<{ type?: string; content?: string; source?: string }> }).blocks;
  if (!Array.isArray(blocks)) return userMessageText(message);
  if (blocks.some((block) => block.type === "bang" || block.type === "task_notification")) {
    return "";
  }
  return blocks
    .filter((block) => (block.type === "text" || block.type === "compact") && block.source !== "hook")
    .map((block) => block.content || "")
    .join("")
    .trim();
}

function truncateCodePoints(text: string, max: number): { text: string; truncated: boolean } {
  const chars = [...text];
  if (chars.length <= max) return { text, truncated: false };
  return { text: chars.slice(0, max).join(""), truncated: true };
}

export function enqueueIssuePermission(args: {
  issues: IssueStore;
  recordIssueUpdate?: (
    issueId: string,
    input: IssueUpdateInput,
    opts?: { allowClosed?: boolean },
  ) => IssueUpdate | undefined;
  enqueue: (event: AssistantEvent) => void;
  sessionId: string;
  permissionId: string;
  toolName: string;
  description: string;
}): void {
  const issue = args.issues.listActive().find(
    (item) =>
      item.planningSessionId === args.sessionId ||
      item.executionSessionId === args.sessionId,
  );
  if (!issue?.workdir) return;
  const description = truncateCodePoints(args.description, ASSISTANT_TEXT_MAX);
  args.recordIssueUpdate?.(issue.id, {
    kind: "permission",
    summary: `等待批准：${args.toolName}`,
    detail: description.text,
    sessionId: args.sessionId,
    status: issue.status,
  });
  args.enqueue({
    type: "permission",
    permissionId: args.permissionId,
    issueId: issue.id,
    title: issue.title,
    workdir: issue.workdir,
    sessionId: args.sessionId,
    toolName: args.toolName,
    description: description.text,
    ...(description.truncated ? { descriptionNote: ASSISTANT_DESCRIPTION_NOTE } : {}),
  });
}
