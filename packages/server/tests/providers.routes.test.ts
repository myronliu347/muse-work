import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import {
  createProviderRegistry,
  loadProvidersConfig,
  saveProvidersConfig,
  type AiProvider,
  type AuthStatus,
  type LoginStart,
  type ModelInfo,
} from "@muse-work/provider";
import { createApp } from "../src/app.js";
import { closeTestApp, listenTestApp } from "./helpers.js";
import {
  createSessionServices,
  type AppContext,
} from "../src/createAppContext.js";

describe("providers + auth routes", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  it("GET /providers returns active provider and models", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/providers`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Array<{
        id: string;
        displayName: string;
        models: ModelInfo[];
      }>;
      active: { providerId: string; modelId?: string };
    };

    expect(body.active.providerId).toBe("codemaker");
    expect(body.providers.map((p) => p.id).sort()).toEqual([
      "codemaker",
      "openai-compatible",
    ]);
    const openai = body.providers.find((p) => p.id === "openai-compatible");
    expect(openai?.models.map((m) => m.id)).toContain("gpt-4.1");
  });

  it("POST /providers/active switches model", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/providers/active`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "openai-compatible",
        modelId: "gpt-4.1-mini",
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      active: {
        providerId: "openai-compatible",
        modelId: "gpt-4.1-mini",
      },
    });

    const cfg = loadProvidersConfig(home);
    expect(cfg.activeProviderId).toBe("openai-compatible");
    expect(cfg.activeModelId).toBe("gpt-4.1-mini");

    const list = await fetch(`${app.baseUrl}/providers`);
    const body = (await list.json()) as {
      active: { providerId: string; modelId?: string };
    };
    expect(body.active).toEqual({
      providerId: "openai-compatible",
      modelId: "gpt-4.1-mini",
    });
  });

  it("GET /providers/:id/models returns model list", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/providers/openai-compatible/models`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: ModelInfo[] };
    expect(body.models.map((m) => m.id)).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
  });

  it("GET /auth/status returns active provider auth status", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/auth/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthStatus;
    expect(body.providerId).toBe("codemaker");
    expect(body.state).toBe("unauthenticated");
  });

  it("POST /auth/login returns authUrl without opening browser", async () => {
    let loginCalls = 0;
    const stub: AiProvider = {
      id: "codemaker",
      displayName: "CodeMaker",
      async getAuthStatus() {
        return { state: "unauthenticated", providerId: "codemaker" };
      },
      async beginLogin() {
        loginCalls += 1;
        return { authUrl: "https://example.test/login?uuid=abc" };
      },
      async completeLogin() {
        return {
          state: "authenticated",
          user: "alice",
          providerId: "codemaker",
        };
      },
      async logout() {},
      async listModels() {
        return [{ id: "m1", label: "M1" }];
      },
      async resolveGateway() {
        return { baseURL: "https://example.test", model: "m1" };
      },
    };

    const openaiStub: AiProvider = {
      id: "openai-compatible",
      displayName: "OpenAI Compatible",
      async getAuthStatus() {
        return { state: "needs_config", providerId: "openai-compatible" };
      },
      async beginLogin() {
        throw new Error("no sso");
      },
      async completeLogin() {
        throw new Error("no sso");
      },
      async logout() {},
      async listModels() {
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return { baseURL: "https://api.example.com/v1", model: modelId };
      },
    };

    const app = await listenWithStubs([stub, openaiStub]);
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/auth/login`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as LoginStart;
    expect(body).toEqual({ authUrl: "https://example.test/login?uuid=abc" });
    expect(loginCalls).toBe(1);
  });

  it("POST /auth/login with wait completes login", async () => {
    const stub: AiProvider = {
      id: "codemaker",
      displayName: "CodeMaker",
      async getAuthStatus() {
        return { state: "unauthenticated", providerId: "codemaker" };
      },
      async beginLogin() {
        return { authUrl: "https://example.test/login" };
      },
      async completeLogin() {
        return {
          state: "authenticated",
          user: "bob",
          providerId: "codemaker",
        };
      },
      async logout() {},
      async listModels() {
        return [{ id: "m1", label: "M1" }];
      },
      async resolveGateway() {
        return { baseURL: "https://example.test", model: "m1" };
      },
    };

    const openaiStub: AiProvider = {
      id: "openai-compatible",
      displayName: "OpenAI Compatible",
      async getAuthStatus() {
        return { state: "needs_config", providerId: "openai-compatible" };
      },
      async beginLogin() {
        throw new Error("no sso");
      },
      async completeLogin() {
        throw new Error("no sso");
      },
      async logout() {},
      async listModels() {
        return [];
      },
      async resolveGateway(modelId: string) {
        return { baseURL: "https://api.example.com/v1", model: modelId };
      },
    };

    const app = await listenWithStubs([stub, openaiStub]);
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wait: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: "authenticated",
      user: "bob",
      providerId: "codemaker",
    });
  });

  it("POST /auth/logout clears session", async () => {
    let loggedOut = false;
    const stub: AiProvider = {
      id: "codemaker",
      displayName: "CodeMaker",
      async getAuthStatus() {
        return loggedOut
          ? { state: "unauthenticated", providerId: "codemaker" }
          : {
              state: "authenticated",
              user: "alice",
              providerId: "codemaker",
            };
      },
      async beginLogin() {
        return { reused: true };
      },
      async completeLogin() {
        return {
          state: "authenticated",
          user: "alice",
          providerId: "codemaker",
        };
      },
      async logout() {
        loggedOut = true;
      },
      async listModels() {
        return [{ id: "m1", label: "M1" }];
      },
      async resolveGateway() {
        return { baseURL: "https://example.test", model: "m1" };
      },
    };

    const openaiStub: AiProvider = {
      id: "openai-compatible",
      displayName: "OpenAI Compatible",
      async getAuthStatus() {
        return { state: "needs_config", providerId: "openai-compatible" };
      },
      async beginLogin() {
        throw new Error("no sso");
      },
      async completeLogin() {
        throw new Error("no sso");
      },
      async logout() {},
      async listModels() {
        return [];
      },
      async resolveGateway(modelId: string) {
        return { baseURL: "https://api.example.com/v1", model: modelId };
      },
    };

    const app = await listenWithStubs([stub, openaiStub]);
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/auth/logout`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(loggedOut).toBe(true);
  });
});

async function listenWithStubs(providers: AiProvider[]) {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-server-"));
  saveProvidersConfig(
    {
      ...loadProvidersConfig(home),
      activeProviderId: "codemaker",
      activeModelId: "m1",
    },
    home,
  );
  const registry = createProviderRegistry(providers, home);
  const sessions = createSessionServices({ registry });
  const ctx: AppContext = { home, registry, ...sessions };
  const server = createApp(ctx);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP address");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    home,
    ctx,
  };
}
