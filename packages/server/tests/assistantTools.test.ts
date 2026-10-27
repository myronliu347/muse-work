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
    const sent: Array<{ receiver: string; content: string }> = [];
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
            role: "assistant",
            blocks: [{ type: "text", content: `完整结论${"你".repeat(9000)}` }],
          },
        ],
      } as never,
      sendText: async (receiver, content) => {
        sent.push({ receiver, content });
      },
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

    const popo = await tool(tools, "SendMessage").execute(
      { app: "popo", message: "群" },
      context,
    );
    expect(popo.success).toBe(false);
    expect(sent).toHaveLength(0);
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
      planning: Array<{ role: string; text: string }>;
    };
    expect(read.planning[0]?.role).toBe("assistant");
    expect(read.planning[0]?.text.startsWith("完整结论")).toBe(true);
    expect([...read.planning[0]!.text].length).toBeGreaterThan(8000);

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
      "CloseIssue",
      "ResolvePermission",
      "SendMessage",
      "RecallMessage",
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
      },
      required: ["issueId", "message"],
    });
    expect(messageIssue?.config.function.description).not.toContain("interrupt");
  });

  it("records the master's POPO private chat and skips groups", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-popo-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const automations = createAutomationStore({ home });
    const log = createAssistantMessageLog({ home });
    const sent: string[] = [];
    const broadcasts: unknown[] = [];
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations,
      log,
      hub: { broadcastAll: (event: unknown) => broadcasts.push(event) } as WsHub,
      runner: {} as never,
      sendText: async (receiver, content) => {
        sent.push(`${receiver}:${content}`);
      },
      popoMasterUid: () => "master",
    });
    const context = { sessionId: "assistant", toolUseId: "tool-1" };
    const direct = await tool(tools, "SendMessage").execute(
      { app: "popo", user: "master", message: "私聊回复" },
      context,
    );
    expect(direct.success).toBe(true);
    const group = await tool(tools, "SendMessage").execute(
      { app: "popo", user: "master", groupId: "g1", message: "群回复" },
      context,
    );
    expect(group.success).toBe(true);
    const other = await tool(tools, "SendMessage").execute(
      { app: "popo", user: "someone", message: "别人" },
      context,
    );
    expect(other.success).toBe(true);
    expect(sent).toEqual(["master:私聊回复", "g1:群回复", "someone:别人"]);
    expect(log.page().messages).toEqual([
      expect.objectContaining({ role: "assistant", message: "私聊回复", app: "popo" }),
    ]);
    expect(broadcasts).toHaveLength(1);
  });

  it("sends local files and links, and recalls the POPO message", async () => {
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
    const files: string[] = [];
    const recalls: Array<{ msgId: string; sessionId: string; sessionType: number }> = [];
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations,
      log,
      hub: { broadcastAll: () => undefined } as WsHub,
      runner: {} as never,
      sendText: async () => ["text-1"],
      sendLocalFile: async (_receiver, filePath) => {
        files.push(filePath);
        return "file-1";
      },
      recallPopo: async (args) => {
        recalls.push(args);
      },
      popoMasterUid: () => "master",
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

    const popo = await tool(tools, "SendMessage").execute(
      {
        app: "popo",
        user: "master",
        message: "",
        files: [png],
      },
      context,
    );
    expect(popo.success).toBe(true);
    expect(files).toEqual([png]);
    expect(JSON.parse(popo.content)).toMatchObject({ msgIds: ["file-1"] });
    expect(log.page().messages[1]?.msgIds).toEqual(["file-1"]);

    const recalled = await tool(tools, "RecallMessage").execute(
      { msgId: "file-1", user: "master" },
      context,
    );
    const group = await tool(tools, "RecallMessage").execute(
      { msgId: "file-1", groupId: "g1" },
      context,
    );
    expect(recalled.success).toBe(true);
    expect(group.success).toBe(true);
    expect(recalls).toEqual([
      { msgId: "file-1", sessionId: "master", sessionType: 1 },
      { msgId: "file-1", sessionId: "g1", sessionType: 3 },
    ]);

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
    const sent: Array<{ content: string; atUids?: string[] }> = [];
    const tools = createAssistantTools({
      home,
      issues,
      sessions: createSessionStore({ home }),
      automations: createAutomationStore({ home }),
      log,
      hub: { broadcastAll: () => undefined } as WsHub,
      runner: {} as never,
      sendText: async (_receiver, content, at) => {
        sent.push({ content, ...(at?.atUids ? { atUids: at.atUids } : {}) });
        return ["m1"];
      },
      popoMasterUid: () => "master",
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
    const privateAt = await tool(tools, "SendMessage").execute(
      { app: "popo", user: "master", ats: [{ type: "user", id: "a@corp.netease.com" }], message: "私聊" },
      context,
    );
    expect(privateAt.success).toBe(false);
    const groupIssue = await tool(tools, "SendMessage").execute(
      { app: "popo", groupId: "g1", ats: [{ type: "issue", id: design.id }], message: "群里" },
      context,
    );
    expect(groupIssue.success).toBe(false);

    const group = await tool(tools, "SendMessage").execute(
      {
        app: "popo",
        groupId: "g1",
        ats: [{ type: "user", id: "a@corp.netease.com" }],
        message: "看一下",
      },
      context,
    );
    expect(group.success).toBe(true);
    expect(sent).toEqual([{ content: "看一下", atUids: ["a@corp.netease.com"] }]);

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
});
