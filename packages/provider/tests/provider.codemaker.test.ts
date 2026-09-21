import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CODEMAKER_BASE_URL,
  createCodeMakerProvider,
} from "../src/codemaker/provider.js";
import type { CodeMakerModelsLoader } from "../src/codemaker/models.js";
import type { CodeMakerCreds } from "../src/codemaker/types.js";

const models = [
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
];

const validCreds: CodeMakerCreds = {
  accessToken: "tok",
  accessUser: "bob",
  refreshKey: "rk",
  expire: Date.now() + 60_000,
};

function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "muse-cm-provider-"));
}

describe("createCodeMakerProvider", () => {
  it("has codemaker id and lists models from config", async () => {
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => validCreds,
      // Deterministic: no remote catalog → falls back to config list.
      modelsLoader: { list: async () => null },
    });
    expect(p.id).toBe("codemaker");
    expect((await p.listModels()).map((m) => m.id)).toEqual([
      "deepseek-v4-pro",
      "claude-sonnet-4-6",
    ]);
  });

  it("listModels merges remote catalog with local config (remote wins)", async () => {
    const loader: CodeMakerModelsLoader = {
      list: async () => [
        {
          id: "deepseek-v4-flash-vision-exp",
          label: "Deepseek V4 Flash Vision Exp",
          capabilities: { vision: true, thinking: true },
        },
        { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro (remote)" },
      ],
    };
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => validCreds,
      modelsLoader: loader,
    });
    const listed = await p.listModels();
    expect(listed).toEqual([
      {
        id: "deepseek-v4-flash-vision-exp",
        label: "Deepseek V4 Flash Vision Exp",
        capabilities: { vision: true, thinking: true },
      },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro (remote)" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    ]);
  });

  it("listModels falls back to config when remote catalog is unavailable", async () => {
    const loader: CodeMakerModelsLoader = { list: async () => null };
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => validCreds,
      modelsLoader: loader,
    });
    expect(await p.listModels()).toEqual(models);
  });

  it("listModels keeps user custom models not present remotely", async () => {
    const loader: CodeMakerModelsLoader = {
      list: async () => [
        { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      ],
    };
    const p = createCodeMakerProvider({
      getConfig: () => ({
        enabled: true,
        models: [
          { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
          { id: "my-private-model", label: "My Private Model" },
        ],
      }),
      loadCredentials: () => validCreds,
      modelsLoader: loader,
    });
    const listed = await p.listModels();
    expect(listed.map((m) => m.id)).toEqual([
      "deepseek-v4-flash",
      "my-private-model",
    ]);
  });

  it("resolveGateway returns OpenAI-compatible baseURL and signed fetch", async () => {
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => validCreds,
    });
    const g = await p.resolveGateway("deepseek-v4-pro");
    expect(g.baseURL).toBe(`${CODEMAKER_BASE_URL}/openai/v1`);
    expect(g.model).toBe("deepseek-v4-pro");
    expect(g.fastModel).toBe("deepseek-v4-pro");
    expect(typeof g.fetch).toBe("function");
  });

  it("getAuthStatus reflects credentials loader", async () => {
    const authed = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => validCreds,
    });
    expect(await authed.getAuthStatus()).toEqual({
      state: "authenticated",
      user: "bob",
      providerId: "codemaker",
    });

    const missing = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => null,
    });
    expect((await missing.getAuthStatus()).state).toBe("unauthenticated");

    // Expired without refresh_key → clear to unauthenticated (no refresh path).
    const expired = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => ({
        accessToken: "tok",
        accessUser: "bob",
        expire: Date.now() - 1,
      }),
      home: "/tmp/muse-provider-expired-no-rk",
    });
    expect((await expired.getAuthStatus()).state).toBe("unauthenticated");
  });

  it("beginLogin reuses valid credentials", async () => {
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => validCreds,
    });
    await expect(p.beginLogin()).resolves.toEqual({ reused: true });
  });

  it("completeLogin requires beginLogin first", async () => {
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => null,
    });
    await expect(p.completeLogin({})).rejects.toThrow(/beginLogin/i);
  });

  it("beginLogin reuses in-progress authUrl without minting a new uuid", async () => {
    const uuids: string[] = [];
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => null,
      openBrowser: () => {},
      createUuid: () => {
        const id = `uuid-${uuids.length + 1}`;
        uuids.push(id);
        return id;
      },
      fetch: (async () => {
        throw new Error("should not poll during begin");
      }) as unknown as typeof fetch,
    });

    const first = await p.beginLogin();
    expect(first).toEqual({
      authUrl: expect.stringContaining("uuid=uuid-1"),
    });
    const second = await p.beginLogin();
    expect(second).toEqual(first);
    expect(uuids).toEqual(["uuid-1"]);
  });

  it("waitUntilComplete after beginLogin does not mint a second uuid", async () => {
    const home = makeTempHome();
    const uuids: string[] = [];
    let pollCount = 0;
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => null,
      home,
      openBrowser: () => {},
      createUuid: () => {
        const id = `uuid-${uuids.length + 1}`;
        uuids.push(id);
        return id;
      },
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/vs_login_info/")) {
          pollCount += 1;
          return new Response(
            JSON.stringify({
              access_user: "alice",
              access_token: "tok",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/get_auth_key")) {
          return new Response(JSON.stringify({ auth_key: "rk" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`unexpected ${url}`);
      }) as unknown as typeof fetch,
    });

    // Simulate server: first call returns authUrl; second wait completes same session.
    const start = await p.beginLogin();
    expect("authUrl" in start).toBe(true);
    expect(uuids).toEqual(["uuid-1"]);

    // Must NOT call beginLogin again (that would mint uuid-2).
    const status = await p.completeLogin({});
    expect(status.state).toBe("authenticated");
    expect(uuids).toEqual(["uuid-1"]);
    expect(pollCount).toBeGreaterThanOrEqual(1);

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("expired creds with refresh_key renew and become authenticated", async () => {
    const saved: CodeMakerCreds[] = [];
    let creds: CodeMakerCreds = {
      accessToken: "old",
      accessUser: "bob",
      refreshKey: "rk",
      expire: Date.now() - 1,
    };
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => creds,
      renewCredentials: async ({ creds: c }) => {
        const next = {
          accessToken: "new-tok",
          accessUser: c.accessUser,
          refreshKey: c.refreshKey,
          expire: Date.now() + 60_000,
        };
        saved.push(next);
        creds = next;
        return next;
      },
    });

    expect(await p.getAuthStatus()).toEqual({
      state: "authenticated",
      user: "bob",
      providerId: "codemaker",
    });
    expect(saved).toHaveLength(1);
    const g = await p.resolveGateway("deepseek-v4-pro");
    expect(g.model).toBe("deepseek-v4-pro");
  });

  it("getAuthStatus treats a live 403 token-expired probe as unauthenticated", async () => {
    const home = makeTempHome();
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => validCreds,
      home,
      fetch: async () =>
        new Response(
          JSON.stringify({
            msg: "auth failed",
            extra: {
              code: 30002,
              msg: "request access token is invalid: token error: Token is expired",
            },
          }),
          { status: 403 },
        ),
    });

    expect((await p.getAuthStatus()).state).toBe("unauthenticated");
    fs.rmSync(home, { recursive: true, force: true });
  });
});

