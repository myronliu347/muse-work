import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHonoApp } from "../src/app.js";
import { createAssistantMessageLog } from "../src/services/assistant/messages.js";
import { enqueueIssueSessionTurn } from "../src/services/assistant/observe.js";
import type { AssistantEvent } from "../src/services/assistant/events.js";
import { createIssueStore } from "../src/services/issueStore.js";
import type { AppContext } from "../src/services/appContext.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

describe("assistant wiring", () => {
  it("appends a muse line, broadcasts, and enqueues a chat event", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-assistant-wire-"));
    homes.push(home);
    const log = createAssistantMessageLog({ home });
    const events: AssistantEvent[] = [];
    const broadcasts: unknown[] = [];
    const ctx = {
      assistantLog: log,
      hub: { broadcastAll: (event: unknown) => broadcasts.push(event) },
      assistantRuntime: { enqueue: (event: AssistantEvent) => events.push(event) },
    } as unknown as AppContext;
    const app = createHonoApp(ctx);

    const empty = await app.request("/assistant/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "  " }),
    });
    expect(empty.status).toBe(400);

    const posted = await app.request("/assistant/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "你好" }),
    });
    expect(posted.status).toBe(200);
    const line = await posted.json();
    expect(line.role).toBe("user");
    expect(line.message).toBe("你好");
    expect(broadcasts).toEqual([{ type: "assistant:chat", line }]);
    expect(events).toEqual([{ type: "chat", from: "muse", message: "你好" }]);

    const listed = await app.request("/assistant/messages");
    expect(listed.status).toBe(200);
    const page = await listed.json();
    expect(page.messages).toEqual([line]);
    expect(page.hasMore).toBe(false);
  });

  it("enqueues an issue event when that issue's session settles", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-assistant-issue-"));
    homes.push(home);
    const issues = createIssueStore({ home });
    const issue = issues.create({ title: "修登录" });
    issues.setPlanning(issue.id, {
      planningSessionId: "sess-1",
      workdir: "/tmp/repo",
      worktreeEnabled: false,
    });
    const events: AssistantEvent[] = [];
    await enqueueIssueSessionTurn({
      issues,
      runner: {
        getMessages: async () => [
          {
            role: "assistant",
            blocks: [{ type: "text", content: "已经修好" }],
          },
        ],
      },
      enqueue: (event) => events.push(event),
      assistantSessionId: "assistant",
      sessionId: "sess-1",
    });
    await enqueueIssueSessionTurn({
      issues,
      runner: { getMessages: async () => [] },
      enqueue: (event) => events.push(event),
      assistantSessionId: "assistant",
      sessionId: "assistant",
    });
    expect(events).toEqual([
      {
        type: "issue",
        issueId: issue.id,
        title: "修登录",
        workdir: "/tmp/repo",
        summary: "已经修好",
      },
    ]);
  });
});
