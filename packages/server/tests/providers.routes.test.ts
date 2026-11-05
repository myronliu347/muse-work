import { describe, it, expect, afterEach, beforeEach } from "vitest";
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
} from "../src/services/appContext.js";
import { createIssueStore } from "../src/services/issueStore.js";
import { createIssueDispatcher } from "../src/services/issueDispatch.js";
import { createAutomationStore } from "../src/services/automationStore.js";
import { createAutomationRuntime } from "../src/services/automationRuntime.js";

describe("providers + auth routes", () => {
  let server: Server | undefined;
  let home: string | undefined;
  const savedDeepSeekKey = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(async () => {
    if (savedDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = savedDeepSeekKey;
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

    expect(body.active.providerId).toBe("deepseek");
    expect(body.providers.map((p) => p.id).sort()).toEqual([
      "codex",
      "deepseek",
      "openai-compatible",
    ]);
    const openai = body.providers.find((p) => p.id === "openai-compatible");
    expect(openai?.models.map((m) => m.id)).toContain("gpt-4.1");
  });

  it("POST /providers/active switches model and invalidates agent identities", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    let invalidated = false;
    const original = app.ctx.runner.invalidateAgentIdentities.bind(app.ctx.runner);
    app.ctx.runner.invalidateAgentIdentities = () => {
      invalidated = true;
      original();
    };

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
    expect(invalidated).toBe(true);

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

  it("GET/PATCH /providers/openai-compatible reads and writes config", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    let invalidated = false;
    const original = app.ctx.runner.invalidateAgentIdentities.bind(app.ctx.runner);
    app.ctx.runner.invalidateAgentIdentities = () => {
      invalidated = true;
      original();
    };

    const getRes = await fetch(`${app.baseUrl}/providers/openai-compatible`);
    expect(getRes.status).toBe(200);
    const before = (await getRes.json()) as {
      baseURL: string;
      models: ModelInfo[];
    };
    expect(before.baseURL).toContain("http");
    expect(before.models.length).toBeGreaterThan(0);

    const patchRes = await fetch(`${app.baseUrl}/providers/openai-compatible`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseURL: "https://llm.example.com/v1",
        apiKey: "sk-test-key",
        models: [
          { id: "m-a", label: "Model A" },
          { id: "m-b", label: "Model B" },
        ],
      }),
    });
    expect(patchRes.status).toBe(200);
    expect(invalidated).toBe(true);

    const cfg = loadProvidersConfig(home);
    expect(cfg.providers["openai-compatible"].baseURL).toBe(
      "https://llm.example.com/v1",
    );
    expect(cfg.providers["openai-compatible"].apiKey).toBe("sk-test-key");
    expect(cfg.providers["openai-compatible"].models.map((m) => m.id)).toEqual([
      "m-a",
      "m-b",
    ]);
  });

  it("GET /providers/codemaker/quota is missing without the netease plugin", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const res = await fetch(`${app.baseUrl}/providers/codemaker/quota`);
    expect(res.status).toBe(404);
  });

  it("GET /providers/deepseek/quota is unauthenticated without a key", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const res = await fetch(`${app.baseUrl}/providers/deepseek/quota`);
    expect(res.status).toBe(401);
  });

  it("POST /providers/deepseek/api-key stores DEEPSEEK_API_KEY", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const res = await fetch(`${app.baseUrl}/providers/deepseek/api-key`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "test-key" }),
    });
    expect(res.status).toBe(200);
    expect(process.env.DEEPSEEK_API_KEY).toBe("test-key");
  });

  it("GET /providers/:id/quota returns 404 when the provider has no quota", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const res = await fetch(`${app.baseUrl}/providers/openai-compatible/quota`);
    expect(res.status).toBe(404);
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
    expect(body.providerId).toBe("deepseek");
    expect(body.state).toBe("needs_config");
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

  it("POST /auth/login wait reuses prior beginLogin (no second begin)", async () => {
    let beginCalls = 0;
    let completeCalls = 0;
    let active = false;
    const stub: AiProvider = {
      id: "codemaker",
      displayName: "CodeMaker",
      async getAuthStatus() {
        return { state: "unauthenticated", providerId: "codemaker" };
      },
      async beginLogin() {
        beginCalls += 1;
        active = true;
        return { authUrl: `https://example.test/login?n=${beginCalls}` };
      },
      async completeLogin() {
        if (!active) {
          throw new Error("No login in progress; call beginLogin first");
        }
        completeCalls += 1;
        active = false;
        return {
          state: "authenticated",
          user: "carol",
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

    const startRes = await fetch(`${app.baseUrl}/auth/login`, { method: "POST" });
    expect(startRes.status).toBe(200);
    expect(await startRes.json()).toEqual({
      authUrl: "https://example.test/login?n=1",
    });

    const waitRes = await fetch(`${app.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wait: true }),
    });
    expect(waitRes.status).toBe(200);
    expect(await waitRes.json()).toEqual({
      state: "authenticated",
      user: "carol",
      providerId: "codemaker",
    });
    expect(beginCalls).toBe(1);
    expect(completeCalls).toBe(1);
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
  const sessions = createSessionServices({ home, registry });
  const issues = createIssueStore({ home });
  const automations = createAutomationStore({ home });
  const automationRuntime = createAutomationRuntime({
    store: automations,
    hub: sessions.hub,
    sessions: sessions.store,
    runner: sessions.runner,
    home,
  });
  const dispatcher = createIssueDispatcher({
    issues,
    sessions: sessions.store,
    runner: sessions.runner,
    hub: sessions.hub,
    home,
  });
  sessions.runner.setOnTurnSettled((sessionId, result) => {
    dispatcher.handleTurnSettled(sessionId, result);
  });
  const ctx: AppContext = {
    home,
    registry,
    ...sessions,
    issueStore: issues,
    automationStore: automations,
    automationRuntime,
    issueDispatcher: dispatcher,
  };
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
