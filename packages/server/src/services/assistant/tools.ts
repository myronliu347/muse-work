import fs from "node:fs";
import type { ToolPlugin, ToolResult } from "@muse-work/agent";
import type { IssueStore } from "../issueStore.js";
import type { SessionStore } from "../sessionStore.js";
import type { SessionRunner } from "../sessionRunner/index.js";
import type { AutomationStore } from "../automationStore.js";
import type { WsHub } from "../wsHub.js";
import { ASSISTANT_TEXT_MAX, type createAssistantMessageLog } from "./messages.js";
import { openIssueSession, type OpenIssueBody } from "../issueOpen.js";

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
      "列出未完成 Issue：id、标题、描述、工作目录、会话是否已打开。",
      { type: "object", properties: {} },
      async () =>
        ok(
          deps.issues.listActive().map((issue) => ({
            id: issue.id,
            title: issue.title,
            description: issue.description,
            workdir: issue.workdir,
            sessionOpen: Boolean(issue.planningSessionId),
          })),
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
      "给尚未打开会话的 Issue 打开会话。模式默认 single，不启用 worktree。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          workdir: { type: "string" },
          agentMode: { type: "string", enum: ["single", "split"] },
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
        const body: OpenIssueBody = {
          workdir,
          agentMode: args.agentMode === "split" ? "split" : "single",
          worktreeEnabled: false,
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
      "往 Issue 打开时创建的会话发送一条用户消息。",
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
        await deps.runner.sendMessage(issue.planningSessionId, message);
        return ok({ accepted: true });
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
        return ok({ sent: true, receiver });
      },
    ),
    tool(
      "ListMuseMessages",
      "从最新一片往前查询 Muse 对话记录。",
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
        if (q) return ok(deps.log.search({ q, before, limit }));
        const page = deps.log.page({ before, limit });
        return ok({
          messages: page.messages.map((line) => {
            const clipped = truncateCodePoints(line.message, ASSISTANT_TEXT_MAX);
            return clipped.truncated
              ? { ...line, message: clipped.text, truncated: true }
              : line;
          }),
          hasMore: page.hasMore,
        });
      },
    ),
  ];
}
