import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAutomationStore } from "../src/services/automationStore.js";
import { createAssistantMessageLog } from "../src/services/assistant/messages.js";
import { createAssistantTools } from "../src/services/assistant/tools.js";
import { createIssueStore } from "../src/services/issueStore.js";
import { createSessionStore } from "../src/services/sessionStore.js";
import type { AssistantTurnContext } from "../src/services/assistant/runtime.js";
import type { IssueUpdate } from "../src/services/issueProgress.js";
import type { WsHub } from "../src/services/wsHub.js";

function tool(tools: ReturnType<typeof createAssistantTools>, name: string) {
  const found = tools.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

function setup(turn?: AssistantTurnContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-progress-tools-"));
  const issues = createIssueStore({ home });
  const sessions = createSessionStore({ home });
  const automations = createAutomationStore({ home });
  const log = createAssistantMessageLog({ home });
  const calls: Array<{ issueId: string; input: Record<string, unknown> }> = [];
  const tools = createAssistantTools({
    home,
    issues,
    sessions,
    automations,
    log,
    hub: { broadcastAll: () => undefined } as WsHub,
    runner: {} as never,
    getTurnContext: () => turn,
    recordIssueUpdate: (issueId, input) => {
      calls.push({ issueId, input });
      return { id: "u1", at: 1, ...input } as IssueUpdate;
    },
  });
  return { home, issues, log, tools, calls };
}

describe("assistant issue progress", () => {
  it("attributes a chat line to an inherited issue without recording progress", async () => {
    const turn: AssistantTurnContext = {
      turnId: "turn-1",
      eventCount: 1,
      issueIds: [],
    };
    const { issues, log, tools, calls } = setup(turn);
    const issue = issues.create({ title: "A" });
    turn.issueIds = [issue.id];
    turn.singleIssueId = issue.id;

    const first = await tool(tools, "SendMessage").execute(
      { app: "muse", message: "先做完了" },
      {},
    );
    const second = await tool(tools, "SendMessage").execute(
      { app: "muse", message: "补充一句" },
      {},
    );

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    // 说话不再顺手记账：进度只由 RecordProgress 写。
    expect(calls).toHaveLength(0);
    const lines = log.page().messages.filter((line) => line.role === "assistant");
    expect(lines.map((line) => line.issueId)).toEqual([
      issue.id,
      issue.id,
    ]);
    expect(lines.map((line) => line.turnId)).toEqual(["turn-1", "turn-1"]);
  });

  it("records the message it refers to as the progress body", async () => {
    const turn: AssistantTurnContext = { turnId: "turn-3", eventCount: 1, issueIds: [] };
    const { issues, tools, calls } = setup(turn);
    const issue = issues.create({ title: "A" });
    turn.issueIds = [issue.id];
    turn.singleIssueId = issue.id;

    const told = await tool(tools, "SendMessage").execute(
      { app: "muse", message: "登录页改完，测试全绿" },
      {},
    );
    expect(told.success).toBe(true);
    const lineId = JSON.parse(told.content).line.id;

    const recorded = await tool(tools, "RecordProgress").execute(
      { issueId: issue.id, next: "等用户确认" },
      {},
    );

    expect(recorded.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].issueId).toBe(issue.id);
    // 账本正文就是用户看到的那句，模型不能另写一条摘要。
    expect(calls[0].input).toMatchObject({
      kind: "assistant",
      summary: "登录页改完，测试全绿",
      next: "等用户确认",
      turnId: "turn-3",
      messageId: lineId,
    });
    expect(calls[0].input).not.toHaveProperty("detail");
    expect(JSON.parse(recorded.content)).toMatchObject({
      issueId: issue.id,
      summary: "登录页改完，测试全绿",
      next: "等用户确认",
    });
  });

  it("keeps a long message in detail instead of dropping the conclusion", async () => {
    const turn: AssistantTurnContext = { turnId: "turn-5", eventCount: 1, issueIds: [] };
    const { home, issues, tools, calls } = setup(turn);
    const issue = issues.create({ title: "A" });
    turn.issueIds = [issue.id];
    turn.singleIssueId = issue.id;
    const attachment = path.join(home, "report.md");
    fs.writeFileSync(attachment, "报告");
    const long = `结论：主线上就两件。${"细".repeat(300)}`;

    const told = await tool(tools, "SendMessage").execute(
      { app: "muse", message: long, files: [attachment] },
      {},
    );
    expect(told.success).toBe(true);

    const recorded = await tool(tools, "RecordProgress").execute(
      { issueId: issue.id },
      {},
    );

    expect(recorded.success).toBe(true);
    const summary = calls[0].input.summary as string;
    expect([...summary]).toHaveLength(280);
    expect(calls[0].input.detail as string).toContain("细".repeat(50));
  });

  it("does not borrow a message attributed to another issue", async () => {
    const turn: AssistantTurnContext = { turnId: "turn-6", eventCount: 2, issueIds: [] };
    const { issues, tools, calls } = setup(turn);
    const mine = issues.create({ title: "A" });
    const other = issues.create({ title: "B" });

    const told = await tool(tools, "SendMessage").execute(
      { app: "muse", issueId: other.id, message: "B 的进展" },
      {},
    );
    expect(told.success).toBe(true);

    const recorded = await tool(tools, "RecordProgress").execute(
      { issueId: mine.id },
      {},
    );

    expect(recorded.success).toBe(false);
    expect(recorded.error).toContain("SendMessage");
    expect(calls).toHaveLength(0);
  });

  it("requires an explicit issue id instead of guessing one", async () => {
    const { issues, tools, calls } = setup({
      turnId: "turn-4",
      eventCount: 1,
      issueIds: ["issue-a"],
      singleIssueId: "issue-a",
    });
    issues.create({ title: "A" });

    const result = await tool(tools, "RecordProgress").execute({}, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("issueId");
    expect(calls).toHaveLength(0);
  });

  it("rejects unknown and closed issues", async () => {
    const { issues, tools, calls } = setup();
    const done = issues.create({ title: "B" });
    issues.complete(done.id, "做完了");

    const missing = await tool(tools, "RecordProgress").execute(
      { issueId: "missing" },
      {},
    );
    expect(missing.success).toBe(false);

    const closed = await tool(tools, "RecordProgress").execute(
      { issueId: done.id },
      {},
    );
    expect(closed.success).toBe(false);
    expect(closed.error).toContain("closed");

    expect(calls).toHaveLength(0);
  });

  it("does not clear a pending reply note by recording progress", async () => {
    const turn: AssistantTurnContext = { turnId: "turn-7", eventCount: 1, issueIds: [] };
    const { issues, tools } = setup(turn);
    const issue = issues.create({ title: "A" });
    turn.issueIds = [issue.id];
    turn.singleIssueId = issue.id;
    await tool(tools, "SendMessage").execute(
      { app: "muse", message: "还在做" },
      {},
    );
    // 撕纸条只跟「说给人听」绑定，记账不该动它。
    issues.markReplyPending(issue.id);
    const recorded = await tool(tools, "RecordProgress").execute(
      { issueId: issue.id },
      {},
    );

    expect(recorded.success).toBe(true);
    expect(issues.get(issue.id)?.replyPending).toBe(true);
  });

  it("still fails an explicit unknown issue on SendMessage", async () => {
    const { tools } = setup();
    const result = await tool(tools, "SendMessage").execute(
      { app: "muse", issueId: "missing", message: "不行" },
      {},
    );
    expect(result.success).toBe(false);
  });
});
