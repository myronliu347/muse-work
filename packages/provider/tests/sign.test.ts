import { createHash, createHmac } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  buildCanonicalString,
  buildCodeMakerHeaders,
  createCodeMakerFetch,
  getSigningKey,
  signCanonical,
} from "../src/codemaker/sign.js";

const CREDS = {
  accessToken: "test-access-token",
  accessUser: "alice",
  refreshKey: "unused-refresh",
};

describe("CodeMaker signing pure helpers", () => {
  it("builds canonical as nonce.timestamp.tokenHash16", () => {
    const tokenHash = createHash("sha256")
      .update(CREDS.accessToken, "utf8")
      .digest("hex")
      .slice(0, 16);
    expect(
      buildCanonicalString({
        accessToken: CREDS.accessToken,
        timestamp: 1700000000,
        nonce: "aabbccddeeff0011",
      }),
    ).toBe(`aabbccddeeff0011.1700000000.${tokenHash}`);
  });

  it("signs with client HMAC key (not refreshKey)", () => {
    const canonical = "aabbccddeeff0011.1700000000.deadbeefdeadbeef";
    const expected = createHmac("sha256", getSigningKey())
      .update(canonical, "utf8")
      .digest("hex");
    expect(signCanonical(canonical)).toBe(expected);
    expect(signCanonical(canonical)).not.toBe(
      createHmac("sha256", CREDS.refreshKey!).update(canonical, "utf8").digest("hex"),
    );
  });
});

describe("buildCodeMakerHeaders", () => {
  it("includes required header names", () => {
    const headers = buildCodeMakerHeaders(CREDS, {
      method: "POST",
      path: "/openai/v1/chat/completions",
      timestamp: 1,
      nonce: "abc",
    });
    expect(headers["X-Access-Token"]).toBe(CREDS.accessToken);
    expect(headers["X-Auth-User"]).toBe(CREDS.accessUser);
    expect(headers["X-Sig-Version"]).toBe("v1");
    expect(headers["X-Timestamp"]).toBe("1");
    expect(headers["X-Nonce"]).toBe("abc");
    expect(headers["X-Signature"]).toMatch(/^[a-f0-9]{64}$/);
    // Match CodeMaker CLI; missing ide/codemaker-version can rewrite → kimi-k2.5.
    expect(headers["ide"]).toBe("cli");
    expect(headers["codemaker-version"]).toBe("1.18.9-prod-0.3.70-26.8.12");
    expect(headers["User-Agent"]).toBe(
      "opencode/1.18.9-prod-0.3.70-26.8.12",
    );
    expect(headers["mode_type"]).toBe("build");
  });

  it("matches fixed vector for known timestamp/nonce/token", () => {
    const token = "vector-token";
    const timestamp = 1700000000;
    const nonce = "0123456789abcdef";
    const tokenHash = createHash("sha256")
      .update(token, "utf8")
      .digest("hex")
      .slice(0, 16);
    const canonical = `${nonce}.${timestamp}.${tokenHash}`;
    const expectedSig = createHmac("sha256", getSigningKey())
      .update(canonical, "utf8")
      .digest("hex");

    const headers = buildCodeMakerHeaders(
      { accessToken: token, accessUser: "u", refreshKey: "r" },
      {
        method: "GET",
        path: "/openai/v1/models",
        timestamp,
        nonce,
      },
    );
    expect(headers["X-Signature"]).toBe(expectedSig);
  });
});

describe("createCodeMakerFetch", () => {
  it("injects signing headers into outbound requests", async () => {
    const seen: Headers[] = [];
    const baseFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const signedFetch = createCodeMakerFetch(CREDS, baseFetch);
    await signedFetch("https://api-code-maker.nie.netease.com/openai/v1/models", {
      method: "GET",
    });

    expect(baseFetch).toHaveBeenCalledOnce();
    const h = seen[0]!;
    expect(h.get("X-Access-Token")).toBe(CREDS.accessToken);
    expect(h.get("X-Auth-User")).toBe(CREDS.accessUser);
    expect(h.get("X-Sig-Version")).toBe("v1");
    expect(h.get("X-Timestamp")).toMatch(/^\d+$/);
    expect(h.get("X-Nonce")).toMatch(/^[a-f0-9]{16}$/);
    expect(h.get("X-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(h.get("ide")).toBe("cli");
    expect(h.get("codemaker-version")).toBe("1.18.9-prod-0.3.70-26.8.12");
    expect(h.get("User-Agent")).toBe("opencode/1.18.9-prod-0.3.70-26.8.12");
    expect(h.get("mode_type")).toBe("build");
  });
});
