import fs from "node:fs";
import { normalizeIssueType } from "../../issueStore.js";
import { openIssueSession, type OpenIssueBody } from "../../issueOpen.js";
import { createServerWorktree } from "../../gitWorktree.js";
import { ASSISTANT_TEXT_MAX } from "../messages.js";
import { compactText, fail, ok, text, tool, type AssistantToolDeps } from "./toolKit.js";

function clipAnswer(answer: string): { answer: string; truncated?: true } {
  const chars = [...answer];
  if (chars.length <= ASSISTANT_TEXT_MAX) return { answer };
  return { answer: chars.slice(0, ASSISTANT_TEXT_MAX).join(""), truncated: true };
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

export function createIssueTools(deps: AssistantToolDeps) {
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
      "列出未完成、且不是待关闭的 Issue：id、标题、描述、工作目录、会话是否已打开。已打开的还有 sessionStatus（idle、running、error）和 queued（还没收进当前轮、等当前这一步结束后进入同一轮的消息摘要）。待关闭的不在这里，除非 replyPending。replyPending 表示这一轮结束了，还没决定要不要告诉用户。replyNote 是派活时的交代，例如完全做完再告诉我。用户点名后用 MessageIssue，它会回到进行中。",
      { type: "object", properties: {} },
      async () =>
        ok(
          await Promise.all(
            deps.issues.listActive().filter((issue) => issue.status !== "awaiting_close" || issue.replyPending).map(async (issue) => {
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
                ...(issue.replyPending ? { replyPending: true as const } : {}),
                ...(issue.replyNote ? { replyNote: issue.replyNote } : {}),
              };
            }),
          ),
        ),
      () => "",
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
      () => "",
    ),
    tool(
      "CreateIssue",
      "创建 Issue。type 只是分类，不改变怎么开工。不填是 work。优先级默认 p1。",
      {
        type: "object",
        properties: {
          title: { type: "string" },
          description: {
            type: "string",
            description: "Markdown。详情面板按 Markdown 渲染。",
          },
          priority: { type: "string", enum: ["p0", "p1", "p2"] },
          type: {
            type: "string",
            enum: ["bug", "feature", "research", "analysis", "review", "work"],
            description:
              "只做分类。bug、feature、research（调研）、analysis（分析）、review（检查）、work（兜底）。",
          },
          note: {
            type: "string",
            description: "派活时留给自己的交代，例如做完发到群里。空字符串会清掉。",
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
        const created = deps.issues.create({
          title,
          description,
          priority,
          type: normalizeIssueType(args.type),
        });
        const issue =
          args.note === undefined
            ? created
            : deps.issues.setReplyNote(created.id, text(args.note)) ?? created;
        return ok(issue);
      },
      (params) => compactText(params.title),
    ),
    tool(
      "UpdateIssue",
      "修改已有 Issue 的标题、描述、优先级、分类或交代。只改传入的字段。分类不改变怎么开工。已关闭的不能改。settle 为 true 时只撕掉还没转达的纸条。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          title: { type: "string" },
          description: {
            type: "string",
            description: "Markdown。详情面板按 Markdown 渲染。",
          },
          priority: { type: "string", enum: ["p0", "p1", "p2"] },
          type: {
            type: "string",
            enum: ["bug", "feature", "research", "analysis", "review", "work"],
            description:
              "只做分类。bug、feature、research（调研）、analysis（分析）、review（检查）、work（兜底）。",
          },
          note: {
            type: "string",
            description: "派活时留给自己的交代，例如做完发到群里。空字符串会清掉。",
          },
          settle: {
            type: "boolean",
            description: "不用把结果告诉用户时传 true，只撕掉还没转达的纸条。",
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
        const hasNote = args.note !== undefined;
        const settle = args.settle === true;
        if (Object.keys(patch).length === 0 && !hasNote && !settle) return fail("nothing to update");
        try {
          let issue = Object.keys(patch).length > 0
            ? deps.issues.update(issueId, patch)
            : deps.issues.get(issueId);
          if (!issue) return fail("not found");
          if (hasNote) {
            if (typeof args.note !== "string") return fail("note must be a string");
            issue = deps.issues.setReplyNote(issueId, args.note) ?? issue;
          }
          if (settle) issue = deps.issues.clearReplyPending(issueId) ?? issue;
          deps.hub.broadcastAll({ type: "issue:changed" });
          return ok(issue);
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
      (params) => compactText(params.title) || compactText(params.issueId),
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
          let created: Awaited<ReturnType<typeof createServerWorktree>>;
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
      (params) => compactText(params.issueId),
    ),
    tool(
      "MessageIssue",
      "往 Issue 打开时创建的会话发送一条用户消息。已关闭的不能发。会话正在跑时，消息会在当前这一步结束后进入同一轮，不中断正在进行的请求或工具，返回 joinedTurn。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          message: { type: "string" },
          note: {
            type: "string",
            description: "派活时留给自己的交代，例如做完发到群里。空字符串会清掉。",
          },
        },
        required: ["issueId", "message"],
      },
      async (args) => {
        const issue = deps.issues.get(text(args.issueId));
        const message = text(args.message);
        if (!issue?.planningSessionId) return fail("session not open");
        if (!message) return fail("message required");
        if (issue.status === "completed" || issue.status === "cancelled") {
          return fail("already closed");
        }
        if (issue.status === "awaiting_close") {
          deps.issues.resume(issue.id);
          deps.hub.broadcastAll({ type: "issue:changed" });
        }
        if (args.note !== undefined) {
          if (typeof args.note !== "string") return fail("note must be a string");
          deps.issues.setReplyNote(issue.id, args.note);
        }
        const sessionId = issue.planningSessionId;
        const running = deps.sessions.get(sessionId)?.status === "running";
        await deps.runner.sendMessage(sessionId, message);
        return ok({
          accepted: true,
          ...(running ? { joinedTurn: true } : {}),
        });
      },
      (params) => compactText(params.message),
    ),
    tool(
      "AskIssue",
      "旁边问一句这个 Issue 的会话做到哪了。不写进会话，不打断正在跑的步骤。正在跑的会话优先；都没在跑时问执行会话，没有则问规划会话。只用来了解进度，不要在这里交代下一步。下一步用 MessageIssue。",
      {
        type: "object",
        properties: {
          issueId: { type: "string" },
          question: { type: "string" },
        },
        required: ["issueId", "question"],
      },
      async (args) => {
        const issue = deps.issues.get(text(args.issueId));
        const question = text(args.question);
        if (!issue) return fail("not found");
        if (!question) return fail("question required");
        const execution = issue.executionSessionId;
        const planning = issue.planningSessionId;
        const sessionId =
          (execution && deps.sessions.get(execution)?.status === "running"
            ? execution
            : undefined) ||
          (planning && deps.sessions.get(planning)?.status === "running"
            ? planning
            : undefined) ||
          execution ||
          planning;
        if (!sessionId) return fail("session not open");
        if (!deps.runner.askBtw) return fail("askBtw unavailable");
        let answer: string;
        try {
          answer = (await deps.runner.askBtw(sessionId, question)).trim();
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
        if (!answer) return fail("no answer");
        return ok({ sessionId, ...clipAnswer(answer) });
      },
      (params) => compactText(params.question),
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
      (params) => compactText(params.note) || compactText(params.issueId),
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
      (params) => compactText(params.behavior),
    ),
  ];
}
