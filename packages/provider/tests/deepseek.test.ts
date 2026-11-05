import { afterEach, describe, expect, it } from "vitest";
import {
  createDeepSeekProvider,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL_ID,
  loadDeepSeekEnv,
  loadProvidersConfig,
  saveDeepSeekApiKey,
  saveProvidersConfig,
} from "../src/index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("deepseek provider", () => {
  const savedKey = process.env.DEEPSEEK_API_KEY;
  let tmp: string;

  afterEach(() => {
    if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = savedKey;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("lists remote models by id and name", async () => {
    const seen: string[] = [];
    const provider = createDeepSeekProvider({
      getConfig: () => ({ enabled: true, models: [], apiKey: "test-key" }),
      fetch: async (input) => {
        seen.push(String(input));
        return jsonResponse({
          data: [
            { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash" },
            { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
          ],
        });
      },
    });
    const models = await provider.listModels();
    expect(seen).toEqual([`${DEEPSEEK_BASE_URL}/models`]);
    expect(models).toEqual([
      { id: "deepseek-flash", label: "DeepSeek-V4.1-Flash" },
      { id: "deepseek-v4-pro", label: "DeepSeek-V4-Pro" },
    ]);
  });

  it("falls back to deepseek-flash when the catalog fails", async () => {
    const provider = createDeepSeekProvider({
      getConfig: () => ({ enabled: true, models: [], apiKey: "test-key" }),
      fetch: async () => jsonResponse({ error: "nope" }, 500),
    });
    expect(await provider.listModels()).toEqual([
      { id: DEEPSEEK_DEFAULT_MODEL_ID, label: "DeepSeek Flash" },
    ]);
  });

  it("does not call the network when no key is configured", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    let called = false;
    const provider = createDeepSeekProvider({
      getConfig: () => ({ enabled: true, models: [] }),
      fetch: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    expect((await provider.getAuthStatus()).state).toBe("needs_config");
    expect(await provider.listModels()).toEqual([
      { id: DEEPSEEK_DEFAULT_MODEL_ID, label: "DeepSeek Flash" },
    ]);
    expect(called).toBe(false);
    await expect(provider.getQuota?.()).rejects.toThrow(/密钥/);
  });

  it("maps user balance and reads the key from the environment", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "env-key";
    const headers: string[] = [];
    const provider = createDeepSeekProvider({
      getConfig: () => ({ enabled: true, models: [] }),
      fetch: async (_input, init) => {
        headers.push(
          String((init?.headers as Record<string, string>).Authorization),
        );
        return jsonResponse({
          is_available: true,
          balance_infos: [
            {
              currency: "CNY",
              total_balance: "100.00",
              granted_balance: "100.00",
              topped_up_balance: "0.00",
            },
          ],
        });
      },
    });
    expect(await provider.getQuota?.()).toEqual({
      is_available: true,
      balance_infos: [
        {
          currency: "CNY",
          total_balance: "100.00",
          granted_balance: "100.00",
          topped_up_balance: "0.00",
        },
      ],
    });
    expect(headers).toEqual(["Bearer env-key"]);
    expect(provider.revokeOnUnauthorized).toBeUndefined();
  });

  it("logout leaves the stored key in place", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ds-"));
    const cfg = loadProvidersConfig(tmp);
    cfg.providers.deepseek.apiKey = "stored-key";
    saveProvidersConfig(cfg, tmp);
    const provider = createDeepSeekProvider({
      getConfig: () => loadProvidersConfig(tmp).providers.deepseek,
    });
    await provider.logout();
    expect(loadProvidersConfig(tmp).providers.deepseek.apiKey).toBe("stored-key");
    const gateway = await provider.resolveGateway("deepseek-flash");
    expect(gateway.baseURL).toBe(DEEPSEEK_BASE_URL);
    expect(gateway.apiKey).toBe("stored-key");
  });

  it("writes the API key into DEEPSEEK_API_KEY and reloads it", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ds-"));
    delete process.env.DEEPSEEK_API_KEY;
    saveDeepSeekApiKey("test-key", tmp);
    expect(process.env.DEEPSEEK_API_KEY).toBe("test-key");
    delete process.env.DEEPSEEK_API_KEY;
    loadDeepSeekEnv(tmp);
    expect(process.env.DEEPSEEK_API_KEY).toBe("test-key");
  });
});
