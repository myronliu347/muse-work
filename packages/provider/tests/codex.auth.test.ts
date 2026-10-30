import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  clearCodexCredentials,
  loadCodexCredentials,
  saveCodexCredentials,
  type CodexCreds,
} from "../src/codex/credentials.js";
import { parseChatGptClaims } from "../src/codex/jwt.js";
import {
  beginCodexLogin,
  CODEX_CLIENT_ID,
  CODEX_ISSUER,
} from "../src/codex/login.js";
import {
  CODEX_API_BASE_URL,
  createCodexProvider,
} from "../src/codex/provider.js";
import {
  accessTokenNeedsRefresh,
  CodexRefreshError,
  refreshCodexCredentials,
} from "../src/codex/refresh.js";
import { getCodexAuthPath } from "../src/paths.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "muse-codex-"));
}

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(payload: object): string {
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(payload)}.sig`;
}

function idToken(opts: {
  accountId?: string;
  email?: string;
  exp?: number;
}): string {
  return jwt({
    email: opts.email,
    exp: opts.exp,
    "https://api.openai.com/auth": {
      chatgpt_account_id: opts.accountId,
      chatgpt_user_id: "user_1",
    },
  });
}

function creds(overrides: Partial<CodexCreds> = {}): CodexCreds {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  return {
    idToken: idToken({ accountId: "acct_1", email: "ada@example.com", exp }),
    accessToken: jwt({ exp }),
    refreshToken: "refresh-1",
    accountId: "acct_1",
    email: "ada@example.com",
    issuer: CODEX_ISSUER,
    clientId: CODEX_CLIENT_ID,
    loginOwnerId: "login-1",
    lastRefresh: new Date().toISOString(),
    ...overrides,
  };
}

function tokenResponse(next: {
  accessExp: number;
  refreshToken?: string;
  accountId?: string;
}): Response {
  const accountId = next.accountId ?? "acct_1";
  return new Response(
    JSON.stringify({
      id_token: idToken({
        accountId,
        email: "ada@example.com",
        exp: next.accessExp,
      }),
      access_token: jwt({ exp: next.accessExp }),
      refresh_token: next.refreshToken ?? "refresh-2",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("codex credentials", () => {
  it("round-trips tokens under ~/.muse-work/auth/codex.json with mode 0600", () => {
    const home = tempHome();
    const stored = creds();
    saveCodexCredentials(stored, home);

    const authPath = getCodexAuthPath(home);
    expect(authPath).toBe(path.join(home, ".muse-work", "auth", "codex.json"));
    expect(loadCodexCredentials(home)).toEqual(stored);
    if (process.platform !== "win32") {
      expect(fs.statSync(authPath).mode & 0o777).toBe(0o600);
    }
  });

  it("clear removes the auth file", () => {
    const home = tempHome();
    saveCodexCredentials(creds(), home);
    clearCodexCredentials(home);
    expect(loadCodexCredentials(home)).toBeNull();
    expect(fs.existsSync(getCodexAuthPath(home))).toBe(false);
  });
});

describe("parseChatGptClaims", () => {
  it("reads account id, email, and exp from the payload", () => {
    const exp = 1_900_000_000;
    const token = idToken({
      accountId: "acct_9",
      email: "ada@example.com",
      exp,
    });
    expect(parseChatGptClaims(token)).toEqual({
      accountId: "acct_9",
      email: "ada@example.com",
      exp,
    });
  });
});

describe("accessTokenNeedsRefresh", () => {
  it("refreshes inside the 5 minute window and on the 8 day schedule", () => {
    const now = Date.parse("2026-10-30T00:00:00.000Z");
    const soon = creds({
      accessToken: jwt({ exp: Math.floor(now / 1000) + 4 * 60 }),
      lastRefresh: new Date(now).toISOString(),
    });
    const fresh = creds({
      accessToken: jwt({ exp: Math.floor(now / 1000) + 30 * 60 }),
      lastRefresh: new Date(now).toISOString(),
    });
    const stale = creds({
      accessToken: "not-a-jwt",
      lastRefresh: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const recentOpaque = creds({
      accessToken: "not-a-jwt",
      lastRefresh: new Date(now - 60_000).toISOString(),
    });

    expect(accessTokenNeedsRefresh(soon, now)).toBe(true);
    expect(accessTokenNeedsRefresh(fresh, now)).toBe(false);
    expect(accessTokenNeedsRefresh(stale, now)).toBe(true);
    expect(accessTokenNeedsRefresh(recentOpaque, now)).toBe(false);
  });
});

describe("refreshCodexCredentials", () => {
  it("writes the rotated tokens when the same login is still on disk", async () => {
    const home = tempHome();
    const current = creds({
      accessToken: jwt({ exp: Math.floor(Date.now() / 1000) + 60 }),
    });
    saveCodexCredentials(current, home);
    const nextExp = Math.floor(Date.now() / 1000) + 3600;

    const updated = await refreshCodexCredentials({
      creds: current,
      home,
      fetch: async (input, init) => {
        expect(String(input)).toBe(`${CODEX_ISSUER}/oauth/token`);
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          grant_type: "refresh_token",
          refresh_token: "refresh-1",
          client_id: CODEX_CLIENT_ID,
        });
        return tokenResponse({ accessExp: nextExp, refreshToken: "refresh-2" });
      },
    });

    expect(updated.refreshToken).toBe("refresh-2");
    expect(updated.loginOwnerId).toBe("login-1");
    expect(loadCodexCredentials(home)?.refreshToken).toBe("refresh-2");
  });

  it("clears credentials on invalid_grant", async () => {
    const home = tempHome();
    const current = creds();
    saveCodexCredentials(current, home);

    const error = await refreshCodexCredentials({
      creds: current,
      home,
      fetch: async () =>
        new Response(
          JSON.stringify({ error: "invalid_grant" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(CodexRefreshError);
    expect((error as CodexRefreshError).permanent).toBe(true);
    expect(loadCodexCredentials(home)).toBeNull();
  });

  it("keeps credentials when the token endpoint is unreachable", async () => {
    const home = tempHome();
    const current = creds();
    saveCodexCredentials(current, home);

    const error = await refreshCodexCredentials({
      creds: current,
      home,
      fetch: async () => new Response("nope", { status: 503 }),
    }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(CodexRefreshError);
    expect((error as CodexRefreshError).permanent).toBe(false);
    expect(loadCodexCredentials(home)?.refreshToken).toBe("refresh-1");
  });

  it("does not overwrite a login that changed during refresh", async () => {
    const home = tempHome();
    const current = creds();
    saveCodexCredentials(current, home);
    const other = creds({ loginOwnerId: "login-2", refreshToken: "other" });

    const error = await refreshCodexCredentials({
      creds: current,
      home,
      fetch: async () => {
        saveCodexCredentials(other, home);
        return tokenResponse({
          accessExp: Math.floor(Date.now() / 1000) + 3600,
        });
      },
    }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(CodexRefreshError);
    expect((error as CodexRefreshError).permanent).toBe(false);
    expect(loadCodexCredentials(home)).toEqual(other);
  });
});

describe("beginCodexLogin", () => {
  it("exchanges the callback code and stores ChatGPT tokens", async () => {
    const home = tempHome();
    const accessExp = Math.floor(Date.now() / 1000) + 3600;
    let tokenBody = "";

    const start = await beginCodexLogin({
      home,
      port: 0,
      issuer: "https://auth.example.test",
      openBrowser: () => {},
      loadCredentials: () => null,
      fetch: async (_input, init) => {
        tokenBody = String(init?.body ?? "");
        return tokenResponse({ accessExp, refreshToken: "refresh-new" });
      },
    });

    expect("authUrl" in start).toBe(true);
    const authUrl = new URL((start as { authUrl: string }).authUrl);
    expect(authUrl.origin + authUrl.pathname).toBe(
      "https://auth.example.test/oauth/authorize",
    );
    expect(authUrl.searchParams.get("client_id")).toBe(CODEX_CLIENT_ID);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    const redirectUri = authUrl.searchParams.get("redirect_uri");
    const state = authUrl.searchParams.get("state");
    const challenge = authUrl.searchParams.get("code_challenge");
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(state).toBeTruthy();
    expect(challenge).toBeTruthy();

    const callback = new URL(redirectUri!);
    callback.searchParams.set("code", "auth-code");
    callback.searchParams.set("state", state!);
    const callbackResponse = await fetch(callback, { redirect: "manual" });
    expect(callbackResponse.status).toBe(302);

    const status = await (
      start as { waitUntilComplete: () => Promise<{ state: string; user?: string }> }
    ).waitUntilComplete();
    expect(status).toEqual({
      state: "authenticated",
      user: "ada@example.com",
      providerId: "codex",
    });

    const params = new URLSearchParams(tokenBody);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("auth-code");
    expect(params.get("redirect_uri")).toBe(redirectUri);
    const verifier = params.get("code_verifier");
    expect(verifier).toBeTruthy();
    const expectedChallenge = createHash("sha256")
      .update(verifier!)
      .digest("base64url");
    expect(expectedChallenge).toBe(challenge);

    const stored = loadCodexCredentials(home);
    expect(stored?.refreshToken).toBe("refresh-new");
    expect(stored?.accountId).toBe("acct_1");
    expect(stored?.issuer).toBe("https://auth.example.test");
  });

  it("rejects a callback whose state does not match", async () => {
    const start = await beginCodexLogin({
      home: tempHome(),
      port: 0,
      issuer: "https://auth.example.test",
      openBrowser: () => {},
      loadCredentials: () => null,
      fetch: async () => {
        throw new Error("token endpoint should not be called");
      },
    });
    const authUrl = new URL((start as { authUrl: string }).authUrl);
    const callback = new URL(authUrl.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "auth-code");
    callback.searchParams.set("state", "wrong");
    const callbackResponse = await fetch(callback, { redirect: "manual" });
    expect(callbackResponse.status).toBe(400);
    await expect(
      (
        start as { waitUntilComplete: () => Promise<unknown> }
      ).waitUntilComplete(),
    ).rejects.toThrow(/state/i);
  });

  it("rejects an account outside the allowed workspaces", async () => {
    const start = await beginCodexLogin({
      home: tempHome(),
      port: 0,
      issuer: "https://auth.example.test",
      openBrowser: () => {},
      loadCredentials: () => null,
      forcedWorkspaceIds: ["acct_allowed"],
      fetch: async () =>
        tokenResponse({
          accessExp: Math.floor(Date.now() / 1000) + 3600,
          accountId: "acct_other",
        }),
    });
    const authUrl = new URL((start as { authUrl: string }).authUrl);
    const callback = new URL(authUrl.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", "auth-code");
    callback.searchParams.set("state", authUrl.searchParams.get("state")!);
    const callbackResponse = await fetch(callback, { redirect: "manual" });
    expect(callbackResponse.status).toBeGreaterThanOrEqual(400);
    await expect(
      (
        start as { waitUntilComplete: () => Promise<unknown> }
      ).waitUntilComplete(),
    ).rejects.toThrow(/workspace/i);
  });
});

describe("createCodexProvider", () => {
  const models = [{ id: "gpt-5.4", label: "GPT-5.4" }];

  it("reports unauthenticated and refuses a gateway without credentials", async () => {
    const provider = createCodexProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => null,
    });
    expect(provider.id).toBe("codex");
    expect(provider.displayName).toBe("ChatGPT");
    expect(await provider.getAuthStatus()).toEqual({
      state: "unauthenticated",
      providerId: "codex",
    });
    await expect(provider.resolveGateway("gpt-5.4")).rejects.toThrow(
      /credentials/i,
    );
  });

  it("resolveGateway sends the access token and chatgpt-account-id", async () => {
    const current = creds();
    const provider = createCodexProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => current,
    });
    const gateway = await provider.resolveGateway("gpt-5.4");
    expect(gateway.baseURL).toBe(CODEX_API_BASE_URL);
    expect(gateway.apiKey).toBe(current.accessToken);
    expect(gateway.defaultHeaders).toEqual({
      "chatgpt-account-id": "acct_1",
    });
    expect(gateway.credentialFingerprint).toHaveLength(16);
    expect(gateway.model).toBe("gpt-5.4");
  });

  it("reuses a live login and logout deletes it", async () => {
    const home = tempHome();
    saveCodexCredentials(creds(), home);
    const provider = createCodexProvider({
      home,
      getConfig: () => ({ enabled: true, models }),
    });
    const start = await provider.beginLogin({ openBrowser: () => {} });
    expect(start).toEqual({ reused: true });
    await provider.logout();
    expect(loadCodexCredentials(home)).toBeNull();
    expect(await provider.getAuthStatus()).toEqual({
      state: "unauthenticated",
      providerId: "codex",
    });
  });

  it("refreshes a near-expiry access token before resolving the gateway", async () => {
    const home = tempHome();
    const current = creds({
      accessToken: jwt({ exp: Math.floor(Date.now() / 1000) + 30 }),
    });
    saveCodexCredentials(current, home);
    const nextExp = Math.floor(Date.now() / 1000) + 3600;
    const provider = createCodexProvider({
      home,
      getConfig: () => ({ enabled: true, models }),
      fetch: async () =>
        tokenResponse({ accessExp: nextExp, refreshToken: "refresh-2" }),
    });
    const gateway = await provider.resolveGateway("gpt-5.4");
    expect(gateway.apiKey).not.toBe(current.accessToken);
    expect(loadCodexCredentials(home)?.refreshToken).toBe("refresh-2");
  });
});

describe("login server shutdown", () => {
  it("closes the callback server after success", async () => {
    const home = tempHome();
    const start = await beginCodexLogin({
      home,
      port: 0,
      issuer: "https://auth.example.test",
      openBrowser: () => {},
      loadCredentials: () => null,
      fetch: async () =>
        tokenResponse({
          accessExp: Math.floor(Date.now() / 1000) + 3600,
        }),
    });
    const authUrl = new URL((start as { authUrl: string }).authUrl);
    const callback = new URL(authUrl.searchParams.get("redirect_uri")!);
    const port = Number(callback.port);
    callback.searchParams.set("code", "auth-code");
    callback.searchParams.set("state", authUrl.searchParams.get("state")!);
    await fetch(callback, { redirect: "manual" });
    await (
      start as { waitUntilComplete: () => Promise<unknown> }
    ).waitUntilComplete();

    await expect(
      new Promise<void>((resolve, reject) => {
        const req = http.get(
          { hostname: "127.0.0.1", port, path: "/success" },
          (res) => {
            res.resume();
            reject(new Error(`server still listening: ${res.statusCode}`));
          },
        );
        req.on("error", () => resolve());
      }),
    ).resolves.toBeUndefined();
  });
});
