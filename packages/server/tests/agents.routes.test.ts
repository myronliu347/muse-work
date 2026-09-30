import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { closeTestApp, listenTestApp } from "./helpers.js";

describe("scenario models routes", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  it("GET /scenarios/models 返回默认模型", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const res = await fetch(`${app.baseUrl}/scenarios/models`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: Record<string, string> };
    expect(body.models.session).toBeTruthy();
    expect(body.models["issue-plan"]).toBeTruthy();
  });

  it("PUT /scenarios/models 写盘并读回", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const res = await fetch(`${app.baseUrl}/scenarios/models`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        models: { session: "m2" },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { session: string } };
    expect(body.models.session).toBe("m2");
  });

  it("旧 /agents API 返回 404", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const res = await fetch(`${app.baseUrl}/agents`);
    expect(res.status).toBe(404);
  });
});
