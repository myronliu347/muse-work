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

    const created = await tool(tools, "CreateIssue").execute(
      { title: "登录", description: "修登录" },
      context,
    );
    expect(created.success).toBe(true);
    const issue = JSON.parse(created.content) as { id: string; priority: string; tags: string[] };
    expect(issue.priority).toBe("p1");
    expect(issue.tags).toEqual([]);

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
      { issueId: issue.id, action: "complete" },
      context,
    );
    expect(closed.success).toBe(true);
    expect(issues.get(issue.id)?.status).toBe("completed");
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
      "OpenIssue",
      "MessageIssue",
      "CloseIssue",
      "ResolvePermission",
      "SendMessage",
      "ReadSessionMessages",
      "ListMuseMessages",
    ]);
  });

  it("passes worktree and baseBranch through to the existing issue open", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-wt-"));
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-repo-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const automations = createAutomationStore({ home });
    const log = createAssistantMessageLog({ home });
    const opened: OpenIssueBody[] = [];
    const hub = { broadcastAll: () => {} } as WsHub;
    const tools = createAssistantTools({
      home,
      issues,
      sessions,
      automations,
      log,
      hub,
      runner: {} as never,
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
    expect(opened[0]).toEqual({
      workdir,
      agentMode: "single",
      worktreeEnabled: true,
    });
    expect(issues.get(issue.id)?.worktreeEnabled).toBe(true);
    expect(issues.get(issue.id)?.baseBranch).toBeUndefined();

    const other = issues.create({ title: "改分支" });
    const onDev = await tool(tools, "OpenIssue").execute(
      { issueId: other.id, workdir, worktree: true, baseBranch: "dev" },
      context,
    );
    expect(onDev.success).toBe(true);
    expect(opened[1]).toEqual({
      workdir,
      agentMode: "single",
      worktreeEnabled: true,
      baseBranch: "dev",
    });
  });

  it("shows a running issue session and interrupts only when asked", async () => {
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
        abortMessage: async (sessionId: string) => {
          order.push(`abort:${sessionId}`);
          return { ok: true as const };
        },
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
    expect(JSON.parse(queued.content)).toEqual({ accepted: true });

    const interrupted = await tool(tools, "MessageIssue").execute(
      { issueId: busy.id, message: "先停，改做这个", interrupt: true },
      context,
    );
    expect(JSON.parse(interrupted.content)).toEqual({ accepted: true, interrupted: true });
    expect(order).toEqual([
      `send:${running.id}:再看一下配置`,
      `abort:${running.id}`,
      `send:${running.id}:先停，改做这个`,
    ]);
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
});
