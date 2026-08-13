import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/app.js";
import { closeTestApp, listenTestApp } from "./helpers.js";
import { getSettingsPath } from "../src/museSettings.js";

describe("settings routes", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  it("GET /settings defaults superpowers on", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const res = await fetch(`${app.baseUrl}/settings`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: 1,
      plugins: { superpowers: true },
    });
  });

  it("PATCH /settings writes false and invalidates agent identities", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    let invalidated = false;
    const original = app.ctx.runner.invalidateAgentIdentities.bind(
      app.ctx.runner,
    );
    app.ctx.runner.invalidateAgentIdentities = () => {
      invalidated = true;
      original();
    };

    const res = await fetch(`${app.baseUrl}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plugins: { superpowers: false } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: 1,
      plugins: { superpowers: false },
    });
    expect(invalidated).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(getSettingsPath(app.home), "utf8")).plugins
        .superpowers,
    ).toBe(false);

    const again = await fetch(`${app.baseUrl}/settings`);
    expect(await again.json()).toEqual({
      version: 1,
      plugins: { superpowers: false },
    });
  });

  it("PATCH /settings rejects missing or non-boolean superpowers", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const missing = await fetch(`${app.baseUrl}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const bad = await fetch(`${app.baseUrl}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plugins: { superpowers: "no" } }),
    });
    expect(bad.status).toBe(400);
  });
});
