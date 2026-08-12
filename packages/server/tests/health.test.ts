import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { closeTestApp, listenTestApp } from "./helpers.js";

describe("GET /health", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  it("GET /health returns ok", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
