import { lastAssistantText } from "../issueDispatch.js";
import type { IssueStore } from "../issueStore.js";
import { userMessageText } from "../sessionRunner/serialization.js";
import { ASSISTANT_TEXT_MAX } from "./messages.js";
import {
  ASSISTANT_DESCRIPTION_NOTE,
  ASSISTANT_REQUEST_NOTE,
  type AssistantEvent,
} from "./events.js";

export async function enqueueIssueSessionTurn(args: {
  issues: IssueStore;
  runner: { getMessages(sessionId: string): Promise<unknown[]> };
  enqueue: (event: AssistantEvent) => void;
  assistantSessionId?: string;
  sessionId: string;
}): Promise<void> {
  if (args.assistantSessionId && args.sessionId === args.assistantSessionId) {
    return;
  }
  // 执行会话的回合由规划会话验收后再进来，完成本身不推给助手。
  const issue = args.issues.listActive().find(
    (item) => item.planningSessionId === args.sessionId,
  );
  if (!issue?.workdir) return;
  let messages: unknown[] = [];
  try {
    messages = await args.runner.getMessages(args.sessionId);
  } catch {
    messages = [];
  }
  const request = truncateCodePoints(turnUserRequest(messages), ASSISTANT_TEXT_MAX);
  args.enqueue({
    type: "issue",
    issueId: issue.id,
    title: issue.title,
    workdir: issue.workdir,
    ...(request.text ? { request: request.text } : {}),
    ...(request.truncated ? { requestNote: ASSISTANT_REQUEST_NOTE } : {}),
    summary: lastAssistantText(messages),
  });
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
