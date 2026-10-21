import fs from "node:fs";
import path from "node:path";
import type { ToolPlugin, ToolResult } from "@muse-work/agent";
import { normalizeIssueType, type IssueStore } from "../issueStore.js";
import type { SessionStore } from "../sessionStore.js";
import type { SessionRunner } from "../sessionRunner/index.js";
import type { AutomationStore } from "../automationStore.js";
import type { WsHub } from "../wsHub.js";
import { ASSISTANT_TEXT_MAX, type createAssistantMessageLog, type MuseChatImage } from "./messages.js";
import { openIssueSession, type OpenIssueBody } from "../issueOpen.js";
import { createServerWorktree, type ServerWorktree } from "../gitWorktree.js";
import { userMessageText } from "../sessionRunner/serialization.js";
import type { TavilyOptions } from "./tavily.js";
import { createWebSearchTool } from "./webSearchTool.js";

type Log = ReturnType<typeof createAssistantMessageLog>;

export type AssistantToolDeps = {
  home: string;
  issues: IssueStore;
  sessions: SessionStore;
  runner: SessionRunner;
  automations: AutomationStore;
  log: Log;
  hub: WsHub;
  sendText?: (
    receiver: string,
    content: string,
    at?: { atUids?: string[] },
  ) => Promise<string[] | void>;
  sendLocalFile?: (receiver: string, filePath: string) => Promise<string | void>;
  recallPopo?: (args: { msgId: string; sessionId: string; sessionType: 1 | 3 }) => Promise<void>;
  /** 主人账号。只有发给这个人的 POPO 私聊才写入对话列表。 */
  popoMasterUid?: () => string | undefined;
  openIssue?: typeof openIssueSession;
  /** 测试可替换。缺省时服务器自己执行 git worktree add。 */
  createWorktree?: (args: { workdir: string; baseBranch?: string }) => Promise<ServerWorktree>;
  /** 测试可替换 Tavily 的密钥和 fetch。 */
  tavily?: TavilyOptions;
};

function fail(error: string): ToolResult {
  return { success: false, content: "", error };
}

function ok(value: unknown): ToolResult {
  return { success: true, content: JSON.stringify(value) };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function messageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) items.push(trimmed);
  }
  return items;
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "gif", "png", "bmp"]);
const IMAGE_INLINE_MAX = 4_000_000;

function isImagePath(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).slice(1).toLowerCase());
}

