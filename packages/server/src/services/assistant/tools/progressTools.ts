import {
  ISSUE_UPDATE_FILES_MAX,
  ISSUE_UPDATE_SUMMARY_MAX,
} from "../../issueProgress.js";
import {
  compactText,
  fail,
  localFile,
  ok,
  stringList,
  text,
  tool,
  type AssistantToolDeps,
} from "./toolKit.js";

/**
 * 进展正文取自这一轮对用户说的那句话，模型不再另写一条摘要。
 *
 * 分开写容易漂：同一件事，聊天里是「主线上就两件：…」，账本里变成
 * 「已完成…并作为附件发给用户」，结论全丢了。只取这一轮、只取归到这条
 * Issue（或没归属）的助手消息。
 */
function turnLines(
  log: AssistantToolDeps["log"],
  turnId: string | undefined,
  issueId: string,
) {
  if (!turnId) return [];
  return log
    .page({ limit: 50 })
    .messages.filter(
      (line) =>
        line.role === "assistant" &&
        line.turnId === turnId &&
        (!line.issueId || line.issueId === issueId),
    );
}

/** 去掉 ats 带进来的「> 标题」引用行，只留正文。 */
function stripQuote(message: string): string {
  return message
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n")
    .trim();
}

export function createProgressTools(deps: AssistantToolDeps) {
  return [
    tool(
      "RecordProgress",
      "把这一轮对用户说的话记进某条 Issue 的进展，进详情页的时间线。正文自动取你刚用 SendMessage 发的那句，不用另写摘要；你只补 next 和产物。它不发给用户，也不撕 replyPending 纸条；要对人说话用 SendMessage。next 是这一步之后的下一步，一句话，只在能确定时写。files 是给人看的产物绝对路径。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          next: { type: "string" },
          files: { type: "array", items: { type: "string" } },
        },
        required: ["issueId"],
      },
      async (args) => {
        if (!deps.recordIssueUpdate) return fail("progress ledger unavailable");
        const issueId = text(args.issueId);
        if (!issueId) return fail("issueId required");
        const issue = deps.issues.get(issueId);
        if (!issue) return fail("issue not found; call ListIssues first");
        if (issue.status === "completed" || issue.status === "cancelled") {
          return fail("issue is closed");
        }
        const files = [...new Set(stringList(args.files))];
        if (files.length > ISSUE_UPDATE_FILES_MAX) {
          return fail(`最多 ${ISSUE_UPDATE_FILES_MAX} 个文件`);
        }
        for (const filePath of files) {
          const problem = localFile(filePath);
          if (problem) return fail(problem);
        }
        const turn = deps.getTurnContext?.();
        const lines = turnLines(deps.log, turn?.turnId, issueId);
        const body = lines
          .map((line) => stripQuote(line.message))
          .filter(Boolean)
          .join("\n\n");
        if (!body && files.length === 0) {
          return fail(
            "这一轮还没对用户说过这条 Issue 的话。先用 SendMessage 说清楚，再记进展。",
          );
        }
        const chars = [...body];
        const summary =
          chars.slice(0, ISSUE_UPDATE_SUMMARY_MAX).join("") ||
          (files.length > 0 ? "附上了文件" : "");
        const next = text(args.next);
        const update = deps.recordIssueUpdate(issueId, {
          kind: "assistant",
          summary,
          ...(chars.length > ISSUE_UPDATE_SUMMARY_MAX ? { detail: body } : {}),
          ...(files.length > 0 ? { files } : {}),
          ...(next ? { next } : {}),
          ...(lines.length > 0 ? { messageId: lines[lines.length - 1].id } : {}),
          ...(turn?.turnId ? { turnId: turn.turnId } : {}),
        });
        if (!update) return fail("progress not recorded");
        return ok({
          id: update.id,
          issueId,
          summary: update.summary,
          ...(update.next ? { next: update.next } : {}),
        });
      },
      (params) => compactText(params.issueId) || compactText(params.next),
    ),
  ];
}
