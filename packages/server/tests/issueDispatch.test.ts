import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIssueStore } from "../src/services/issueStore.js";
import { createSessionStore } from "../src/services/sessionStore.js";
import {
  createIssueDispatcher,
  formatExecTurnProcess,
  formatExecTurnReport,
} from "../src/services/issueDispatch.js";

describe("formatExecTurnReport", () => {
  it("tells planning to review then dispatch the next pending item when done", () => {
    const report = formatExecTurnReport({
      itemId: "i1",
      itemContent: "改登录",
      ok: true,
      remaining: [{ id: "i2", content: "补测试", status: "pending" }],
      issueStatus: "executing",
    });
    expect(report).toContain("来源：执行会话");
    expect(report).toContain("已完成");
    expect(report).toContain("itemId：i1");
    expect(report).toContain("根据执行过程");
    expect(report).toContain("dispatch");
    expect(report).toContain("i2");
  });

  it("forbids skipping to the next item when the turn was interrupted", () => {
    const report = formatExecTurnReport({
      itemId: "i1",
      itemContent: "调研架构",
      ok: false,
      error: "interrupted",
      remaining: [
        { id: "i1", content: "调研架构", status: "pending" },
        { id: "i2", content: "改登录", status: "pending" },
      ],
      issueStatus: "executing",
    });
    expect(report).toContain("中断");
    expect(report).toContain("itemId：i1");
    expect(report).toContain("不要 dispatch 下一项");
    expect(report).toContain("同一");
  });

  it("tells planning to judge the next dispatch from the execution process", () => {
    const report = formatExecTurnReport({
      itemId: "i1",
      itemContent: "改登录",
      ok: true,
      process: "- Edit src/login.ts（完成）\n校验已加上。",
      remaining: [{ id: "i2", content: "补测试", status: "pending" }],
      issueStatus: "executing",
    });
    expect(report).toContain("执行过程");
    expect(report).toContain("Edit src/login.ts");
    expect(report).toContain("根据执行过程");
  });
});

describe("formatExecTurnProcess", () => {
  it("summarizes last-turn tools, nested agent text, and file edits", () => {
    const process = formatExecTurnProcess([
      {
        role: "user",
        blocks: [{ type: "text", content: "请执行清单项「调研」" }],
      },
      {
        role: "assistant",
        blocks: [
          {
            type: "tool",
            name: "Agent",
            compactParams: "Explore: 结构",
            success: true,
            nestedMessages: [
              {
                role: "assistant",
                blocks: [{ type: "text", content: "路由层在 packages/server" }],
              },
            ],
          },
          {
            type: "tool",
            name: "Edit",
            compactParams: "src/login.ts",
            success: false,
          },
          {
            type: "file_history",
            snapshots: [{ path: "src/login.ts" }],
          },
          { type: "text", content: "改到一半被打断。" },
        ],
      },
    ]);
    expect(process).not.toContain("请执行清单项");
    expect(process).toContain("Agent Explore: 结构");
    expect(process).toContain("路由层在 packages/server");
    expect(process).toContain("Edit src/login.ts（失败）");
    expect(process).toContain("src/login.ts");
    expect(process).toContain("改到一半被打断。");
  });
});

