import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MusePlugin } from "@muse-work/plugin-sdk";
import { getMuseHomeDir } from "@muse-work/provider";
import { createAppContext, openHostedAppContext } from "../src/services/appContext.js";
import {
  loadHostPlugins,
  prepareHostPlugins,
  resolveHostPluginSpecs,
  startPreparedPlugins,
} from "../src/plugins/hostPlugins.js";
import { closeTestApp, listenTestApp } from "./helpers.js";
import { shouldRevokeUnauthorized } from "../src/services/sessionRunner/agent.js";

const homes: string[] = [];
const savedEnv = process.env.MUSE_HOST_PLUGINS;

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-host-"));
  homes.push(home);
  return home;
}

function memoryLogger() {
  const warnings: string[] = [];
  return {
    warnings,
    logger: {
      info() {},
      warn(message: string) {
        warnings.push(message);
      },
      error(message: string) {
        warnings.push(message);
      },
    },
  };
}

function writePlugin(home: string, name: string, source: string): string {
  const file = path.join(home, `${name}.mjs`);
  fs.writeFileSync(file, source);
  return file;
}

const samplePlugin = `
export const plugin = {
  id: "sample",
  register(ctx) {
    ctx.registerProvider({
      id: "sample",
      displayName: "Sample",
      async getAuthStatus() {
        return { state: "unauthenticated", providerId: "sample" };
      },
      async beginLogin() { throw new Error("no"); },
      async completeLogin() { throw new Error("no"); },
      async logout() {},
      async listModels() { return []; },
      async resolveGateway(modelId) {
        return { baseURL: "https://example.test", model: modelId };
      },
    });
  },
  async start(ctx) {
    const fs = await import("node:fs");
    fs.writeFileSync(process.env.MUSE_TEST_PORT_FILE, String(ctx.requestedMainPort));
  },
};
`;

