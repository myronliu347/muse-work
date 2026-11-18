import fs from "node:fs";
import path from "node:path";
import type { AssistantApp } from "@muse-work/plugin-sdk";
import { userMessageText } from "../../sessionRunner/serialization.js";
import { ASSISTANT_TEXT_MAX } from "../messages.js";
import {
  compactText,
  fail,
  ok,
  stringList,
  text,
  tool,
  type AssistantToolDeps,
} from "./toolKit.js";

const SEND_MESSAGE_BODY_MAX = 200;
const ISSUE_UPDATE_FILES_MAX = 10;

function issueUpdateSummary(message: string): string {
  const body = message
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n")
    .trim();
  return compactText(body, 280);
}

function userWantsFullText(log: AssistantToolDeps["log"]): boolean {
  const messages = log.page({ limit: 50 }).messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = messages[i];
    if (line?.role !== "user") continue;
    return /写在聊天里|全文|不要附件/.test(line.message);
  }
  return false;
}

type SessionWindowLine = {
  id?: string;
  role: string;
  text: string;
  truncated?: true;
};

function windowSessionLines(
  messages: unknown[],
  before?: string,
): { messages: SessionWindowLine[]; omitted: number } {
  const lines: SessionWindowLine[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const role = (message as { role?: string }).role;
    if (role !== "user" && role !== "assistant") continue;
    const content = userMessageText(message);
    if (!content) continue;
    const id = (message as { id?: string }).id;
    lines.push({
      ...(typeof id === "string" && id ? { id } : {}),
      role,
      text: content,
    });
  }

  let end = lines.length;
  if (before) {
    const index = lines.findIndex((line) => line.id === before);
    if (index >= 0) end = index;
  }

  const selected: SessionWindowLine[] = [];
  let used = 0;
  let oldest = end;
  for (let i = end - 1; i >= 0; i--) {
    const line = lines[i]!;
    const room = ASSISTANT_TEXT_MAX - used;
    if (room <= 0) break;
    const chars = [...line.text];
    if (chars.length <= room) {
      selected.push(line);
      used += chars.length;
      oldest = i;
      continue;
    }
    if (selected.length === 0) {
      selected.push({
        ...(line.id ? { id: line.id } : {}),
        role: line.role,
        text: chars.slice(chars.length - room).join(""),
        truncated: true,
      });
      oldest = i;
    }
    break;
  }
  selected.reverse();
  return { messages: selected, omitted: oldest };
}

function localFile(filePath: string): string | undefined {
  if (!path.isAbsolute(filePath)) return `need an absolute path: ${filePath}`;
  try {
    if (!fs.statSync(filePath).isFile()) return `file not found: ${filePath}`;
  } catch {
    return `file not found: ${filePath}`;
  }
  return undefined;
}

function composeOutbound(message: string, extras: string[]): string {
  const lines: string[] = [];
  for (const extra of extras) {
    if (!message.includes(extra)) lines.push(extra);
  }
  return [message, ...lines].filter(Boolean).join("\n");
}

