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
      return {
        id: "u1",
        at: 1,
        kind: input.kind,
        summary: input.summary,
      };
    },
  });
  return { issues, log, tools, calls };
}

describe("assistant issue progress", () => {
  it("inherits a single-issue turn for every SendMessage", async () => {
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
      { app: "muse", message: "先做完了", next: "再看一下" },
      {},
    );
    const second = await tool(tools, "SendMessage").execute(
      { app: "muse", message: "补充一句" },
      {},
    );

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.issueId === turn.issueIds[0])).toBe(true);
    expect(calls[0].input.next).toBe("再看一下");
    const lines = log.page().messages.filter((line) => line.role === "assistant");
    expect(lines.map((line) => line.issueId)).toEqual([
      turn.issueIds[0],
      turn.issueIds[0],
    ]);
    expect(lines.map((line) => line.turnId)).toEqual(["turn-1", "turn-1"]);
  });

  it("does not guess when the turn contains multiple events", async () => {
    const { issues, tools, calls } = setup({
      turnId: "turn-2",
      eventCount: 2,
      issueIds: ["issue-a", "issue-b"],
    });
    issues.create({ title: "A" });
    const result = await tool(tools, "SendMessage").execute(
      { app: "muse", message: "两件事都有结果" },
      {},
    );
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("fails an explicit unknown issue instead of falling back", async () => {
    const { tools, calls } = setup();
    const result = await tool(tools, "SendMessage").execute(
      { app: "muse", issueId: "missing", message: "不行" },
      {},
    );
    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("does not write progress for ats-only chat", async () => {
    const { issues, tools, calls } = setup();
    const issue = issues.create({ title: "A" });
    const result = await tool(tools, "SendMessage").execute(
      {
        app: "muse",
        ats: [{ type: "issue", id: issue.id }],
        message: "只是引用",
      },
      {},
    );
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