afterEach(() => {
  if (savedEnv === undefined) delete process.env.MUSE_HOST_PLUGINS;
  else process.env.MUSE_HOST_PLUGINS = savedEnv;
  delete process.env.MUSE_TEST_PORT_FILE;
  for (const home of homes.splice(0)) {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

describe("host plugins", () => {
  it("boots and answers health when plugins are disabled", async () => {
    process.env.MUSE_HOST_PLUGINS = "0";
    const home = tempHome();
    const ctx = await openHostedAppContext({ home });
    const app = await listenTestApp({ home, ctx });
    try {
      const res = await fetch(`${app.baseUrl}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(ctx.registry.get("sample")).toBeUndefined();
    } finally {
      await closeTestApp(app.server);
    }
  });

  it("loads nothing for an empty plugin list", () => {
    const home = tempHome();
    process.env.MUSE_HOST_PLUGINS = "";
    expect(resolveHostPluginSpecs(home)).toBe("none");
    process.env.MUSE_HOST_PLUGINS = "0";
    expect(resolveHostPluginSpecs(home)).toBe("none");
  });

  it("loads only the env path list and ignores host-plugins.json", async () => {
    const home = tempHome();
    const listed = writePlugin(home, "listed", samplePlugin);
    const ignored = writePlugin(
      home,
      "ignored",
      `export const plugin = { id: "ignored", register() { throw new Error("should not load"); } };`,
    );
    fs.mkdirSync(getMuseHomeDir(home), { recursive: true });
    fs.writeFileSync(
      path.join(getMuseHomeDir(home), "host-plugins.json"),
      JSON.stringify({ modules: [ignored] }),
    );
    process.env.MUSE_HOST_PLUGINS = listed;
    const { logger } = memoryLogger();
    const plugins = await loadHostPlugins(home, logger);
    expect(plugins.map((plugin) => plugin.id)).toEqual(["sample"]);
  });

  it("loads modules from host-plugins.json when env is unset", async () => {
    const home = tempHome();
    delete process.env.MUSE_HOST_PLUGINS;
    const listed = writePlugin(home, "from-json", samplePlugin);
    fs.mkdirSync(getMuseHomeDir(home), { recursive: true });
    fs.writeFileSync(
      path.join(getMuseHomeDir(home), "host-plugins.json"),
      JSON.stringify({ modules: [listed] }),
    );
    const { logger } = memoryLogger();
    const plugins = await loadHostPlugins(home, logger);
    expect(plugins.map((plugin) => plugin.id)).toEqual(["sample"]);
  });

  it("loads nothing when no plugin bundle is installed", async () => {
    const home = tempHome();
    delete process.env.MUSE_HOST_PLUGINS;
    const { logger, warnings } = memoryLogger();
    const plugins = await loadHostPlugins(home, logger);
    expect(plugins).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("loads a bundle dropped in the host-plugins directory", async () => {
    const home = tempHome();
    delete process.env.MUSE_HOST_PLUGINS;
    const dir = path.join(getMuseHomeDir(home), "host-plugins");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "sample.mjs"), samplePlugin);
    const { logger, warnings } = memoryLogger();
    const plugins = await loadHostPlugins(home, logger);
    expect(plugins.map((plugin) => plugin.id)).toEqual(["sample"]);
    expect(warnings).toEqual([]);
  });

  it("shows a plugin provider, starts with the requested port, and skips a broken plugin", async () => {
    const home = tempHome();
    const portFile = path.join(home, "port.txt");
    process.env.MUSE_TEST_PORT_FILE = portFile;
    const broken: MusePlugin = {
      id: "broken",
      register() {
        throw new Error("boom");
      },
    };
    const samplePath = writePlugin(home, "sample", samplePlugin);
    delete process.env.MUSE_HOST_PLUGINS;
    process.env.MUSE_HOST_PLUGINS = samplePath;
    const { logger, warnings } = memoryLogger();
    const loaded = await loadHostPlugins(home, logger);
    const prepared = await prepareHostPlugins({
      home,
      plugins: [broken, ...loaded],
      logger,
    });
    expect(warnings).toContain("host plugin register failed");
    expect(prepared.contributions.providers.map((provider) => provider.id)).toEqual([
      "sample",
    ]);
    const ctx = createAppContext({
      home,
      extraProviders: prepared.contributions.providers,
      preparedPlugins: prepared.prepared,
    });
    await ctx.startHostPlugins(4177);
    expect(fs.readFileSync(portFile, "utf8")).toBe("4177");
    const app = await listenTestApp({ home, ctx });
    try {
      const res = await fetch(`${app.baseUrl}/providers`);
      const body = (await res.json()) as { providers: Array<{ id: string }> };
      expect(body.providers.map((provider) => provider.id)).toContain("sample");
      expect((await fetch(`${app.baseUrl}/health`)).status).toBe(200);
    } finally {
      await closeTestApp(app.server);
    }
  });

  it("skips a plugin whose start throws and still listens", async () => {
    const home = tempHome();
    const failing: MusePlugin = {
      id: "failing",
      register() {},
      start() {
        throw new Error("bind failed");
      },
    };
    const { logger, warnings } = memoryLogger();
    const prepared = await prepareHostPlugins({
      home,
      plugins: [failing],
      logger,
    });
    await startPreparedPlugins(prepared.prepared, 0, logger);
    expect(warnings).toContain("host plugin start failed");
    const ctx = createAppContext({ home });
    const app = await listenTestApp({ home, ctx });
    try {
      expect((await fetch(`${app.baseUrl}/health`)).status).toBe(200);
    } finally {
      await closeTestApp(app.server);
    }
  });
});

describe("unauthorized credentials", () => {
  it("drops credentials only when the provider asks for it", () => {
    expect(shouldRevokeUnauthorized({ revokeOnUnauthorized: true })).toBe(true);
    expect(shouldRevokeUnauthorized({ revokeOnUnauthorized: false })).toBe(false);
    expect(shouldRevokeUnauthorized({})).toBe(false);
    expect(shouldRevokeUnauthorized(undefined)).toBe(false);
  });
});
