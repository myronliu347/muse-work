import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTokenStore, type TokenPair } from "../src/popo/tokenStore.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "popo-token-"));
}

function okPair(overrides: Partial<TokenPair> = {}): TokenPair {
  const now = Date.now();
  return {
    accessToken: "access-1",
    accessExpiredAt: now + 24 * 3600 * 1000,
    refreshToken: "refresh-1",
    refreshExpiredAt: now + 30 * 24 * 3600 * 1000,
    ...overrides,
  };
}

describe("popo tokenStore", () => {
  it("fetches a fresh token via /token on first call and caches it", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(String(init?.method ?? "GET") + " " + url);
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ errcode: 0, errmsg: "ok", data: okPair() }),
        { status: 200 },
      );
    }) as typeof fetch;

    const store = createTokenStore({
      home: tempHome(),
      appKey: "k",
      appSecret: "s",
      fetchImpl,
    });
    expect(await store.getAccessToken()).toBe("access-1");
    expect(await store.getAccessToken()).toBe("access-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/open-apis/robots/v1/token");
  });

  it("refreshes via /token/refresh when access token expired", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.includes("/token/refresh")) {
        return new Response(
          JSON.stringify({
            errcode: 0,
            errmsg: "ok",
            data: okPair({ accessToken: "access-2" }),
          }),
          { status: 200 },
        );
      }
      throw new Error("should not call /token");
    }) as typeof fetch;

    const home = tempHome();
    // 预置一份 access 已过期、refresh 仍有效的持久化 token，触发 /token/refresh
    fs.mkdirSync(path.join(home, ".muse-work"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".muse-work", "popo-token.json"),
      JSON.stringify(okPair()),
      "utf8",
    );
    const store = createTokenStore({
      home,
      appKey: "k",
      appSecret: "s",
      fetchImpl,
      now: () => Date.now() + 25 * 3600 * 1000,
    });
    expect(await store.getAccessToken()).toBe("access-2");
    expect(calls[0]).toContain("/token/refresh");
  });

  it("renews via /token when refresh fails with 42002", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.includes("/token/refresh")) {
        return new Response(JSON.stringify({ status: 42002, message: "refresh token expire" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ errcode: 0, errmsg: "ok", data: okPair({ accessToken: "access-3" }) }),
        { status: 200 },
      );
    }) as typeof fetch;

    const home = tempHome();
    // 预置一份 access 已过期、refresh 仍有效的持久化 token，先走 /token/refresh 再换新
    fs.mkdirSync(path.join(home, ".muse-work"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".muse-work", "popo-token.json"),
      JSON.stringify(okPair()),
      "utf8",
    );
    const store = createTokenStore({
      home,
      appKey: "k",
      appSecret: "s",
      fetchImpl,
      now: () => Date.now() + 25 * 3600 * 1000,
    });
    expect(await store.getAccessToken()).toBe("access-3");
    expect(calls.some((u) => u.includes("/open-apis/robots/v1/token"))).toBe(true);
  });

  it("persists tokens to disk and reloads them", async () => {
    const home = tempHome();
    const fetchImpl = (async () => {
      throw new Error("should not fetch when valid cached token exists");
    }) as typeof fetch;
    fs.mkdirSync(path.join(home, ".muse-work"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".muse-work", "popo-token.json"),
      JSON.stringify(okPair()),
      "utf8",
    );
    const store = createTokenStore({ home, appKey: "k", appSecret: "s", fetchImpl });
    expect(await store.getAccessToken()).toBe("access-1");
  });

  it("forceRefresh bypasses the cache", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      return new Response(
        JSON.stringify({ errcode: 0, errmsg: "ok", data: okPair({ accessToken: `access-${call}` }) }),
        { status: 200 },
      );
    }) as typeof fetch;
    const store = createTokenStore({
      home: tempHome(),
      appKey: "k",
      appSecret: "s",
      fetchImpl,
    });
    expect(await store.getAccessToken()).toBe("access-1");
    expect(await store.forceRefresh()).toBe("access-2");
  });

  it("persists the token file with 0600 permissions", async () => {
    const home = tempHome();
    const fetchImpl = (async () => {
      return new Response(
        JSON.stringify({ errcode: 0, errmsg: "ok", data: okPair() }),
        { status: 200 },
      );
    }) as typeof fetch;
    const store = createTokenStore({ home, appKey: "k", appSecret: "s", fetchImpl });
    expect(await store.getAccessToken()).toBe("access-1");

    const file = path.join(home, ".muse-work", "popo-token.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
