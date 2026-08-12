import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginCodeMakerLogin,
  CODEMAKER_AUTH_API_URL,
  CODEMAKER_LOGIN_PATH,
} from "../src/codemaker/login.js";
import { loadCodeMakerCredentials } from "../src/codemaker/credentials.js";
import { getCodeMakerAuthPath } from "../src/paths.js";

function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "muse-login-"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("beginCodeMakerLogin", () => {
  it("start login returns authUrl containing redirect_uri (CodeMaker SSO)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("unexpected fetch during start");
    });
    const opened: string[] = [];

    const start = await beginCodeMakerLogin({
      openBrowser: (url) => {
        opened.push(url);
      },
      fetch: fetchMock as unknown as typeof fetch,
      // avoid reused path
      loadCredentials: () => null,
    });

    expect(start).toHaveProperty("authUrl");
    const authUrl = String((start as { authUrl: string }).authUrl);
    expect(authUrl).toContain(CODEMAKER_LOGIN_PATH);
    expect(authUrl).toContain("redirect_uri=");
    expect(authUrl).toContain("uuid=");
    expect(opened).toEqual([authUrl]);
    // brief mentioned callback_url; CodeMaker CLI uses redirect_uri + uuid poll
    expect(authUrl).not.toContain(CODEMAKER_AUTH_API_URL);
  });

  it("complete login persists muse auth file", async () => {
    const home = makeTempHome();
    const uuidHolder: { uuid?: string } = {};

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/vs_login_info/")) {
        const uuid = url.split("/vs_login_info/")[1] ?? "";
        uuidHolder.uuid = uuid;
        return new Response(
          JSON.stringify({
            access_user: "alice",
            access_token: "access-tok",
            access_sso_token: "sso-tok",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/get_auth_key")) {
        return new Response(JSON.stringify({ auth_key: "refresh-key" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const start = await beginCodeMakerLogin({
      openBrowser: () => {},
      fetch: fetchMock as unknown as typeof fetch,
      home,
      loadCredentials: () => null,
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });

    expect("waitUntilComplete" in start).toBe(true);
    const status = await (
      start as { waitUntilComplete: () => Promise<{ state: string; user?: string }> }
    ).waitUntilComplete();

    expect(status).toEqual({
      state: "authenticated",
      user: "alice",
      providerId: "codemaker",
    });

    const authPath = getCodeMakerAuthPath(home);
    expect(fs.existsSync(authPath)).toBe(true);
    expect(loadCodeMakerCredentials(home)).toEqual({
      accessToken: "access-tok",
      refreshKey: "refresh-key",
      accessUser: "alice",
    });
    expect(uuidHolder.uuid).toBeTruthy();
  });

  it("reuses valid credentials without opening browser", async () => {
    const opened: string[] = [];
    const start = await beginCodeMakerLogin({
      openBrowser: (url) => opened.push(url),
      loadCredentials: () => ({
        accessToken: "tok",
        accessUser: "bob",
        expire: Date.now() + 60_000,
      }),
    });
    expect(start).toEqual(
      expect.objectContaining({ reused: true }),
    );
    expect(opened).toEqual([]);
  });
});
