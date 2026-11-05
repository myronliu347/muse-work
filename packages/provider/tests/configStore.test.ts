import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_ACTIVE_MODEL_ID,
  loadProvidersConfig,
  reconcileActiveProvider,
  saveProvidersConfig,
} from "../src/index.js";

describe("configStore", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cfg-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns default config when file missing", () => {
    const cfg = loadProvidersConfig(tmp);
    expect(cfg.activeProviderId).toBe("deepseek");
    expect(cfg.activeModelId).toBe(DEFAULT_ACTIVE_MODEL_ID);
    expect(cfg.activeModelId).toBe("deepseek-flash");
    expect(cfg.providers.deepseek.models[0]?.id).toBe("deepseek-flash");
    expect(Object.keys(cfg.providers).sort()).toEqual([
      "codex",
      "deepseek",
      "openai-compatible",
    ]);
    expect(cfg.providers["openai-compatible"]).toBeDefined();
    expect(cfg.providers.codex.models.map((m) => m.id)).toEqual([
      "gpt-5.4",
      "gpt-5.3-codex",
    ]);
  });

  it("fills a default Codex provider when an older file omits it", () => {
    const configPath = path.join(tmp, ".muse-work", "providers.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const current = loadProvidersConfig(tmp);
    const { codex: _codex, ...providers } = current.providers;
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ...current, providers }, null, 2),
    );
    const loaded = loadProvidersConfig(tmp);
    expect(loaded.providers.codex.models.map((m) => m.id)).toContain("gpt-5.4");
    expect(Object.keys(loaded.providers).sort()).toEqual([
      "codex",
      "deepseek",
      "openai-compatible",
    ]);
  });

  it("round-trips active model selection", () => {
    const cfg = loadProvidersConfig(tmp);
    cfg.activeProviderId = "openai-compatible";
    cfg.activeModelId = "gpt-4.1";
    saveProvidersConfig(cfg, tmp);
    const again = loadProvidersConfig(tmp);
    expect(again.activeProviderId).toBe("openai-compatible");
    expect(again.activeModelId).toBe("gpt-4.1");
  });

  it("keeps an extra provider block and its selection", () => {
    const cfg = loadProvidersConfig(tmp);
    cfg.providers.hosted = {
      enabled: true,
      models: [{ id: "m1", label: "M1" }],
    };
    cfg.activeProviderId = "hosted";
    cfg.activeModelId = "m1";
    saveProvidersConfig(cfg, tmp);
    const again = loadProvidersConfig(tmp);
    expect(again.activeProviderId).toBe("hosted");
    expect(again.activeModelId).toBe("m1");
    expect(again.providers.hosted.models[0]?.id).toBe("m1");
    expect(again.providers.deepseek.models[0]?.id).toBe("deepseek-flash");
  });

  it("falls back to deepseek when the saved provider is not registered", () => {
    const cfg = loadProvidersConfig(tmp);
    cfg.activeProviderId = "missing";
    cfg.activeModelId = "gpt-5.4";
    saveProvidersConfig(cfg, tmp);
    reconcileActiveProvider({ get: (id) => (id === "deepseek" ? {} : undefined) }, tmp);
    const again = loadProvidersConfig(tmp);
    expect(again.activeProviderId).toBe("deepseek");
    expect(again.activeModelId).toBe("deepseek-flash");
  });

  it("keeps the saved provider when it is registered", () => {
    const cfg = loadProvidersConfig(tmp);
    cfg.activeProviderId = "hosted";
    cfg.activeModelId = "m1";
    saveProvidersConfig(cfg, tmp);
    reconcileActiveProvider(
      { get: (id) => (id === "hosted" || id === "deepseek" ? {} : undefined) },
      tmp,
    );
    const again = loadProvidersConfig(tmp);
    expect(again.activeProviderId).toBe("hosted");
    expect(again.activeModelId).toBe("m1");
  });
});
