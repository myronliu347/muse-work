import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getMuseHomeDir, loadProvidersConfig, saveProvidersConfig } from "@muse-work/provider";
import { openHostedAppContext } from "../src/services/appContext.js";
import {
  neteasePluginPath,
  parseNeteaseManifest,
  selectCodeMakerProvider,
  syncNeteasePlugin,
} from "../src/plugins/neteaseInstall.js";
import { closeTestApp, listenTestApp } from "./helpers.js";

const MANIFEST = "https://minio-api.codewave-test.163yun.com/lowcode-static/muse-plugin-netease/latest.json";
const BUNDLE_URL =
  "https://minio-api.codewave-test.163yun.com/lowcode-static/muse-plugin-netease/0.1.0/netease.js";

const homes: string[] = [];
const savedPlugins = process.env.MUSE_HOST_PLUGINS;

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-netease-"));
  homes.push(home);
  return home;
}

const logger = {
  info() {},
  warn() {},
  error() {},
};

afterEach(() => {
  if (savedPlugins === undefined) delete process.env.MUSE_HOST_PLUGINS;
  else process.env.MUSE_HOST_PLUGINS = savedPlugins;
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

describe("netease plugin install", () => {
  it("rejects a sourcemap or a url outside the plugin prefix", () => {
    expect(
      parseNeteaseManifest({
        version: "0.1.0",
        url: "https://minio-api.codewave-test.163yun.com/lowcode-static/muse-plugin-netease/0.1.0/netease.js.map",
      }),
    ).toBeNull();
    expect(
      parseNeteaseManifest({
        version: "0.1.0",
        url: "https://example.test/netease.js",
      }),
    ).toBeNull();
    expect(parseNeteaseManifest({ version: "0.1.0", url: BUNDLE_URL })).toEqual({
      version: "0.1.0",
      url: BUNDLE_URL,
    });
  });

  it("downloads the bundle named by latest.json and does not write host-plugins.json", async () => {
    const home = tempHome();
    const fetchImpl = (async (url: string) => {
      if (url === MANIFEST) {
        return Response.json({ version: "0.1.0", url: BUNDLE_URL });
      }
      return new Response("export const plugin = { id: 'netease', register() {} };");
    }) as typeof fetch;

    const result = await syncNeteasePlugin({
      home,
      logger,
      fetch: fetchImpl,
      manifestUrl: MANIFEST,
    });
    expect(result).toEqual({ status: "installed", version: "0.1.0" });
    const dest = neteasePluginPath(home);
    expect(fs.readFileSync(dest, "utf8")).toContain("netease");
    expect(fs.readFileSync(`${path.dirname(dest)}/netease.version`, "utf8").trim()).toBe("0.1.0");
    expect(fs.existsSync(path.join(getMuseHomeDir(home), "host-plugins.json"))).toBe(false);
    expect(fs.existsSync(`${dest}.map`)).toBe(false);
  });

  it("keeps the local file when the published version has not changed", async () => {
    const home = tempHome();
    const dest = neteasePluginPath(home);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "export const plugin = { id: 'netease', register() {} };");
    fs.writeFileSync(`${path.dirname(dest)}/netease.version`, "0.1.0\n");
    let downloads = 0;
    const fetchImpl = (async (url: string) => {
      if (url === MANIFEST) return Response.json({ version: "0.1.0", url: BUNDLE_URL });
      downloads += 1;
      return new Response("newer");
    }) as typeof fetch;

    const result = await syncNeteasePlugin({
      home,
      logger,
      fetch: fetchImpl,
      manifestUrl: MANIFEST,
    });
    expect(result.status).toBe("current");
    expect(downloads).toBe(0);
    expect(fs.readFileSync(dest, "utf8")).not.toContain("newer");
  });

  it("replaces the local file when latest.json moves to a new version", async () => {
    const home = tempHome();
    const dest = neteasePluginPath(home);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "old");
    fs.writeFileSync(`${path.dirname(dest)}/netease.version`, "0.1.0\n");
    const nextUrl = BUNDLE_URL.replace("0.1.0", "0.2.0");
    const fetchImpl = (async (url: string) => {
      if (url === MANIFEST) return Response.json({ version: "0.2.0", url: nextUrl });
      return new Response("export const plugin = { id: 'netease', register() {} };");
    }) as typeof fetch;

    const result = await syncNeteasePlugin({
      home,
      logger,
      fetch: fetchImpl,
      manifestUrl: MANIFEST,
    });
    expect(result).toEqual({ status: "installed", version: "0.2.0" });
    expect(fs.readFileSync(dest, "utf8")).toContain("netease");
  });

  it("leaves the installed file alone when the manifest cannot be fetched", async () => {
    const home = tempHome();
    const dest = neteasePluginPath(home);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "keep");
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    const result = await syncNeteasePlugin({
      home,
      logger,
      fetch: fetchImpl,
      manifestUrl: MANIFEST,
    });
    expect(result.status).toBe("skipped");
    expect(fs.readFileSync(dest, "utf8")).toBe("keep");
  });

  it("switches a default DeepSeek selection to CodeMaker and keeps Codex", () => {
    const home = tempHome();
    expect(selectCodeMakerProvider(home)).toBe(true);
    expect(loadProvidersConfig(home).activeProviderId).toBe("codemaker");

    const cfg = loadProvidersConfig(home);
    cfg.activeProviderId = "codex";
    saveProvidersConfig(cfg, home);
    expect(selectCodeMakerProvider(home)).toBe(false);
    expect(loadProvidersConfig(home).activeProviderId).toBe("codex");
  });

  it("selects CodeMaker after the netease plugin registers", async () => {
    const home = tempHome();
    const source = `
      export const plugin = {
        id: "netease",
        register(ctx) {
          ctx.registerProvider({
            id: "codemaker",
            displayName: "CodeMaker",
            async getAuthStatus() { return { state: "unauthenticated", providerId: "codemaker" }; },
            async beginLogin() { throw new Error("no"); },
            async completeLogin() { throw new Error("no"); },
            async logout() {},
            async listModels() { return []; },
            async resolveGateway(modelId) { return { baseURL: "https://example.test", model: modelId }; },
          });
        },
      };
    `;
    const file = path.join(home, "netease.mjs");
    fs.writeFileSync(file, source);
    process.env.MUSE_HOST_PLUGINS = file;
    const ctx = await openHostedAppContext({ home });
    const app = await listenTestApp({ home, ctx });
    try {
      expect(loadProvidersConfig(home).activeProviderId).toBe("codemaker");
      expect(ctx.registry.get("codemaker")).toBeDefined();
    } finally {
      await closeTestApp(app.server);
    }
  });
});
