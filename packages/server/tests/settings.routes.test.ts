import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs";
import { createApp } from "../src/app.js";
import { closeTestApp, listenTestApp } from "./helpers.js";
import {
  DEFAULT_MUSE_USER_SETTINGS,
  getMuseUserSettingsPath,
} from "../src/services/museAgentSettings.js";

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

  it("GET /settings returns the version", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const res = await fetch(`${app.baseUrl}/settings`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 1 });
  });

  it("GET/PUT /settings/raw edits ~/.muse-work/settings.json and invalidates identities", async () => {
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
    expect(emptyBody.path).toBe(getMuseUserSettingsPath(app.home));
    expect(JSON.parse(emptyBody.content)).toEqual(DEFAULT_MUSE_USER_SETTINGS);

    const put = await fetch(`${app.baseUrl}/settings/raw`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: '{"env":{"MUSE_VISION_MODEL":"kimi-k3"}}',
      }),
    });
    expect(put.status).toBe(200);
    expect(invalidated).toBe(true);
    const putBody = (await put.json()) as { path: string; content: string };
    expect(JSON.parse(putBody.content)).toEqual({
      env: { MUSE_VISION_MODEL: "kimi-k3" },
    });
    expect(
      JSON.parse(fs.readFileSync(getMuseUserSettingsPath(app.home), "utf8")),
    ).toEqual({ env: { MUSE_VISION_MODEL: "kimi-k3" } });

    const bad = await fetch(`${app.baseUrl}/settings/raw`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "{" }),
    });
    expect(bad.status).toBe(400);
  });

});
