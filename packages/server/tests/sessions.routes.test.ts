import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { closeTestApp, listenTestApp } from "./helpers.js";

describe("sessions HTTP routes", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  it("POST create, PATCH pin, POST select, GET grouped", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", model: "m1" }),
    }).then((r) => r.json());
    expect(created.model).toBe("m1");

    await fetch(`${app.baseUrl}/sessions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: true, title: "t1" }),
    });

    await fetch(`${app.baseUrl}/sessions/${created.id}/select`, { method: "POST" });

    const grouped = await fetch(`${app.baseUrl}/sessions?grouped=1`).then((r) =>
      r.json(),
    );
    expect(grouped.activeSessionId).toBe(created.id);
    expect(grouped.pinned[0].title).toBe("t1");
    expect(grouped.recent).toEqual([]);
  });

  it("two sessions keep independent models after PATCH", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const a = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", model: "m1" }),
    }).then((r) => r.json());
    const b = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/b", model: "m2" }),
    }).then((r) => r.json());

    expect(a.model).toBe("m1");
    expect(b.model).toBe("m2");

    await fetch(`${app.baseUrl}/sessions/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m1-updated" }),
    });

    const aGet = await fetch(`${app.baseUrl}/sessions/${a.id}`).then((r) =>
      r.json(),
    );
    const bGet = await fetch(`${app.baseUrl}/sessions/${b.id}`).then((r) =>
      r.json(),
    );
    expect(aGet.model).toBe("m1-updated");
    expect(bGet.model).toBe("m2");
  });

  it("POST /sessions without model uses deepseek-v4-flash not the global active", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    await fetch(`${app.baseUrl}/providers/active`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "codemaker",
        modelId: "claude-opus-4-6",
      }),
    });

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a" }),
    }).then((r) => r.json());
    expect(created.model).toBe("deepseek-v4-flash");
  });

  it("POST /sessions honors permissionMode", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workdir: "/tmp/a",
        model: "m1",
        permissionMode: "bypassPermissions",
      }),
    }).then((r) => r.json());
    expect(created.permissionMode).toBe("bypassPermissions");

    const loaded = await fetch(`${app.baseUrl}/sessions/${created.id}`).then(
      (r) => r.json(),
    );
    expect(loaded.permissionMode).toBe("bypassPermissions");
  });

  it("POST /sessions/:id/abort returns ok", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/a", model: "m1" }),
    }).then((r) => r.json());

    const res = await fetch(`${app.baseUrl}/sessions/${created.id}/abort`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
