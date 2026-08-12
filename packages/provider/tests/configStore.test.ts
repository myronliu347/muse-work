import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadProvidersConfig,
  saveProvidersConfig,
} from "../src/configStore.js";

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
    expect(cfg.activeProviderId).toBe("codemaker");
    expect(cfg.providers.codemaker.models.length).toBeGreaterThan(0);
    expect(cfg.providers["openai-compatible"]).toBeDefined();
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
});