function imageMediaType(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  return "image/png";
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

function inlineImages(files: string[]): { images: MuseChatImage[]; overflow: string[] } {
  const images: MuseChatImage[] = [];
  const overflow: string[] = [];
  for (const filePath of files) {
    if (!isImagePath(filePath)) continue;
    const bytes = fs.readFileSync(filePath);
    if (bytes.length > IMAGE_INLINE_MAX || images.length >= 20) {
      overflow.push(filePath);
      continue;
    }
    const mediaType = imageMediaType(filePath);
    images.push({
      data: `data:${mediaType};base64,${bytes.toString("base64")}`,
      mediaType,
    });
  }
  return { images, overflow };
}

function composeOutbound(message: string, files: string[], links: string[], overflow: string[]): string {
  const extras: string[] = [];
  for (const link of links) {
    if (!message.includes(link)) extras.push(link);
  }
  for (const filePath of [...files.filter((filePath) => !isImagePath(filePath)), ...overflow]) {
    if (!message.includes(filePath)) extras.push(filePath);
  }
  return [message, ...extras].filter(Boolean).join("\n");
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

function previousIssueId(log: Log): string | undefined {
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

function queuedPreview(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const msg = item as { type?: string; content?: string };
  if (msg.type === "notification") return undefined;
  const content = typeof msg.content === "string" ? msg.content.replace(/\s+/g, " ").trim() : "";
  if (!content) return undefined;
  const chars = [...content];
  return chars.length <= 80 ? content : `${chars.slice(0, 80).join("")}…`;
}

function truncateCodePoints(input: string, max: number): { text: string; truncated?: true } {
  const chars = [...input];
  if (chars.length <= max) return { text: input };
  return { text: chars.slice(0, max).join(""), truncated: true };
}

function tool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  run: (args: Record<string, unknown>) => Promise<ToolResult>,
): ToolPlugin {
  return {
    name,
    config: {
      type: "function",
      function: { name, description, parameters },
    },
    execute: (args) => run(args),
  };
}

export function createAssistantTools(deps: AssistantToolDeps): ToolPlugin[] {
  const open = deps.openIssue ?? openIssueSession;
  const ctx = {
    home: deps.home,
    issueStore: deps.issues,
    store: deps.sessions,
    hub: deps.hub,
  };

  return [
    tool(
      "ListIssues",
      "列出未完成、且不是待关闭的 Issue：id、标题、描述、工作目录、会话是否已打开。已打开的还有 sessionStatus（idle、running、error）和 queued（还没收进当前轮、等当前这一步结束后进入同一轮的消息摘要）。待关闭的不在这里，用户点名后用 MessageIssue，它会回到进行中。",
      { type: "object", properties: {} },
      async () =>
        ok(
          await Promise.all(
            deps.issues.listActive().filter((issue) => issue.status !== "awaiting_close").map(async (issue) => {
              const sessionId = issue.planningSessionId;
              const session = sessionId ? deps.sessions.get(sessionId) : undefined;
              let queued: string[] = [];
              if (sessionId) {
                try {
                  const runtime = await deps.runner.getRuntimeState(sessionId);
                  queued = runtime.queuedMessages.flatMap((item) => {
                    const preview = queuedPreview(item);
                    return preview ? [preview] : [];
                  });
                } catch {
                  queued = [];
                }
              }
              return {
                id: issue.id,
                title: issue.title,
                type: issue.type,
                description: issue.description,
                workdir: issue.workdir,
                sessionOpen: Boolean(sessionId),
                ...(session ? { sessionStatus: session.status, queued } : {}),
              };
            }),
          ),
        ),
    ),
    tool(
      "ListWorkdirs",
      "列出仍存在于磁盘的已知工作目录。",
      { type: "object", properties: {} },
      async () => {
        const dirs = new Set<string>();
        const add = (dir?: string) => {
          if (dir && fs.existsSync(dir)) dirs.add(dir);
        };
        for (const issue of deps.issues.listAll()) add(issue.workdir);
        for (const automation of deps.automations.list()) add(automation.workdir);
        for (const session of deps.sessions.list()) {
          if (session.origin === "user") add(session.workdir);
        }
        return ok([...dirs]);
      },
    ),
    tool(
      "CreateIssue",
      "创建 Issue。type 只是分类，不改变怎么开工。不填是 work。优先级默认 p1。",
      {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["p0", "p1", "p2"] },
          type: {
            type: "string",
            enum: ["bug", "feature", "research", "analysis", "review", "work"],
            description:
              "只做分类。bug、feature、research（调研）、analysis（分析）、review（检查）、work（兜底）。",
          },
        },
        required: ["title", "description"],
      },
      async (args) => {
        const title = text(args.title);
        const description = text(args.description);
        if (!title || !description) return fail("title and description required");
        const priority =
          args.priority === "p0" || args.priority === "p2" ? args.priority : "p1";
        const issue = deps.issues.create({
          title,
          description,
          priority,
          type: normalizeIssueType(args.type),
        });
        return ok(issue);
      },
    ),
    tool(
      "UpdateIssue",
      "修改已有 Issue 的标题、描述、优先级或分类。只改传入的字段。分类不改变怎么开工。已关闭的不能改。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["p0", "p1", "p2"] },
          type: {
            type: "string",
            enum: ["bug", "feature", "research", "analysis", "review", "work"],
            description:
              "只做分类。bug、feature、research（调研）、analysis（分析）、review（检查）、work（兜底）。",
          },
        },
        required: ["issueId"],
      },
      async (args) => {
        const issueId = text(args.issueId);
        if (!issueId) return fail("issueId required");
        const existing = deps.issues.get(issueId);
        if (!existing) return fail("not found");
        if (existing.status === "completed" || existing.status === "cancelled") {
          return fail("already closed");
        }
        const patch: {
          title?: string;
          description?: string;
          priority?: "p0" | "p1" | "p2";
          type?: "bug" | "feature" | "research" | "analysis" | "review" | "work";
        } = {};
        if (args.title !== undefined) {
          const title = text(args.title);
          if (!title) return fail("title required");
          patch.title = title;
        }
        if (args.description !== undefined) {
          patch.description = text(args.description);
        }
        if (args.priority !== undefined) {
          if (args.priority === "p0" || args.priority === "p1" || args.priority === "p2") {
            patch.priority = args.priority;
          } else {
            return fail("priority must be p0, p1, or p2");
          }
        }
        if (args.type !== undefined) {
          const type = normalizeIssueType(args.type);
          if (args.type !== type) return fail("type must be bug, feature, research, analysis, review, or work");
          patch.type = type;
        }
        if (Object.keys(patch).length === 0) return fail("nothing to update");
        try {
          const issue = deps.issues.update(issueId, patch);
          if (!issue) return fail("not found");
          deps.hub.broadcastAll({ type: "issue:changed" });
          return ok(issue);
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    ),
    tool(
      "OpenIssue",
      "给尚未打开会话的 Issue 打开会话。agentMode 不填或为 single 时是单会话，这个会话自己规划和改代码。新的需求开发用 split：改代码由规划会话排单到执行会话完成。修 bug、改代码时 worktree 必须为 true，服务器会建出 worktree，会话工作目录换成那个路径。baseBranch 不填则用该仓库的主分支。建不出来就不会开会话。只读、不改代码不要开 worktree。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          workdir: { type: "string" },
          worktree: { type: "boolean" },
          baseBranch: { type: "string" },
          agentMode: {
            type: "string",
            enum: ["single", "split"],
            description:
              "默认 single：一个会话自己规划和改代码。新的需求开发用 split：改代码由规划会话排单到执行会话完成。",
          },
        },
        required: ["issueId", "workdir"],
      },
      async (args) => {
        const issueId = text(args.issueId);
        const workdir = text(args.workdir);
        if (!issueId || !workdir) return fail("issueId and workdir required");
        const agentMode = args.agentMode === undefined || args.agentMode === "single"
          ? "single"
          : args.agentMode === "split"
            ? "split"
            : undefined;
        if (!agentMode) return fail("agentMode must be single or split");
        const issue = deps.issues.get(issueId);
        if (!issue) return fail("not found");
        if (issue.planningSessionId) {
          return ok({ sessionId: issue.planningSessionId, workdir: issue.workdir });
        }
        if (!fs.existsSync(workdir)) return fail("workdir not found");
        const baseBranch = text(args.baseBranch);
        let body: OpenIssueBody = {
          workdir,
          agentMode,
          worktreeEnabled: false,
        };
        if (args.worktree === true) {
          const create = deps.createWorktree ?? ((input) => createServerWorktree({ home: deps.home, ...input }));
          let created: ServerWorktree;
          try {
            created = await create({
              workdir,
              ...(baseBranch ? { baseBranch } : {}),
            });
          } catch (err: unknown) {
            return fail(err instanceof Error ? err.message : String(err));
          }
          body = {
            workdir: created.path,
            agentMode,
            worktreeEnabled: true,
            baseBranch: created.baseBranch,
            worktreeName: created.name,
            worktreeBranch: created.branch,
            worktreeRepoRoot: created.repoRoot,
          };
        }
        const opened = open(ctx, issueId, body);
        if (opened.status >= 400) {
          return fail(String(opened.json.error ?? "open failed"));
        }
        return ok(opened.json);
      },
    ),
    tool(
      "MessageIssue",
      "往 Issue 打开时创建的会话发送一条用户消息。会话正在跑时，消息会在当前这一步结束后进入同一轮，不中断正在进行的请求或工具，返回 joinedTurn。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          message: { type: "string" },
        },
        required: ["issueId", "message"],
      },
      async (args) => {
        const issue = deps.issues.get(text(args.issueId));
        const message = text(args.message);
        if (!issue?.planningSessionId) return fail("session not open");
        if (!message) return fail("message required");
        if (issue.status === "awaiting_close") {
          deps.issues.resume(issue.id);
          deps.hub.broadcastAll({ type: "issue:changed" });
        }
        const sessionId = issue.planningSessionId;
        const running = deps.sessions.get(sessionId)?.status === "running";
        await deps.runner.sendMessage(sessionId, message);
        return ok({
          accepted: true,
          ...(running ? { joinedTurn: true } : {}),
        });
      },
    ),
    tool(
      "CloseIssue",
      "关闭 Issue。action 为 complete 表示做完，note 写详细一点：做成了什么；是缺陷时简单写原因和方案。action 为 cancel 表示取消，note 一句原因就够。已完成不能再取消，已取消不能再完成。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          action: { type: "string", enum: ["complete", "cancel"] },
          note: {
            type: "string",
            description:
              "取消时一句原因就够。完成时写详细一点：做成了什么。缺陷要简单写原因和方案。",
          },
        },
        required: ["issueId", "action", "note"],
      },
      async (args) => {
        const issueId = text(args.issueId);
        const note = text(args.note);
        if (!note) return fail("note required");
        const issue = deps.issues.get(issueId);
        if (!issue) return fail("not found");
        try {
          if (args.action === "complete") {
            if (issue.status === "cancelled") return fail("already cancelled");
            const closed = deps.issues.complete(issueId, note);
            if (!closed) return fail("close failed");
            deps.hub.broadcastAll({ type: "issue:changed" });
            return ok({ id: closed.id, status: closed.status, closeNote: closed.closeNote });
          }
          if (args.action === "cancel") {
            if (issue.status === "completed") return fail("already completed");
            const closed = deps.issues.cancel(issueId, note);
            if (!closed) return fail("close failed");
            deps.hub.broadcastAll({ type: "issue:changed" });
            return ok({ id: closed.id, status: closed.status, closeNote: closed.closeNote });
          }
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
        return fail("action must be complete or cancel");
      },
    ),
    tool(
      "ResolvePermission",
      "审批 Issue 会话正在等待的权限。behavior 为 allow 或 deny。拿不准不要调用，先问用户。AskUserQuestion 允许时，message 是 JSON 对象字符串：键为 question 原文，单选值是 label 字符串，多选值是 label 数组，不要包 answers。",
      {
        type: "object",
        properties: {
          permissionId: { type: "string" },
          sessionId: { type: "string" },
          behavior: { type: "string", enum: ["allow", "deny"] },
          message: {
            type: "string",
            description:
              "拒绝原因用普通文本。AskUserQuestion 允许时必须是 JSON 对象字符串，键是 question 原文，单选值为 label，多选值为 label 数组。",
          },
        },
        required: ["permissionId", "sessionId", "behavior"],
      },
      async (args) => {
        const permissionId = text(args.permissionId);
        const sessionId = text(args.sessionId);
        const behavior = args.behavior === "allow" || args.behavior === "deny"
          ? args.behavior
          : undefined;
        if (!permissionId || !sessionId || !behavior) {
          return fail("permissionId, sessionId and behavior required");
        }
        const message = typeof args.message === "string" ? args.message : undefined;
        try {
          await deps.runner.respondPermission(sessionId, permissionId, {
            behavior,
            ...(message ? { message } : behavior === "deny" ? { message: "Denied" } : {}),
          });
        } catch (err: unknown) {
          return fail(err instanceof Error ? err.message : String(err));
        }
        return ok({ permissionId, behavior });
      },
    ),
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
        const { images, overflow } = inlineImages(files);
        const body = composeOutbound(message, files, links, overflow);
        if (args.app === "muse") {
          const line = deps.log.append(
            "assistant",
            body,
            images.length > 0 ? images : undefined,
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
          if (body) {
            msgIds.push(
              ...messageIds(await deps.sendText(receiver, body, atUids ? { atUids } : undefined)),
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
            body,
            images.length > 0 ? images : undefined,
            "popo",
            msgIds,
            rememberedIssueId,
          );
          deps.hub.broadcastAll({ type: "assistant:chat", line });
          return ok({ sent: true, receiver, msgIds, line });
        }
        return ok({ sent: true, receiver, msgIds });
      },
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
    ),
    createWebSearchTool({ home: deps.home, tavily: deps.tavily }),
  ];
}
