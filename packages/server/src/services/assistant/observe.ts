import { lastAssistantText } from "../issueDispatch.js";
import type { IssueStore } from "../issueStore.js";
import type { AssistantEvent } from "./events.js";

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
