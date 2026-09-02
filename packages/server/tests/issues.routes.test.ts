import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAppContext } from "../src/services/appContext.js";
import { closeTestApp, listenTestApp } from "./helpers.js";

describe("issues HTTP", () => {
  let server: Server | undefined;
  let home: string | undefined;
  afterEach(async () => {
    if (server) await closeTestApp(server, home);
    server = undefined;
    home = undefined;
  });

  it("POST /issues then GET list; cancel hides from list", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const created = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "修登录", tags: ["Auth"] }),
    });
    expect(created.status).toBe(201);
    const { issue } = await created.json();
    expect(issue.tags).toEqual(["auth"]);
    const list = await fetch(`${app.baseUrl}/issues`).then((r) => r.json());
    expect(list.issues.map((i: { id: string }) => i.id)).toContain(issue.id);
    const cancel = await fetch(`${app.baseUrl}/issues/${issue.id}/cancel`, {
      method: "POST",
    });
    expect(cancel.status).toBe(200);
    const list2 = await fetch(`${app.baseUrl}/issues`).then((r) => r.json());
    expect(list2.issues.map((i: { id: string }) => i.id)).not.toContain(issue.id);
  });

  it("POST planning-session creates one planning session and is idempotent", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "设计评审" }),
    }).then((r) => r.json());
    const res = await fetch(`${app.baseUrl}/issues/${issue.id}/planning-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/proj", worktreeEnabled: false }),
    });
    expect(res.status).toBe(200);
    const first = await res.json();
    const session = app.ctx.store.get(first.sessionId);
    expect(session?.agentName).toBe("plan");
    expect(session?.systemPrompt).toContain(`Issue ID：${issue.id}`);
    expect(session?.systemPrompt).toContain("禁止 Edit/Write 修改源码");
    expect(app.ctx.issueStore.get(issue.id)?.status).toBe("planning");
    const second = await fetch(`${app.baseUrl}/issues/${issue.id}/planning-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/other", worktreeEnabled: false }),
    }).then((r) => r.json());
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("PUT items then POST dispatch returns executionSessionId", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-server-"));
    const ctx = createAppContext({
      home: tmp,
      createAgent: async () => ({
        sendMessage: async () => {},
        dispose: async () => {},
      }),
    });
    const app = await listenTestApp({ home: tmp, ctx });
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "修登录" }),
    }).then((r) => r.json());
    await fetch(`${app.baseUrl}/issues/${issue.id}/planning-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/proj", worktreeEnabled: false }),
    });
    const put = await fetch(`${app.baseUrl}/issues/${issue.id}/items`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ content: "改登录" }] }),
    });
    expect(put.status).toBe(200);
    const { issue: withItems } = await put.json();
    const itemId = withItems.items[0].id as string;
    const dispatch = await fetch(`${app.baseUrl}/issues/${issue.id}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    expect(dispatch.status).toBe(200);
    const body = await dispatch.json();
    expect(body.executionSessionId).toBeTruthy();
  });
});
