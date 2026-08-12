import { describe, expect, it, vi, afterEach } from "vitest";
import {
  CODEMAKER_API_BASE_URL,
  CODEMAKER_RENEW_TOKEN_PATH,
  renewCodeMakerCredentials,
} from "../src/index.js";
import type { CodeMakerCreds } from "../src/codemaker/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renewCodeMakerCredentials", () => {
  it("POSTs /renew_token with refresh_key + user and rewrites creds", async () => {
    const saved: CodeMakerCreds[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        `${CODEMAKER_API_BASE_URL}${CODEMAKER_RENEW_TOKEN_PATH}`,
      );
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        key: "rk",
        user: "bob",
      });
      return new Response(
        JSON.stringify({
          token: "fresh-token",
          user: "bob",
          expire: 1_700_000_000,
          ttl: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const next = await renewCodeMakerCredentials({
      creds: {
        accessToken: "old",
        accessUser: "bob",
        refreshKey: "rk",
        expire: Date.now() - 1,
      },
      fetch: fetchMock as unknown as typeof fetch,
      save: (c) => {
        saved.push(c);
      },
    });

    expect(next.accessToken).toBe("fresh-token");
    expect(next.refreshKey).toBe("rk");
    expect(next.expire).toBe(1_700_000_000_000);
    expect(saved).toEqual([next]);
  });

  it("throws when refresh_key is missing", async () => {
    await expect(
      renewCodeMakerCredentials({
        creds: { accessToken: "t", accessUser: "u" },
      }),
    ).rejects.toThrow(/refresh_key/i);
  });
});
