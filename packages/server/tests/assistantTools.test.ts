import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIssueStore } from "../src/services/issueStore.js";
import { createSessionStore } from "../src/services/sessionStore.js";
import { createAutomationStore } from "../src/services/automationStore.js";
import { createAssistantMessageLog } from "../src/services/assistant/messages.js";
import { createAssistantTools } from "../src/services/assistant/tools.js";
import type { WsHub } from "../src/services/wsHub.js";
import type { OpenIssueBody } from "../src/services/issueOpen.js";

function tool(tools: ReturnType<typeof createAssistantTools>, name: string) {
  const found = tools.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

describe("assistant tools", () => {
  it("creates issues, opens once, messages, and records muse replies", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-tools-"));
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-wd-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const automations = createAutomationStore({ home });
    const log = createAssistantMessageLog({ home });
    const broadcasts: unknown[] = [];
    const decisions: Array<{ sessionId: string; permissionId: string; behavior: string }> = [];
    const opened: OpenIssueBody[] = [];
    const hub = { broadcastAll: (event: unknown) => broadcasts.push(event) } as WsHub;
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations,
      log,
      hub,
      runner: {
        sendMessage: async () => ({ accepted: true as const }),
        respondPermission: async (
          sessionId: string,
          permissionId: string,
          decision: { behavior: string },
        ) => {
          decisions.push({ sessionId, permissionId, behavior: decision.behavior });
          return { ok: true as const };
        },
        getMessages: async () => [
          {
            id: "m1",
            role: "assistant",
            blocks: [{ type: "text", content: "更早的结论" }],
          },
          {
            id: "m2",
            role: "user",
            blocks: [{ type: "text", content: "中间一句" }],
          },
          {
            id: "m3",
            role: "assistant",
            blocks: [{ type: "text", content: `完整结论${"你".repeat(9000)}` }],
          },
        ],
      } as never,
      openIssue: (_ctx, id, body) => {
        opened.push(body);
        issues.setPlanning(id, {
          planningSessionId: "s1",
          workdir: body.workdir ?? workdir,
          worktreeEnabled: false,
          agentMode: body.agentMode === "split" ? "split" : "single",
        });
        return { status: 200, json: { sessionId: "s1", workdir: body.workdir } };
      },
    });
    const context = { workdir, taskManager: {} as never };
    for (const entry of tools) {
      expect(typeof entry.formatCompactParams).toBe("function");
    }
    expect(
      tool(tools, "CreateIssue").formatCompactParams?.({ title: "圆角还没对齐" }, context),
    ).toBe("圆角还没对齐");
    expect(
      tool(tools, "WebSearch").formatCompactParams?.({ query: "muse dock" }, context),
    ).toBe("muse dock");
    expect(
      tool(tools, "SendMessage").formatCompactParams?.(
        { message: `你好${"呀".repeat(100)}` },
        context,
      ),
    ).toBe(`你好${"呀".repeat(78)}…`);

    const created = await tool(tools, "CreateIssue").execute(
      { title: "登录", description: "修登录" },
      context,
    );
    expect(created.success).toBe(true);
    const issue = JSON.parse(created.content) as { id: string; priority: string; type: string };
    expect(issue.priority).toBe("p1");
    expect(issue.type).toBe("work");

    const updated = await tool(tools, "UpdateIssue").execute(
      {
        issueId: issue.id,
        title: "改标题",
        description: "新描述",
        priority: "p0",
        type: "bug",
      },
      context,
    );
    expect(updated.success).toBe(true);
    expect(issues.get(issue.id)).toMatchObject({
      title: "改标题",
      description: "新描述",
      priority: "p0",
      type: "bug",
    });

    const missing = await tool(tools, "OpenIssue").execute(
      { issueId: issue.id, workdir: path.join(workdir, "nope") },
      context,
    );
    expect(missing.success).toBe(false);

    const openedOnce = await tool(tools, "OpenIssue").execute(
      { issueId: issue.id, workdir },
      context,
    );
    expect(openedOnce.success).toBe(true);
    expect(opened[0]?.worktreeEnabled).toBe(false);
    expect(opened[0]?.agentMode).toBe("single");
    const openedAgain = await tool(tools, "OpenIssue").execute(
      { issueId: issue.id, workdir },
      context,
    );
    expect(JSON.parse(openedAgain.content).sessionId).toBe("s1");
    expect(opened).toHaveLength(1);

    const splitCreated = await tool(tools, "CreateIssue").execute(
      { title: "方案", description: "先规划再改" },
      context,
    );
    const splitId = (JSON.parse(splitCreated.content) as { id: string }).id;
    const splitOpen = await tool(tools, "OpenIssue").execute(
      { issueId: splitId, workdir, agentMode: "split" },
      context,
    );
    expect(splitOpen.success).toBe(true);
    expect(opened[1]?.agentMode).toBe("split");
    const badMode = await tool(tools, "OpenIssue").execute(
      { issueId: splitId, workdir, agentMode: "multi" },
      context,
    );
    expect(badMode.success).toBe(false);
    expect(opened).toHaveLength(2);

    const noSession = await tool(tools, "MessageIssue").execute(
      { issueId: "missing", message: "hi" },
      context,
    );
    expect(noSession.error).toBe("session not open");

    const muse = await tool(tools, "SendMessage").execute(
      { app: "muse", message: "好" },
      context,
    );
    expect(muse.success).toBe(true);
    expect(log.page().messages[0]?.role).toBe("assistant");

    const unknown = await tool(tools, "SendMessage").execute(
      { app: "channel", message: "群" },
      context,
    );
    expect(unknown.success).toBe(false);
    expect(log.page().messages).toHaveLength(1);

    log.append("user", "你".repeat(8001));
    const listed = await tool(tools, "ListMuseMessages").execute({}, context);
    const body = JSON.parse(listed.content) as {
      messages: Array<{ message: string; truncated?: boolean }>;
    };
    const long = body.messages.find((line) => line.truncated);
    expect(long).toBeTruthy();
    expect([...(long?.message ?? "")].length).toBe(8000);

    const full = await tool(tools, "ReadSessionMessages").execute(
      { issueId: issue.id },
      context,
    );
    const read = JSON.parse(full.content) as {
      planning: {
        messages: Array<{ id?: string; role: string; text: string; truncated?: boolean }>;
        omitted: number;
      };
    };
    expect(read.planning.omitted).toBe(2);
    expect(read.planning.messages).toHaveLength(1);
    expect(read.planning.messages[0]?.id).toBe("m3");
    expect(read.planning.messages[0]?.truncated).toBe(true);
    expect([...(read.planning.messages[0]?.text ?? "")].length).toBe(8000);
    expect(read.planning.messages[0]?.text.startsWith("完整结论")).toBe(false);

    const older = await tool(tools, "ReadSessionMessages").execute(
      { issueId: issue.id, before: "m3" },
      context,
    );
    const olderBody = JSON.parse(older.content) as {
      planning: { messages: Array<{ id?: string; text: string }>; omitted: number };
    };
    expect(olderBody.planning.omitted).toBe(0);
    expect(olderBody.planning.messages.map((line) => line.id)).toEqual(["m1", "m2"]);
    expect(olderBody.planning.messages[0]?.text).toBe("更早的结论");

    const closed = await tool(tools, "CloseIssue").execute(
      { issueId: issue.id, action: "complete", note: "登录修好了" },
      context,
    );
    expect(closed.success).toBe(true);
    expect(issues.get(issue.id)?.status).toBe("completed");
    expect(issues.get(issue.id)?.closeNote).toBe("登录修好了");
    const resolved = await tool(tools, "ResolvePermission").execute(
      { permissionId: "perm-1", sessionId: "s1", behavior: "allow" },
      context,
    );
    expect(resolved.success).toBe(true);
    expect(decisions).toEqual([{ sessionId: "s1", permissionId: "perm-1", behavior: "allow" }]);
    const missingPermission = await tool(tools, "ResolvePermission").execute(
      { permissionId: "", sessionId: "s1", behavior: "deny" },
      context,
    );
    expect(missingPermission.success).toBe(false);

    expect(broadcasts).toContainEqual({ type: "issue:changed" });

    expect(tools.map((entry) => entry.name)).toEqual([
      "ListIssues",
      "ListWorkdirs",
      "CreateIssue",
      "UpdateIssue",
      "OpenIssue",
      "MessageIssue",
      "AskIssue",
      "AbortMessageIssue",
      "CloseIssue",
      "ResolvePermission",
      "SendMessage",
      "ReadSessionMessages",
      "ListMuseMessages",
      "WebSearch",
    ]);
  });

  it("opens a code issue on the worktree the server created", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-wt-"));
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-repo-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const automations = createAutomationStore({ home });
    const log = createAssistantMessageLog({ home });
    const opened: OpenIssueBody[] = [];
    const asked: Array<{ workdir: string; baseBranch?: string }> = [];
    const hub = { broadcastAll: () => {} } as WsHub;
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations,
      log,
      hub,
      runner: {} as never,
      createWorktree: async (args) => {
        asked.push(args);
        if (args.baseBranch === "missing") throw new Error("branch not found");
        return {
          path: `/trees/${args.baseBranch ?? "main"}`,
          name: "gentle-pike",
          branch: "worktree-gentle-pike",
          baseBranch: args.baseBranch ?? "origin/main",
          repoRoot: args.workdir,
        };
      },
      openIssue: (ctx, issueId, body) => {
        opened.push(body);
        ctx.issueStore.setPlanning(issueId, {
          planningSessionId: `s-${issueId}`,
          workdir: body.workdir ?? "",
          worktreeEnabled: Boolean(body.worktreeEnabled),
          baseBranch: body.baseBranch,
          agentMode: body.agentMode === "single" ? "single" : "split",
        });
        ctx.hub.broadcastAll({ type: "issue:changed" });
        return { status: 200, json: { sessionId: `s-${issueId}`, workdir: body.workdir } };
      },
    });
    const context = { sessionId: "assistant", toolUseId: "tool-1" };
    const issue = issues.create({ title: "修一下" });

    const onMain = await tool(tools, "OpenIssue").execute(
      { issueId: issue.id, workdir, worktree: true },
      context,
    );
    expect(onMain.success).toBe(true);
    expect(asked[0]).toEqual({ workdir });
    expect(opened[0]).toEqual({
      workdir: "/trees/main",
      agentMode: "single",
      worktreeEnabled: true,
      baseBranch: "origin/main",
      worktreeName: "gentle-pike",
      worktreeBranch: "worktree-gentle-pike",
      worktreeRepoRoot: workdir,
    });
    expect(JSON.parse(onMain.content)).toEqual({
      sessionId: `s-${issue.id}`,
      workdir: "/trees/main",
    });

    const other = issues.create({ title: "改分支" });
    const onDev = await tool(tools, "OpenIssue").execute(
      { issueId: other.id, workdir, worktree: true, baseBranch: "dev" },
      context,
    );
    expect(onDev.success).toBe(true);
    expect(asked[1]).toEqual({ workdir, baseBranch: "dev" });
    expect(opened[1]?.workdir).toBe("/trees/dev");
    expect(opened[1]?.baseBranch).toBe("dev");

    const blocked = issues.create({ title: "建失败" });
    const failed = await tool(tools, "OpenIssue").execute(
      { issueId: blocked.id, workdir, worktree: true, baseBranch: "missing" },
      context,
    );
    expect(failed.success).toBe(false);
    expect(failed.error).toContain("branch not found");
    expect(opened).toHaveLength(2);
    expect(issues.get(blocked.id)?.planningSessionId).toBeUndefined();
  });

  it("moves an open analysis session onto the server worktree", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-move-"));
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-move-wd-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const automations = createAutomationStore({ home });
    const log = createAssistantMessageLog({ home });
    const broadcasts: unknown[] = [];
    const asked: Array<{ workdir: string; baseBranch?: string }> = [];
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations,
      log,
      hub: { broadcastAll: (event: unknown) => broadcasts.push(event) } as WsHub,
      runner: {} as never,
      createWorktree: async (args) => {
        asked.push(args);
        if (args.baseBranch === "missing") throw new Error("branch not found");
        return {
          path: "/trees/main",
          name: "gentle-pike",
          branch: "worktree-gentle-pike",
          baseBranch: args.baseBranch ?? "origin/main",
          repoRoot: args.workdir,
        };
      },
    });
    const planning = sessions.create({ workdir, model: "m" });
    const execution = sessions.create({ workdir, model: "m", title: "执行" });
    const issue = issues.create({ title: "先看看" });
    issues.setPlanning(issue.id, {
      planningSessionId: planning.id,
      workdir,
      worktreeEnabled: false,
      agentMode: "single",
    });
    issues.setExecutionSessionId(issue.id, execution.id);
    const context = { sessionId: "assistant", toolUseId: "tool-1" };

    const moved = await tool(tools, "OpenIssue").execute(
      { issueId: issue.id, workdir, worktree: true },
      context,
    );
    expect(moved.success).toBe(true);
    expect(JSON.parse(moved.content)).toEqual({
      sessionId: planning.id,
      workdir: "/trees/main",
    });
    expect(asked).toEqual([{ workdir }]);
    expect(sessions.get(planning.id)).toMatchObject({
      workdir: "/trees/main",
      worktreeName: "gentle-pike",
      worktreeBranch: "worktree-gentle-pike",
      baseBranch: "origin/main",
      worktreeRepoRoot: workdir,
    });
    expect(sessions.get(execution.id)?.workdir).toBe("/trees/main");
    expect(issues.get(issue.id)).toMatchObject({
      workdir: "/trees/main",
      worktreeEnabled: true,
      status: "planning",
    });
    expect(broadcasts).toContainEqual({ type: "issue:changed" });

    const again = await tool(tools, "OpenIssue").execute(
      { issueId: issue.id, workdir, worktree: true },
      context,
    );
    expect(again.success).toBe(true);
    expect(asked).toHaveLength(1);

    const stuck = issues.create({ title: "还在主仓" });
    const stuckSession = sessions.create({ workdir, model: "m" });
    issues.setPlanning(stuck.id, {
      planningSessionId: stuckSession.id,
      workdir,
      worktreeEnabled: false,
      agentMode: "single",
    });
    const failed = await tool(tools, "OpenIssue").execute(
      { issueId: stuck.id, workdir, worktree: true, baseBranch: "missing" },
      context,
    );
    expect(failed.success).toBe(false);
    expect(sessions.get(stuckSession.id)?.workdir).toBe(workdir);
    expect(issues.get(stuck.id)?.worktreeEnabled).toBe(false);
  });

  it("joins a running issue session without interrupting it", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-msg-"));
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-msg-wd-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const automations = createAutomationStore({ home });
    const log = createAssistantMessageLog({ home });
    const order: string[] = [];
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations,
      log,
      hub: { broadcastAll: () => {} } as WsHub,
      runner: {
        sendMessage: async (sessionId: string, content: string) => {
          order.push(`send:${sessionId}:${content}`);
          return { accepted: true as const };
        },
        getRuntimeState: async () => ({
          loading: true,
          queuedMessages: [
            { content: "先看日志" },
            { type: "notification", content: "后台任务结束" },
          ],
        }),
      } as never,
    });
    const running = sessions.create({ workdir, model: "m" });
    sessions.updateStatus(running.id, "running");
    const busy = issues.create({ title: "正在做", description: "修登录" });
    issues.setPlanning(busy.id, {
      planningSessionId: running.id,
      workdir,
      worktreeEnabled: false,
      agentMode: "single",
    });
    const context = { sessionId: "assistant", toolUseId: "tool-1" };
    const listed = await tool(tools, "ListIssues").execute({}, context);
    const rows = JSON.parse(listed.content) as Array<{
      id: string;
      sessionStatus?: string;
      queued?: string[];
    }>;
    expect(rows.find((row) => row.id === busy.id)).toMatchObject({
      sessionStatus: "running",
      queued: ["先看日志"],
    });

    const queued = await tool(tools, "MessageIssue").execute(
      { issueId: busy.id, message: "再看一下配置" },
      context,
    );
    expect(JSON.parse(queued.content)).toEqual({
      accepted: true,
      joinedTurn: true,
    });

    expect(order).toEqual([`send:${running.id}:再看一下配置`]);
    const messageIssue = tools.find((entry) => entry.name === "MessageIssue");
    expect(messageIssue?.config.function.parameters).toEqual({
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
    });
    expect(messageIssue?.config.function.description).not.toContain("interrupt");
  });

  it("keeps file paths and links in a Muse reply", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-file-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-attach-"));
    const png = path.join(dir, "shot.png");
    const note = path.join(dir, "note.txt");
    fs.writeFileSync(png, Buffer.from("png-bytes"));
    fs.writeFileSync(note, "hello");
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const automations = createAutomationStore({ home });
    const log = createAssistantMessageLog({ home });
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations,
      log,
      hub: { broadcastAll: () => undefined } as WsHub,
      runner: {} as never,
    });
    const context = { sessionId: "assistant", toolUseId: "tool-1" };
    const muse = await tool(tools, "SendMessage").execute(
      {
        app: "muse",
        message: "看这个",
        files: [png, note],
        links: ["https://example.com/a"],
      },
      context,
    );
    expect(muse.success).toBe(true);
    const museLine = log.page().messages[0];
    expect(museLine?.message).toContain("https://example.com/a");
    expect(museLine?.message).toContain(note);
    expect(museLine?.message).toContain(png);
    expect(museLine?.images).toBeUndefined();
    expect(muse.content).not.toContain("base64");

    const missing = await tool(tools, "SendMessage").execute(
      { app: "muse", message: "", files: ["relative.png"] },
      context,
    );
    expect(missing.success).toBe(false);
  });

  it("prefixes a reply when the issue changes and skips it when the last one matches", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-mention-"));
    const issues = createIssueStore({ home });
    const log = createAssistantMessageLog({ home });
    const tools = createAssistantTools({
      home,
      issues,
      sessions: createSessionStore({ home }),
      automations: createAutomationStore({ home }),
      log,
      hub: { broadcastAll: () => undefined } as WsHub,
      runner: {} as never,
    });
    const context = { sessionId: "assistant", toolUseId: "tool-1" };
    const analysis = issues.create({ title: "高码澄清", description: "查" });
    const design = issues.create({ title: "设计系统", description: "做" });

    log.append("user", `接着看 [@issue:${analysis.id} 高码澄清]`);
    const same = await tool(tools, "SendMessage").execute(
      { app: "muse", ats: [{ type: "issue", id: analysis.id }], message: "查到了" },
      context,
    );
    expect(same.success).toBe(true);
    expect(log.page().messages.at(-1)?.message).toBe("查到了");

    const switched = await tool(tools, "SendMessage").execute(
      { app: "muse", ats: [{ type: "issue", id: design.id }], message: "卡在提问上" },
      context,
    );
    expect(switched.success).toBe(true);
    expect(log.page().messages.at(-1)?.message).toBe(
      `> 设计系统\n\n卡在提问上`,
    );

    const again = await tool(tools, "SendMessage").execute(
      { app: "muse", ats: [{ type: "issue", id: design.id }], message: "还是这条" },
      context,
    );
    expect(again.success).toBe(true);
    expect(log.page().messages.at(-1)?.message).toBe("还是这条");

    const museUser = await tool(tools, "SendMessage").execute(
      { app: "muse", ats: [{ type: "user", id: "a@corp.netease.com" }], message: "不行" },
      context,
    );
    expect(museUser.success).toBe(false);

    const missing = await tool(tools, "SendMessage").execute(
      { app: "muse", ats: [{ type: "issue", id: "missing" }], message: "没有" },
      context,
    );
    expect(missing.success).toBe(false);
  });

  it("hides awaiting-close issues and resumes them when messaging", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-ready-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const issue = issues.create({ title: "修登录", description: "修" });
    const session = sessions.create({ workdir: "/tmp/a", model: "m", title: "修登录" });
    issues.setPlanning(issue.id, {
      planningSessionId: session.id,
      workdir: "/tmp/a",
      worktreeEnabled: false,
      agentMode: "single",
    });
    issues.markReady(issue.id);
    const broadcasts: unknown[] = [];
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations: createAutomationStore({ home }),
      log: createAssistantMessageLog({ home }),
      hub: { broadcastAll: (event: unknown) => broadcasts.push(event) } as WsHub,
      runner: {
        sendMessage: async () => ({ accepted: true as const }),
        getRuntimeState: async () => ({ queuedMessages: [] }),
      } as never,
    });
    const context = { workdir: "/tmp/a", taskManager: {} as never };
    const listed = await tool(tools, "ListIssues").execute({}, context);
    expect(JSON.parse(listed.content)).toEqual([]);
    const sent = await tool(tools, "MessageIssue").execute(
      { issueId: issue.id, message: "接着改一下文案" },
      context,
    );
    expect(sent.success).toBe(true);
    expect(issues.get(issue.id)?.status).toBe("planning");
    expect(broadcasts).toEqual([{ type: "issue:changed" }]);
  });

  it("refuses to message a completed or cancelled issue", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-closed-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const sent: string[] = [];
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations: createAutomationStore({ home }),
      log: createAssistantMessageLog({ home }),
      hub: { broadcastAll: () => {} } as WsHub,
      runner: {
        sendMessage: async (_sessionId: string, content: string) => {
          sent.push(content);
          return { accepted: true as const };
        },
      } as never,
    });
    const context = { sessionId: "assistant", toolUseId: "tool-1" };
    const completed = issues.create({ title: "做完的", description: "修" });
    const completedSession = sessions.create({
      workdir: "/tmp/a",
      model: "m",
      title: "做完的",
    });
    issues.setPlanning(completed.id, {
      planningSessionId: completedSession.id,
      workdir: "/tmp/a",
      worktreeEnabled: false,
      agentMode: "single",
    });
    issues.complete(completed.id, "做完了");

    const refused = await tool(tools, "MessageIssue").execute(
      { issueId: completed.id, message: "再改一下" },
      context,
    );
    expect(refused.success).toBe(false);
    expect(refused.error).toBe("already closed");

    const cancelled = issues.create({ title: "取消的", description: "先停" });
    const cancelledSession = sessions.create({
      workdir: "/tmp/a",
      model: "m",
      title: "取消的",
    });
    issues.setPlanning(cancelled.id, {
      planningSessionId: cancelledSession.id,
      workdir: "/tmp/a",
      worktreeEnabled: false,
      agentMode: "single",
    });
    issues.cancel(cancelled.id, "不做了");
    const refusedCancel = await tool(tools, "MessageIssue").execute(
      { issueId: cancelled.id, message: "还是做吧" },
      context,
    );
    expect(refusedCancel.success).toBe(false);
    expect(refusedCancel.error).toBe("already closed");
    expect(sent).toEqual([]);

    const messageIssue = tools.find((entry) => entry.name === "MessageIssue");
    expect(messageIssue?.config.function.description).toContain("已关闭");
  });

  it("asks the running session without sending it a message", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-ask-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const automations = createAutomationStore({ home });
    const log = createAssistantMessageLog({ home });
    const sent: string[] = [];
    const asked: Array<{ sessionId: string; question: string }> = [];
    const planning = sessions.create({ workdir: "/tmp/a", model: "m", title: "规划" });
    const execution = sessions.create({ workdir: "/tmp/a", model: "m", title: "执行" });
    sessions.updateStatus(execution.id, "running");
    const issue = issues.create({ title: "改登录", description: "白屏" });
    issues.setPlanning(issue.id, {
      planningSessionId: planning.id,
      workdir: "/tmp/a",
      worktreeEnabled: true,
      agentMode: "split",
    });
    issues.setExecutionSessionId(issue.id, execution.id);
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations,
      log,
      hub: { broadcastAll: () => {} } as WsHub,
      runner: {
        sendMessage: async (_sessionId: string, content: string) => {
          sent.push(content);
          return { accepted: true as const };
        },
        askBtw: async (sessionId: string, question: string) => {
          asked.push({ sessionId, question });
          return "正在改登录页，测试还没跑。";
        },
      } as never,
    });
    const context = { workdir: "/tmp/a", taskManager: {} as never };

    const result = await tool(tools, "AskIssue").execute(
      { issueId: issue.id, question: "做到哪了" },
      context,
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toEqual({
      sessionId: execution.id,
      answer: "正在改登录页，测试还没跑。",
    });
    expect(asked).toEqual([{ sessionId: execution.id, question: "做到哪了" }]);
    expect(sent).toEqual([]);
  });

  it("rejects a long chat body unless a file is attached or the user asked for the full text", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-length-"));
    const log = createAssistantMessageLog({ home });
    const note = path.join(home, "report.md");
    fs.writeFileSync(note, "报告正文");
    const tools = createAssistantTools({
      home,
      issues: createIssueStore({ home }),
      sessions: createSessionStore({ home }),
      automations: createAutomationStore({ home }),
      log,
      hub: { broadcastAll: () => undefined } as WsHub,
      runner: {} as never,
    });
    const context = { sessionId: "assistant", toolUseId: "tool-1" };
    const long = "字".repeat(201);
    const boundary = "字".repeat(200);

    const rejected = await tool(tools, "SendMessage").execute(
      { app: "muse", message: long },
      context,
    );
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain("200");
    expect(log.page().messages).toEqual([]);

    const exact = await tool(tools, "SendMessage").execute(
      { app: "muse", message: boundary },
      context,
    );
    expect(exact.success).toBe(true);
    expect(log.page().messages.at(-1)?.message).toBe(boundary);

    const attached = await tool(tools, "SendMessage").execute(
      { app: "muse", message: long, files: [note] },
      context,
    );
    expect(attached.success).toBe(true);
    expect(log.page().messages.at(-1)?.message).toContain(long);

    log.append("user", "写在聊天里，我要看全文，不要附件");
    const inline = await tool(tools, "SendMessage").execute(
      { app: "muse", message: long },
      context,
    );
    expect(inline.success).toBe(true);
    expect(log.page().messages.at(-1)?.message).toBe(long);

    log.append("user", "好");
    const later = await tool(tools, "SendMessage").execute(
      { app: "muse", message: long },
      context,
    );
    expect(later.success).toBe(false);
    expect(log.page().messages.at(-1)?.message).toBe("好");
  });

  it("lists a pending reply and clears it when that issue is told", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-reply-"));
    const issues = createIssueStore({ home });
    const log = createAssistantMessageLog({ home });
    const issue = issues.create({ title: "修登录", description: "修" });
    issues.setReplyNote(issue.id, "做完发到群里");
    issues.markReplyPending(issue.id);
    issues.setPlanning(issue.id, {
      planningSessionId: "s1",
      workdir: "/tmp/a",
      worktreeEnabled: false,
      agentMode: "single",
    });
    issues.markReady(issue.id);
    const tools = createAssistantTools({
      home,
      issues,
      sessions: createSessionStore({ home }),
      automations: createAutomationStore({ home }),
      log,
      hub: { broadcastAll: () => undefined } as WsHub,
      runner: {} as never,
    });
    const context = { sessionId: "assistant", toolUseId: "tool-1" };

    const listed = await tool(tools, "ListIssues").execute({}, context);
    expect(JSON.parse(listed.content)).toEqual([
      expect.objectContaining({
        id: issue.id,
        replyPending: true,
        replyNote: "做完发到群里",
      }),
    ]);

    const rewritten = await tool(tools, "UpdateIssue").execute(
      { issueId: issue.id, note: "改成私聊说" },
      context,
    );
    expect(rewritten.success).toBe(true);
    expect(issues.get(issue.id)?.replyNote).toBe("改成私聊说");

    const told = await tool(tools, "SendMessage").execute(
      { app: "muse", message: "登录改好了", issueId: issue.id },
      context,
    );
    expect(told.success).toBe(true);
    expect(log.page().messages.at(-1)?.message).toBe("登录改好了");
    expect(issues.get(issue.id)?.replyPending).toBeUndefined();
    expect(issues.get(issue.id)?.replyNote).toBe("改成私聊说");

    issues.markReplyPending(issue.id);
    const missing = await tool(tools, "SendMessage").execute(
      { app: "muse", message: "没有这件", issueId: "missing" },
      context,
    );
    expect(missing.success).toBe(false);
    expect(issues.get(issue.id)?.replyPending).toBe(true);
  });

  it("aborts the running issue turn without closing it", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-abort-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const issue = issues.create({ title: "修登录", description: "修" });
    const planning = sessions.create({ workdir: "/tmp/a", model: "m", title: "规划" });
    const execution = sessions.create({ workdir: "/tmp/a", model: "m", title: "执行" });
    sessions.updateStatus(execution.id, "running");
    issues.setPlanning(issue.id, {
      planningSessionId: planning.id,
      workdir: "/tmp/a",
      worktreeEnabled: false,
      agentMode: "split",
    });
    issues.setExecutionSessionId(issue.id, execution.id);
    const aborted: string[] = [];
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations: createAutomationStore({ home }),
      log: createAssistantMessageLog({ home }),
      hub: { broadcastAll: () => undefined } as WsHub,
      runner: {
        abortMessage: async (sessionId: string) => {
          aborted.push(sessionId);
          return { ok: true as const };
        },
      } as never,
    });
    const context = { workdir: "/tmp/a", taskManager: {} as never };
    const stopped = await tool(tools, "AbortMessageIssue").execute(
      { issueId: issue.id },
      context,
    );
    expect(stopped.success).toBe(true);
    expect(JSON.parse(stopped.content)).toEqual({
      aborted: true,
      sessionIds: [execution.id],
    });
    expect(aborted).toEqual([execution.id]);
    expect(issues.get(issue.id)?.status).not.toBe("completed");
    expect(issues.get(issue.id)?.status).not.toBe("cancelled");

    sessions.updateStatus(execution.id, "idle");
    const idle = await tool(tools, "AbortMessageIssue").execute(
      { issueId: issue.id },
      context,
    );
    expect(idle.success).toBe(true);
    expect(JSON.parse(idle.content)).toEqual({ aborted: false });
    expect(aborted).toEqual([execution.id]);
  });
});
