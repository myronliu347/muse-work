import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createIssueStore } from "../src/services/issueStore.js";
import { enqueueIssueSessionTurn } from "../src/services/assistant/observe.js";
import type { IssueUpdateInput } from "../src/services/issueProgress.js";

describe("issue turn progress", () => {
  it("writes a compact marker with changed files and the session message id", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-turn-progress-"));
    const issues = createIssueStore({ home });
    const issue = issues.create({ title: "改一下" });
    issues.setPlanning(issue.id, {
      planningSessionId: "plan-1",
      workdir: "/tmp/repo",
      worktreeEnabled: false,
    });

    const calls: Array<{ issueId: string; input: IssueUpdateInput }> = [];
    const events: unknown[] = [];
    await enqueueIssueSessionTurn({
      issues,
      runner: {
        getMessages: async () => [
          { id: "u1", role: "user", blocks: [{ type: "text", content: "改一下" }] },
          {
            id: "a1",
            role: "assistant",
            blocks: [
              { type: "file_history", snapshots: [{ filePath: "/tmp/repo/a.ts" }] },
              { type: "text", content: "改好了" },
            ],
          },
        ],
      },
      enqueue: (event) => events.push(event),
      assistantSessionId: "assistant",
      sessionId: "plan-1",
      recordIssueUpdate: (issueId, input) => {
        calls.push({ issueId, input });
        return { id: "u1", at: 1, kind: input.kind, summary: input.summary };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].issueId).toBe(issue.id);
    expect(calls[0].input).toMatchObject({
      kind: "turn",
      summary: "回合结束",
      sessionId: "plan-1",
      sessionMessageId: "a1",
      changedFiles: ["/tmp/repo/a.ts"],
    });
    expect(calls[0].input).not.toHaveProperty("detail");
    expect(events).toHaveLength(1);
  });

  it("does not enqueue the assistant for an execution turn", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-turn-progress-exec-"));
    const issues = createIssueStore({ home });
    const issue = issues.create({ title: "执行" });
    issues.setPlanning(issue.id, {
      planningSessionId: "plan-2",
      workdir: "/tmp/repo",
      worktreeEnabled: false,
    });
    issues.setExecutionSessionId(issue.id, "exec-2");

    const calls: IssueUpdateInput[] = [];
    const events: unknown[] = [];
    await enqueueIssueSessionTurn({
      issues,
      runner: {
        getMessages: async () => [
          { id: "a1", role: "assistant", blocks: [{ type: "text", content: "执行完" }] },
        ],
      },
      enqueue: (event) => events.push(event),
      assistantSessionId: "assistant",
      sessionId: "exec-2",
      recordIssueUpdate: (_issueId, input) => {
        calls.push(input);
        return { id: "u1", at: 1, kind: input.kind, summary: input.summary };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].summary).toBe("执行回合结束");
    expect(events).toHaveLength(0);
  });
});
