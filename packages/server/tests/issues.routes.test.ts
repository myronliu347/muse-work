import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
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
});