describe("issueDispatch", () => {
  it("creates exec session; all done enters review; second dispatch keeps review", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-dispatch-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const sends: Array<{ id: string; content: string; source?: string }> = [];
    const runner = {
      sendMessage: async (
        id: string,
        content: string,
        _images?: unknown,
        source?: "user" | "system-inject",
      ) => {
        sends.push({ id, content, source });
        return { accepted: true as const };
      },
    };
    const hub = { broadcastAll: () => {} };
    const dispatcher = createIssueDispatcher({
      issues,
      sessions,
      runner: runner as never,
      hub: hub as never,
    });
    const issue = issues.create({ title: "修登录" });
    const planning = sessions.create({
      workdir: "/tmp/proj",
      model: "m",
      title: "修登录",
      agentName: "plan",
    });
    issues.setPlanning(issue.id, {
      planningSessionId: planning.id,
      workdir: "/tmp/proj",
      worktreeEnabled: false,
    });
    issues.setItems(issue.id, [{ id: "i1", content: "改登录", status: "pending" }]);

    const first = await dispatcher.dispatch(issue.id, "i1");
    expect(issues.get(issue.id)?.status).toBe("executing");
    expect(sends[0]?.id).toBe(first.executionSessionId);
    expect(sends[0]?.source).toBe("system-inject");
    expect(sends[0]?.content).toContain("改登录");

    dispatcher.handleTurnSettled(first.executionSessionId, { ok: true });
    expect(issues.get(issue.id)?.status).toBe("review");
    await vi.waitFor(() => {
      const report = sends.find((s) => s.id === planning.id);
      expect(report?.source).toBe("system-inject");
      expect(report?.content).toContain("来源：执行会话");
      expect(report?.content).toContain("改登录");
    });

    issues.patchItem(issue.id, "i1", { status: "pending" });
    await dispatcher.dispatch(issue.id, "i1", "再改一下");
    dispatcher.handleTurnSettled(first.executionSessionId, { ok: true });
    expect(issues.get(issue.id)?.status).toBe("review");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("injects last assistant text from the execution session into the planning report", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-dispatch-summary-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const sends: Array<{ id: string; content: string; source?: string }> = [];
    let execId = "";
    const runner = {
      sendMessage: async (
        id: string,
        content: string,
        _images?: unknown,
        source?: "user" | "system-inject",
      ) => {
        sends.push({ id, content, source });
        return { accepted: true as const };
      },
      getMessages: async (id: string) => {
        if (id !== execId) return [];
        return [
          {
            role: "user",
            blocks: [{ type: "text", content: "请执行清单项" }],
          },
          {
            role: "assistant",
            blocks: [
              {
                type: "tool",
                name: "Agent",
                nestedMessages: [
                  {
                    role: "assistant",
                    blocks: [
                      {
                        type: "text",
                        content: "核心是 Express 路由 + sessionRunner 串行回合。",
                      },
                    ],
                  },
                ],
              },
              {
                type: "text",
                content: "调研已完成。",
              },
            ],
          },
        ];
      },
    };
    const hub = { broadcastAll: () => {} };
    const dispatcher = createIssueDispatcher({
      issues,
      sessions,
      runner: runner as never,
      hub: hub as never,
    });
    const issue = issues.create({ title: "调研" });
    const planning = sessions.create({
      workdir: "/tmp/proj",
      model: "m",
      title: "调研",
      agentName: "plan",
    });
    issues.setPlanning(issue.id, {
      planningSessionId: planning.id,
      workdir: "/tmp/proj",
      worktreeEnabled: false,
    });
    issues.setItems(issue.id, [
      { id: "i1", content: "调研架构", status: "pending" },
    ]);

    const first = await dispatcher.dispatch(issue.id, "i1");
    execId = first.executionSessionId;
    dispatcher.handleTurnSettled(execId, { ok: true });
    await vi.waitFor(() => {
      const report = sends.find((s) => s.id === planning.id);
      expect(report?.content).toContain("来源：执行会话");
      expect(report?.content).toContain("调研架构");
      expect(report?.content).toContain(
        "核心是 Express 路由 + sessionRunner 串行回合。",
      );
      expect(report?.content).toContain("执行过程");
      expect(report?.content).toContain("Agent");
    });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("dispatch while inflight rejects with 409 and does not change mapped item", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-dispatch-inflight-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const runner = {
      sendMessage: async () => ({ accepted: true as const }),
    };
    const hub = { broadcastAll: () => {} };
    const dispatcher = createIssueDispatcher({
      issues,
      sessions,
      runner: runner as never,
      hub: hub as never,
    });
    const issue = issues.create({ title: "并发" });
    const planning = sessions.create({
      workdir: "/tmp/proj",
      model: "m",
      title: "并发",
      agentName: "plan",
    });
    issues.setPlanning(issue.id, {
      planningSessionId: planning.id,
      workdir: "/tmp/proj",
      worktreeEnabled: false,
    });
    issues.setItems(issue.id, [
      { id: "i1", content: "第一项", status: "pending" },
      { id: "i2", content: "第二项", status: "pending" },
    ]);

    const first = await dispatcher.dispatch(issue.id, "i1");
    expect(issues.get(issue.id)?.items.find((i) => i.id === "i1")?.status).toBe(
      "running",
    );

    let err: unknown;
    try {
      await dispatcher.dispatch(issue.id, "i2");
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ statusCode: 409 });
    expect(issues.get(issue.id)?.items.find((i) => i.id === "i2")?.status).toBe(
      "pending",
    );

    dispatcher.handleTurnSettled(first.executionSessionId, { ok: true });
    expect(issues.get(issue.id)?.items.find((i) => i.id === "i1")?.status).toBe(
      "done",
    );
    expect(issues.get(issue.id)?.items.find((i) => i.id === "i2")?.status).toBe(
      "pending",
    );
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("rolls item back to pending when sendMessage throws after inflight", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-dispatch-throw-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    let fail = true;
    const runner = {
      sendMessage: async () => {
        if (fail) throw new Error("send failed");
        return { accepted: true as const };
      },
    };
    const hub = { broadcastAll: () => {} };
    const dispatcher = createIssueDispatcher({
      issues,
      sessions,
      runner: runner as never,
      hub: hub as never,
    });
    const issue = issues.create({ title: "回滚" });
    const planning = sessions.create({
      workdir: "/tmp/proj",
      model: "m",
      title: "回滚",
      agentName: "plan",
    });
    issues.setPlanning(issue.id, {
      planningSessionId: planning.id,
      workdir: "/tmp/proj",
      worktreeEnabled: false,
    });
    issues.setItems(issue.id, [
      { id: "i1", content: "第一项", status: "pending" },
    ]);

    await expect(dispatcher.dispatch(issue.id, "i1")).rejects.toThrow(
      "send failed",
    );
    expect(issues.get(issue.id)?.items.find((i) => i.id === "i1")?.status).toBe(
      "pending",
    );

    fail = false;
    const second = await dispatcher.dispatch(issue.id, "i1");
    expect(second.executionSessionId).toBeTruthy();
    expect(issues.get(issue.id)?.items.find((i) => i.id === "i1")?.status).toBe(
      "running",
    );
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("interrupted exec turn rolls item pending and asks planning to continue the same item", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-dispatch-abort-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const sends: Array<{ id: string; content: string }> = [];
    const dispatcher = createIssueDispatcher({
      issues,
      sessions,
      runner: {
        sendMessage: async (id: string, content: string) => {
          sends.push({ id, content });
          return { accepted: true as const };
        },
        getMessages: async () => [],
      } as never,
      hub: { broadcastAll: () => {} } as never,
    });
    const issue = issues.create({ title: "双项" });
    const planning = sessions.create({
      workdir: "/tmp/proj",
      model: "m",
      title: "双项",
      agentName: "plan",
    });
    issues.setPlanning(issue.id, {
      planningSessionId: planning.id,
      workdir: "/tmp/proj",
      worktreeEnabled: false,
    });
    issues.setItems(issue.id, [
      { id: "i1", content: "调研", status: "pending" },
      { id: "i2", content: "改代码", status: "pending" },
    ]);
    const first = await dispatcher.dispatch(issue.id, "i1");
    dispatcher.handleTurnSettled(first.executionSessionId, {
      ok: false,
      error: "interrupted",
    });
    expect(issues.get(issue.id)?.items.find((i) => i.id === "i1")?.status).toBe(
      "pending",
    );
    expect(issues.get(issue.id)?.items.find((i) => i.id === "i2")?.status).toBe(
      "pending",
    );
    expect(issues.get(issue.id)?.status).toBe("executing");
    await vi.waitFor(() => {
      const report = sends.find((s) => s.id === planning.id);
      expect(report?.content).toContain("中断");
      expect(report?.content).toContain("itemId：i1");
      expect(report?.content).toContain("不要 dispatch 下一项");
    });
    fs.rmSync(home, { recursive: true, force: true });
  });
});
