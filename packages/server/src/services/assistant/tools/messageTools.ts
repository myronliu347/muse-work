import fs from "node:fs";
import path from "node:path";
import { userMessageText } from "../../sessionRunner/serialization.js";
import { ASSISTANT_TEXT_MAX } from "../messages.js";
import {
  compactText,
  fail,
  messageIds,
  ok,
  stringList,
  text,
  tool,
  type AssistantToolDeps,
} from "./toolKit.js";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "gif", "png", "bmp"]);

function isImagePath(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).slice(1).toLowerCase());
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
  return [
    tool(
      "SendMessage",
      "回复 Muse 或 POPO。app 为 muse 或 popo。popo 有 groupId 则发群，否则发给 user。ats 用来 @：Muse 只能 @ issue，POPO 群只能 @ user。本地图片和文件用 files 传绝对路径，链接用 links。",
      {
        type: "object",
        properties: {
          message: { type: "string" },
          app: { type: "string", enum: ["muse", "popo"] },
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
              "Muse 用 { type: issue, id }，换了才加引用，跟上一条同一条不加。POPO 群用 { type: user, id }，id 是邮箱。私聊不要传。",
          },
          files: { type: "array", items: { type: "string" } },
          links: { type: "array", items: { type: "string" } },
        },
        required: ["message", "app"],
      },
      async (args) => {
        let message = typeof args.message === "string" ? args.message.trim() : "";
        const files = stringList(args.files);
        const links = stringList(args.links);
        const groupId = text(args.groupId);
        const parsedAts = parseAts(args.ats);
        if (typeof parsedAts === "string") return fail(parsedAts);
        const issueAts = parsedAts.filter((at) => at.type === "issue");
        const userAts = parsedAts.filter((at) => at.type === "user");
        let rememberedIssueId: string | undefined;
        let atUids: string[] | undefined;
        if (args.app === "muse") {
          if (userAts.length > 0) return fail("muse 只能 @ issue");
          if (issueAts.length === 1 && previousIssueId(deps.log) === issueAts[0]?.id) {
            rememberedIssueId = issueAts[0]?.id;
          } else if (issueAts.length > 0) {
            const quotes: string[] = [];
            for (const at of issueAts) {
              const issue = deps.issues.get(at.id);
              if (!issue) return fail("not found");
              quotes.push(`> ${issueMentionLabel(issue.title)}`);
              rememberedIssueId = issue.id;
            }
            message = withIssueLead(message, quotes.join("\n"), "\n\n");
          }
        } else if (args.app === "popo") {
          if (issueAts.length > 0) return fail("POPO 不能 @ issue");
          if (userAts.length > 0 && !groupId) return fail("只有群聊可以 @ 人");
          if (userAts.length > 0) atUids = userAts.map((at) => at.id);
        }
        if (!message && files.length === 0 && links.length === 0) return fail("message required");
        for (const filePath of files) {
          const problem = localFile(filePath);
          if (problem) return fail(problem);
        }
        const recordBody = composeOutbound(message, [...links, ...files]);
        // POPO 图片走文件发送。路径留在 Muse 记录里，不再另发一条只有路径的文字。
        const popoText = composeOutbound(message, [
          ...links,
          ...files.filter((filePath) => !isImagePath(filePath)),
        ]);
        if (args.app === "muse") {
          const line = deps.log.append(
            "assistant",
            recordBody,
            undefined,
            undefined,
            undefined,
            rememberedIssueId,
          );
          deps.hub.broadcastAll({ type: "assistant:chat", line });
          return ok({ line });
        }
        if (args.app !== "popo") return fail("app must be muse or popo");
        const user = text(args.user);
        const receiver = groupId || user;
        if (!receiver || !deps.sendText) return fail("popo recipient required");
        if (files.length > 0 && !deps.sendLocalFile) return fail("popo file send unavailable");
        const msgIds: string[] = [];
        try {
          if (popoText) {
            msgIds.push(
              ...messageIds(await deps.sendText(receiver, popoText, atUids ? { atUids } : undefined)),
            );
          }
          for (const filePath of files) {
            const msgId = await deps.sendLocalFile!(receiver, filePath);
            if (typeof msgId === "string" && msgId.trim()) msgIds.push(msgId.trim());
          }
        } catch (err: unknown) {
          return fail(err instanceof Error ? err.message : String(err));
        }
        const master = deps.popoMasterUid?.()?.trim();
        if (!groupId && master && user === master) {
          const line = deps.log.append(
            "assistant",
            recordBody,
            undefined,
            "popo",
            msgIds,
            rememberedIssueId,
          );
          deps.hub.broadcastAll({ type: "assistant:chat", line });
          return ok({ sent: true, receiver, msgIds, line });
        }
        return ok({ sent: true, receiver, msgIds });
      },
      (params) => compactText(params.message),
    ),
    tool(
      "RecallMessage",
      "撤回一条已经发出的 POPO 消息。msgId 用 SendMessage 返回的。有 groupId 撤回群消息，否则用 user 撤回私聊。",
      {
        type: "object",
        properties: {
          msgId: { type: "string" },
          user: { type: "string" },
          groupId: { type: "string" },
        },
        required: ["msgId"],
      },
      async (args) => {
        const msgId = text(args.msgId);
        const groupId = text(args.groupId);
        const user = text(args.user);
        const sessionId = groupId || user;
        if (!msgId || !sessionId) return fail("msgId and recipient required");
        if (!deps.recallPopo) return fail("popo recall unavailable");
        try {
          await deps.recallPopo({
            msgId,
            sessionId,
            sessionType: groupId ? 3 : 1,
          });
        } catch (err: unknown) {
          return fail(err instanceof Error ? err.message : String(err));
        }
        return ok({ recalled: true, msgId, sessionId });
      },
      (params) => compactText(params.msgId),
    ),
    tool(
      "ReadSessionMessages",
      "查看 Issue 或自动化运行对应会话的消息全文。summary 被截断时用它拿完整内容。issueId 与 runId 至少给一个。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          runId: { type: "string" },
        },
      },
      async (args) => {
        const issueId = text(args.issueId);
        const runId = text(args.runId);
        if (!issueId && !runId) return fail("issueId or runId required");
        const readTexts = async (sessionId: string) => {
          const messages = await deps.runner.getMessages(sessionId);
          const lines: Array<{ role: string; text: string }> = [];
          for (const message of messages) {
            if (!message || typeof message !== "object") continue;
            const role = (message as { role?: string }).role;
            if (role !== "user" && role !== "assistant") continue;
            const content = userMessageText(message);
            if (!content) continue;
            lines.push({ role, text: content });
          }
          return lines;
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
      "从最新一片往前查询对话记录。没有 app 的是 Muse 里的对话，app 为 popo 的是主人跟机器人的私聊。",
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
              ...(line.app === "popo" ? { app: "popo" as const } : {}),
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
