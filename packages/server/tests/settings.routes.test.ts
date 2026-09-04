import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/app.js";
import { closeTestApp, listenTestApp } from "./helpers.js";
import { getSettingsPath } from "../src/services/museSettings.js";
import {
  DEFAULT_WAVE_USER_SETTINGS,
  getWaveUserSettingsPath,
} from "../src/services/waveAgentSettings.js";

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

  it("GET /settings defaults mattpocock on and superpowers off", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const res = await fetch(`${app.baseUrl}/settings`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: 1,
      plugins: { superpowers: false, mattpocock: true },
    });
  });

  it("GET/PUT /settings/raw edits ~/.wave/settings.json and invalidates identities", async () => {
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

    const empty = await fetch(`${app.baseUrl}/settings/raw`);
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as { path: string; content: string };
    expect(emptyBody.path).toBe(getWaveUserSettingsPath(app.home));
    expect(JSON.parse(emptyBody.content)).toEqual(DEFAULT_WAVE_USER_SETTINGS);

    const put = await fetch(`${app.baseUrl}/settings/raw`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: '{"env":{"WAVE_VISION_MODEL":"kimi-k3"}}',
      }),
    });
    expect(put.status).toBe(200);
    expect(invalidated).toBe(true);
    const putBody = (await put.json()) as { path: string; content: string };
    expect(JSON.parse(putBody.content)).toEqual({
      env: { WAVE_VISION_MODEL: "kimi-k3" },
    });
    expect(
      JSON.parse(fs.readFileSync(getWaveUserSettingsPath(app.home), "utf8")),
    ).toEqual({ env: { WAVE_VISION_MODEL: "kimi-k3" } });

    const bad = await fetch(`${app.baseUrl}/settings/raw`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "{" }),
    });
    expect(bad.status).toBe(400);
  });

  it("PATCH /settings writes fields and invalidates agent identities", async () => {
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
      body: JSON.stringify({ plugins: { superpowers: true } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: 1,
      plugins: { superpowers: true, mattpocock: true },
    });
    expect(invalidated).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(getSettingsPath(app.home), "utf8")).plugins,
    ).toEqual({ superpowers: true, mattpocock: true });

    const again = await fetch(`${app.baseUrl}/settings`);
    expect(await again.json()).toEqual({
      version: 1,
      plugins: { superpowers: true, mattpocock: true },
    });

    const off = await fetch(`${app.baseUrl}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plugins: { mattpocock: false } }),
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({
      version: 1,
      plugins: { superpowers: true, mattpocock: false },
    });
  });

  it("PATCH /settings rejects missing or non-boolean fields", async () => {
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
