import { lastAssistantText } from "../issueDispatch.js";
import type { IssueStore } from "../issueStore.js";
import { ASSISTANT_TEXT_MAX } from "./messages.js";
import {
  ASSISTANT_DESCRIPTION_NOTE,
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
  const issue = args.issues.listActive().find(
    (item) =>
      item.planningSessionId === args.sessionId ||
      item.executionSessionId === args.sessionId,
  );
  if (!issue?.workdir) return;
  let summary = "";
  try {
    summary = lastAssistantText(await args.runner.getMessages(args.sessionId));
  } catch {
    summary = "";
  }
  args.enqueue({
    type: "issue",
    issueId: issue.id,
    title: issue.title,
    workdir: issue.workdir,
    summary,
  });
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
