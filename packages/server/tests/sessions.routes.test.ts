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
});
