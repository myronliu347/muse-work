import fs from "node:fs";
import type { ToolPlugin, ToolResult } from "@muse-work/agent";
import type { IssueStore } from "../issueStore.js";
import type { SessionStore } from "../sessionStore.js";
import type { SessionRunner } from "../sessionRunner/index.js";
import type { AutomationStore } from "../automationStore.js";
import type { WsHub } from "../wsHub.js";
import { ASSISTANT_TEXT_MAX, type createAssistantMessageLog } from "./messages.js";
import { openIssueSession, type OpenIssueBody } from "../issueOpen.js";
import { userMessageText } from "../sessionRunner/serialization.js";

type Log = ReturnType<typeof createAssistantMessageLog>;

export type AssistantToolDeps = {
  home: string;
  issues: IssueStore;
  sessions: SessionStore;
  runner: SessionRunner;
  automations: AutomationStore;
  log: Log;
  hub: WsHub;
  sendText?: (receiver: string, content: string) => Promise<void>;
  /** 主人账号。只有发给这个人的 POPO 私聊才写入对话列表。 */
  popoMasterUid?: () => string | undefined;
  openIssue?: typeof openIssueSession;
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
      "列出未完成 Issue：id、标题、描述、工作目录、会话是否已打开。已打开的还有 sessionStatus（idle、running、error）和 queued（排在当前轮后面的消息摘要）。",
      { type: "object", properties: {} },
      async () =>
        ok(
          await Promise.all(
            deps.issues.listActive().map(async (issue) => {
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
      "创建 Issue。优先级默认 p1，标签默认空。",
      {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["p0", "p1", "p2"] },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title", "description"],
      },
      async (args) => {
        const title = text(args.title);
        const description = text(args.description);
        if (!title || !description) return fail("title and description required");
        const priority =
          args.priority === "p0" || args.priority === "p2" ? args.priority : "p1";
        const tags = Array.isArray(args.tags)
          ? args.tags.filter((tag): tag is string => typeof tag === "string")
          : [];
        const issue = deps.issues.create({ title, description, priority, tags });
        return ok(issue);
      },
    ),
    tool(
      "OpenIssue",
      "给尚未打开会话的 Issue 打开 single 会话。修 bug、改代码时 worktree 必须为 true，会话建在单独的 worktree 里。baseBranch 不填则用该仓库的主分支。只读、不改代码不要开 worktree。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          workdir: { type: "string" },
          worktree: { type: "boolean" },
          baseBranch: { type: "string" },
        },
        required: ["issueId", "workdir"],
      },
      async (args) => {
        const issueId = text(args.issueId);
        const workdir = text(args.workdir);
        if (!issueId || !workdir) return fail("issueId and workdir required");
        const issue = deps.issues.get(issueId);
        if (!issue) return fail("not found");
        if (issue.planningSessionId) {
          return ok({ sessionId: issue.planningSessionId, workdir: issue.workdir });
        }
        if (!fs.existsSync(workdir)) return fail("workdir not found");
        const baseBranch = text(args.baseBranch);
        const body: OpenIssueBody = {
          workdir,
          agentMode: "single",
          worktreeEnabled: args.worktree === true,
          ...(args.worktree === true && baseBranch ? { baseBranch } : {}),
        };
        const opened = open(ctx, issueId, body);
        if (opened.status >= 400) {
          return fail(String(opened.json.error ?? "open failed"));
        }
        return ok(opened.json);
      },
    ),
    tool(
      "MessageIssue",
      "往 Issue 打开时创建的会话发送一条用户消息。默认排在当前轮后面。interrupt 为 true 时先中断当前轮再发，已排队的消息会被丢掉；这一轮如果正在等权限，中断会拒绝那次权限。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          message: { type: "string" },
          interrupt: { type: "boolean" },
        },
        required: ["issueId", "message"],
      },
      async (args) => {
        const issue = deps.issues.get(text(args.issueId));
        const message = text(args.message);
        if (!issue?.planningSessionId) return fail("session not open");
        if (!message) return fail("message required");
        const sessionId = issue.planningSessionId;
        const interrupt =
          args.interrupt === true && deps.sessions.get(sessionId)?.status === "running";
        if (interrupt) await deps.runner.abortMessage(sessionId);
        await deps.runner.sendMessage(sessionId, message);
        return ok({ accepted: true, ...(interrupt ? { interrupted: true } : {}) });
      },
    ),
    tool(
      "CloseIssue",
      "关闭 Issue。action 为 complete 表示做完，cancel 表示取消。已完成不能再取消，已取消不能再完成。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          action: { type: "string", enum: ["complete", "cancel"] },
        },
        required: ["issueId", "action"],
      },
      async (args) => {
        const issueId = text(args.issueId);
        const issue = deps.issues.get(issueId);
        if (!issue) return fail("not found");
        if (args.action === "complete") {
          if (issue.status === "cancelled") return fail("already cancelled");
          const closed = deps.issues.complete(issueId);
          if (!closed) return fail("close failed");
          deps.hub.broadcastAll({ type: "issue:changed" });
          return ok({ id: closed.id, status: closed.status });
        }
        if (args.action === "cancel") {
          if (issue.status === "completed") return fail("already completed");
          const closed = deps.issues.cancel(issueId);
          if (!closed) return fail("close failed");
          deps.hub.broadcastAll({ type: "issue:changed" });
          return ok({ id: closed.id, status: closed.status });
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
      "回复 Muse 或 POPO。app 为 muse 或 popo。popo 有 groupId 则发群，否则发给 user。",
      {
        type: "object",
        properties: {
          message: { type: "string" },
          app: { type: "string", enum: ["muse", "popo"] },
          user: { type: "string" },
          groupId: { type: "string" },
        },
        required: ["message", "app"],
      },
      async (args) => {
        const message = typeof args.message === "string" ? args.message : "";
        if (!message.trim()) return fail("message required");
        if (args.app === "muse") {
          const line = deps.log.append("assistant", message);
          deps.hub.broadcastAll({ type: "assistant:chat", line });
          return ok({ line });
        }
        if (args.app !== "popo") return fail("app must be muse or popo");
        const groupId = text(args.groupId);
        const user = text(args.user);
        const receiver = groupId || user;
        if (!receiver || !deps.sendText) return fail("popo recipient required");
        await deps.sendText(receiver, message);
        const master = deps.popoMasterUid?.()?.trim();
        if (!groupId && master && user === master) {
          const line = deps.log.append("assistant", message, undefined, "popo");
          deps.hub.broadcastAll({ type: "assistant:chat", line });
          return ok({ sent: true, receiver, line });
        }
        return ok({ sent: true, receiver });
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
              message: clipped.text,
              ...(truncated ? { truncated: true } : {}),
            };
          }),
        });
      },
    ),
  ];
}
