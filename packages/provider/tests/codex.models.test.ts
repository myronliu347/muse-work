import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODEX_API_BASE_URL, createCodexProvider } from "../src/codex/provider.js";
import {
  CODEX_MODELS_CLIENT_VERSION,
  createCodexModelsLoader,
  parseCodexModels,
} from "../src/codex/models.js";
import type { CodexCreds } from "../src/codex/credentials.js";

const creds: CodexCreds = {
  idToken: "id",
  accessToken: "access-tok",
  refreshToken: "refresh-tok",
  accountId: "acct_1",
  email: "ada@example.com",
  issuer: "https://auth.openai.com",
  clientId: "client",
  loginOwnerId: "login-1",
  lastRefresh: new Date().toISOString(),
};

const catalog = {
  models: [
    {
      slug: "gpt-hidden",
      display_name: "Hidden",
      visibility: "hide",
      priority: 100,
      input_modalities: ["text"],
      supported_reasoning_levels: [],
    },
    {
      slug: "gpt-5.4",
      display_name: "GPT-5.4",
      visibility: "list",
      priority: 10,
      input_modalities: ["text", "image"],
      supported_reasoning_levels: [{ effort: "medium", description: "Medium" }],
    },
    {
      slug: "gpt-5.4-mini",
      display_name: "GPT-5.4 Mini",
      visibility: "list",
      priority: 1,
      input_modalities: ["text"],
      supported_reasoning_levels: [],
    },
  ],
};

describe("parseCodexModels", () => {
  it("keeps picker models and maps vision and thinking", () => {
    expect(parseCodexModels(catalog)).toEqual([
      {
        id: "gpt-5.4",
        label: "GPT-5.4",
        capabilities: { vision: true, thinking: true },
      },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    ]);
  });
});

describe("createCodexModelsLoader", () => {
  it("requests /models with the ChatGPT session", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-codex-models-"));
    let seen = "";
    const headers = new Headers();
    const loader = createCodexModelsLoader({
      home,
      getCredentials: async () => creds,
      fetch: async (input, init) => {
        seen = String(input);
        const raw = new Headers(init?.headers);
        raw.forEach((value, key) => headers.set(key, value));
        return new Response(JSON.stringify(catalog), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    await expect(loader.list()).resolves.toEqual(parseCodexModels(catalog));
    const url = new URL(seen);
    expect(url.origin + url.pathname).toBe(`${CODEX_API_BASE_URL}/models`);
    expect(url.searchParams.get("client_version")).toBe(
      CODEX_MODELS_CLIENT_VERSION,
    );
    expect(headers.get("authorization")).toBe("Bearer access-tok");
    expect(headers.get("chatgpt-account-id")).toBe("acct_1");
  });

  it("returns null when the catalog request fails", async () => {
    const loader = createCodexModelsLoader({
      getCredentials: async () => creds,
      fetch: async () => new Response("nope", { status: 503 }),
    });
    await expect(loader.list()).resolves.toBeNull();
  });
});

describe("createCodexProvider listModels", () => {
  const fallback = [{ id: "gpt-5.4", label: "GPT-5.4" }];

  it("uses the remote catalog when the session can load it", async () => {
    const provider = createCodexProvider({
      getConfig: () => ({ enabled: true, models: fallback }),
      loadCredentials: () => creds,
      fetch: async (input) => {
        if (String(input).includes("/models")) {
          return new Response(JSON.stringify(catalog), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${String(input)}`);
      },
    });
    expect(await provider.listModels()).toEqual(parseCodexModels(catalog));
  });

  it("falls back to the bundled list when the catalog is unavailable", async () => {
    const provider = createCodexProvider({
      getConfig: () => ({ enabled: true, models: fallback }),
      loadCredentials: () => null,
      fetch: async () => {
        throw new Error("should not fetch without credentials");
      },
    });
    expect(await provider.listModels()).toEqual(fallback);
  });
});