function issueMentionLabel(title: string): string {
  const cleaned = title.replace(/[\[\]\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Issue";
}

function mentionedIssueId(message: string): string | undefined {
  const match = message.match(/\[@issue:([^\s\]]+)/);
  return match?.[1];
}

type AtTarget = { type: "issue" | "user"; id: string };

function parseAts(value: unknown): AtTarget[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return "ats 必须是数组";
  const ats: AtTarget[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return "ats 每一项都要有 type 和 id";
    const type = (item as { type?: unknown }).type;
    const id = text((item as { id?: unknown }).id);
    if (type !== "issue" && type !== "user") return "at type 只能是 issue 或 user";
    if (!id) return "at id required";
    ats.push({ type, id });
  }
  return ats;
}

function previousIssueId(log: AssistantToolDeps["log"]): string | undefined {
  const messages = log.page({ limit: 50 }).messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = messages[i];
    if (!line || line.app) continue;
    const issueId = line.issueId || mentionedIssueId(line.message);
    if (issueId) return issueId;
  }
  return undefined;
}

function withIssueLead(message: string, lead: string, joiner: string): string {
  if (message === lead || message.startsWith(`${lead}${joiner}`) || message.startsWith(`${lead} `)) {
    return message;
  }
  return message ? `${lead}${joiner}${message}` : lead;
}

function truncateCodePoints(input: string, max: number): { text: string; truncated?: true } {
  const chars = [...input];
  if (chars.length <= max) return { text: input };
  return { text: chars.slice(0, max).join(""), truncated: true };
}

export function createMessageTools(deps: AssistantToolDeps) {
  const channels = deps.apps ?? [];
  const sendDescription = [
    "人只能看见这次调用。回合正文不会发出去，写在那里等于没说。短回复也走这里。app 为 muse。ats 用来 @ issue。本地图片和文件用 files 传绝对路径，链接用 links。正文超过 200 字且没有 files 会被拒绝。",
    ...channels.map((app) => app.description),
  ].join("");
  return [
    tool(
      "SendMessage",
      sendDescription,
      {
        type: "object",
        properties: {
          message: { type: "string" },
          app: { type: "string", enum: ["muse", ...(deps.apps ?? []).map((app) => app.id)] },
          user: { type: "string" },
          groupId: { type: "string" },
          ats: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["issue", "user"] },
                id: { type: "string" },
              },
              required: ["type", "id"],
            },
            description:
              "Muse 用 { type: issue, id }。换了才加引用，跟上一条是同一条时不加。连着发几条不用每条都传。",
          },
          files: { type: "array", items: { type: "string" } },
          links: { type: "array", items: { type: "string" } },
          issueId: {
            type: "string",
            description:
              "这条 Issue 的显式归属。带它就把这次回复记进该 Issue 的进展；不带时，如果这一轮只被一个 Issue 事件叫醒，会继承该 Issue；多事件回合不猜。不会自动 @，要引用另外传 ats。",
          },
          next: {
            type: "string",
            description: "这一步的下一步，一句话。只在有 Issue 归属时写入进展，不写进聊天正文。",
          },
        },
        required: ["message", "app"],
      },
      async (args) => {
        let message = typeof args.message === "string" ? args.message.trim() : "";
        const files = [...new Set(stringList(args.files))];
        const links = stringList(args.links);
        if (files.length > ISSUE_UPDATE_FILES_MAX) {
          return fail(`最多 ${ISSUE_UPDATE_FILES_MAX} 个文件`);
        }
        const explicitIssueId = text(args.issueId);
        if (args.issueId !== undefined && !explicitIssueId) {
          return fail("issueId required");
        }
        const settleId = explicitIssueId;
        const turn = deps.getTurnContext?.();
        const issueId =
          args.app === "muse" ? explicitIssueId || turn?.singleIssueId : undefined;
        const issue = issueId ? deps.issues.get(issueId) : undefined;
        if (issueId && !issue) {
          return fail("issue not found; call ListIssues first");
        }
        if (
          issue &&
          (issue.status === "completed" || issue.status === "cancelled")
        ) {
          return fail("issue is closed");
        }
        if (
          files.length === 0 &&
          [...message].length > SEND_MESSAGE_BODY_MAX &&
          !userWantsFullText(deps.log)
        ) {
          return fail(
            "正文超过 200 字。收成一两句，或把报告写成文件，用 files 附上绝对路径。",
          );
        }
        const parsedAts = parseAts(args.ats);
        if (typeof parsedAts === "string") return fail(parsedAts);
        const issueAts = parsedAts.filter((at) => at.type === "issue");
        const userAts = parsedAts.filter((at) => at.type === "user");
        let rememberedIssueId: string | undefined;
        // A stale @ is not a reason to drop the whole message: skip the missing
        // quote and let the assistant see a warning instead of a send failure.
        const missingAts: string[] = [];
        if (args.app === "muse") {
          if (userAts.length > 0) return fail("muse 只能 @ issue");
          if (issueAts.length === 1 && previousIssueId(deps.log) === issueAts[0]?.id) {
            const remembered = deps.issues.get(issueAts[0]!.id);
            if (remembered) rememberedIssueId = remembered.id;
            else missingAts.push(issueAts[0]!.id);
          } else if (issueAts.length > 0) {
            const quotes: string[] = [];
            for (const at of issueAts) {
              const issue = deps.issues.get(at.id);
              if (!issue) {
                missingAts.push(at.id);
                continue;
              }
              quotes.push(`> ${issueMentionLabel(issue.title)}`);
              rememberedIssueId = issue.id;
            }
            if (quotes.length > 0) {
              message = withIssueLead(message, quotes.join("\n"), "\n\n");
            }
          }
        }
        if (!message && files.length === 0 && links.length === 0) return fail("message required");
        for (const filePath of files) {
          const problem = localFile(filePath);
          if (problem) return fail(problem);
        }
        const recordBody = composeOutbound(message, [...links, ...files]);
        if (args.app === "muse") {
          const line = deps.log.append(
            "assistant",
            recordBody,
            undefined,
            undefined,
            undefined,
            issueId || rememberedIssueId,
            turn?.turnId,
          );
          if (issueId && deps.recordIssueUpdate) {
            deps.recordIssueUpdate(issueId, {
              kind: "assistant",
              summary: issueUpdateSummary(message) || (files.length ? "附上了文件" : "更新了进展"),
              ...(recordBody.length > 280 ? { detail: recordBody } : {}),
              messageId: line.id,
              ...(files.length ? { files } : {}),
              ...(text(args.next) ? { next: text(args.next) } : {}),
              ...(turn?.turnId ? { turnId: turn.turnId } : {}),
              sourceKey: `assistant:${line.id}`,
            });
          }
          if (issueId) deps.issues.clearReplyPending(issueId);
          deps.hub.broadcastAll({ type: "assistant:chat", line });
          deps.onReplySent?.();
          return ok({
            line,
            ...(missingAts.length > 0
              ? {
                  warnings: [
                    `ignored missing issue ats: ${[...new Set(missingAts)].join(", ")}`,
                  ],
                }
              : {}),
          });
        }
        const channel = channels.find((app) => app.id === args.app);
        if (!channel) return fail(`unknown app: ${String(args.app ?? "")}`);
        let result: Awaited<ReturnType<AssistantApp["send"]>>;
        try {
          result = await channel.send({ ...args, message, files, links });
        } catch (err: unknown) {
          return fail(err instanceof Error ? err.message : String(err));
        }
        if (!result.success) return fail(result.error || "send failed");
        if (settleId) deps.issues.clearReplyPending(settleId);
        let body: Record<string, unknown> = {};
        if (result.content) {
          try {
            const parsed = JSON.parse(result.content) as unknown;
            if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
          } catch {
            body = { content: result.content };
          }
        }
        if (result.line) {
          const line = deps.log.append(
            "assistant",
            result.line.message,
            undefined,
            result.line.app,
            result.line.msgIds,
            settleId || rememberedIssueId,
          );
          deps.hub.broadcastAll({ type: "assistant:chat", line });
          body.line = line;
        }
        deps.onReplySent?.();
        return { success: true, content: JSON.stringify(body) };
      },
      (params) => compactText(params.message),
    ),
    tool(
      "ReadSessionMessages",
      "查看 Issue 或自动化运行对应会话的最近消息。一次最多 8000 字，超长的最新一条只保留结尾。omitted 大于 0 表示前面还有消息，把本页最早一条的 id 作为 before 再查。issueId 与 runId 至少给一个。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          runId: { type: "string" },
          before: { type: "string" },
        },
      },
      async (args) => {
        const issueId = text(args.issueId);
        const runId = text(args.runId);
        const before = text(args.before);
        if (!issueId && !runId) return fail("issueId or runId required");
        const readTexts = async (sessionId: string) => {
          const messages = await deps.runner.getMessages(sessionId);
          return windowSessionLines(messages, before);
        };
        const result: Record<string, unknown> = {};
        if (issueId) {
          const issue = deps.issues.get(issueId);
          if (!issue) return fail("not found");
          if (!issue.planningSessionId && !issue.executionSessionId) {
            return fail("session not open");
          }
          if (issue.planningSessionId) {
            result.planning = await readTexts(issue.planningSessionId);
          }
          if (issue.executionSessionId) {
            result.execution = await readTexts(issue.executionSessionId);
          }
        }
        if (runId) {
          const run = deps.automations.getRun(runId);
          if (!run) return fail("not found");
          result.messages = run.sessionId ? await readTexts(run.sessionId) : [];
        }
        return ok(result);
      },
      (params) => compactText(params.issueId) || compactText(params.runId),
    ),
    tool(
      "ListMuseMessages",
      "从最新一片往前查询对话记录。没有 app 的是 Muse 里的对话。",
      {
        type: "object",
        properties: {
          before: { type: "string" },
          q: { type: "string" },
          limit: { type: "number" },
        },
      },
      async (args) => {
        const before = text(args.before) || undefined;
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const q = text(args.q);
        const page = q
          ? deps.log.search({ q, before, limit })
          : deps.log.page({ before, limit });
        return ok({
          ...page,
          messages: page.messages.map((line) => {
            const clipped = truncateCodePoints(line.message, ASSISTANT_TEXT_MAX);
            const truncated =
              clipped.truncated ||
              ("truncated" in line && line.truncated === true);
            return {
              id: line.id,
              at: line.at,
              role: line.role,
              ...(line.app ? { app: line.app } : {}),
              ...(line.msgIds && line.msgIds.length > 0 ? { msgIds: line.msgIds } : {}),
              message: clipped.text,
              ...(truncated ? { truncated: true } : {}),
            };
          }),
        });
      },
      (params) => compactText(params.q),
    ),
  ];
}
