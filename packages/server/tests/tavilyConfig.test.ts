import fs from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import type { Server } from "node:http";
import { closeTestApp, listenTestApp } from "./helpers.js";
import { tavilyConfigPath } from "../src/services/tavilyConfig.js";
import { createAssistantTools } from "../src/services/assistant/tools.js";

describe("tavily key settings", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) await closeTestApp(server, home);
    server = undefined;
    home = undefined;
  });

  it("stores the key without echoing it, and search uses that key", async () => {
    const previous = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    try {

    const missing = await fetch(`${app.baseUrl}/settings/tavily`);
    expect(await missing.json()).toEqual({ configured: false, source: "none" });

    const saved = await fetch(`${app.baseUrl}/settings/tavily`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "tvly-secret" }),
    });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body).toEqual({ configured: true, source: "stored" });
    expect(JSON.stringify(body)).not.toContain("tvly-secret");

    const file = tavilyConfigPath(app.home);
    expect(fs.readFileSync(file, "utf8")).toContain("tvly-secret");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    let auth = "";
    const tools = createAssistantTools({
      home: app.home,
      issues: {} as never,
      sessions: {} as never,
      runner: {} as never,
      automations: {} as never,
      log: {} as never,
      hub: {} as never,
      tavily: {
        fetch: async (_input, init) => {
          auth = new Headers(init?.headers).get("authorization") ?? "";
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        },
      },
    });
    const search = tools.find((entry) => entry.name === "WebSearch");
    const result = await search!.execute(
      { query: "muse" },
      { workdir: app.home, taskManager: {} as never },
    );
    expect(result.success).toBe(true);
    expect(auth).toBe("Bearer tvly-secret");

    const cleared = await fetch(`${app.baseUrl}/settings/tavily`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "" }),
    });
    expect(await cleared.json()).toEqual({ configured: false, source: "none" });
    expect(fs.existsSync(file)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = previous;
    }
  });
});
