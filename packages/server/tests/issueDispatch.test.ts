import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIssueStore } from "../src/services/issueStore.js";
import { createSessionStore } from "../src/services/sessionStore.js";
import { createIssueDispatcher } from "../src/services/issueDispatch.js";

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
    const report = sends.find((s) => s.id === planning.id);
    expect(report?.source).toBe("system-inject");
    expect(report?.content).toContain("来源：执行会话");
    expect(report?.content).toContain("改登录");

    issues.patchItem(issue.id, "i1", { status: "pending" });
    await dispatcher.dispatch(issue.id, "i1", "再改一下");
    dispatcher.handleTurnSettled(first.executionSessionId, { ok: true });
    expect(issues.get(issue.id)?.status).toBe("review");
    fs.rmSync(home, { recursive: true, force: true });
  });
});
