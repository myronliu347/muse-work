import { describe, it, expect } from "vitest";
import {
  CODEMAKER_BASE_URL,
  createCodeMakerProvider,
} from "../src/codemaker/provider.js";
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

describe("createCodeMakerProvider", () => {
  it("has codemaker id and lists models from config", async () => {
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => validCreds,
    });
    expect(p.id).toBe("codemaker");
    expect((await p.listModels()).map((m) => m.id)).toEqual([
      "deepseek-v4-pro",
      "claude-sonnet-4-6",
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

    const expired = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => ({
        ...validCreds,
        expire: Date.now() - 1,
      }),
    });
    expect((await expired.getAuthStatus()).state).toBe("expired");
  });

  it("login stubs throw until Task 6", async () => {
    const p = createCodeMakerProvider({
      getConfig: () => ({ enabled: true, models }),
      loadCredentials: () => null,
    });
    await expect(p.beginLogin()).rejects.toThrow(/Task 6|not implemented/i);
    await expect(p.completeLogin({})).rejects.toThrow(/Task 6|not implemented/i);
  });
});
