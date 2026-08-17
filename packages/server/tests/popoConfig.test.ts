import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getPopoConfigPath,
  loadPopoConfig,
  savePopoConfig,
} from "../src/popo/popoConfig.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "popo-config-"));
}

describe("popoConfig", () => {
  it("loads config values and backfills missing optional fields", () => {
    const home = tempHome();
    savePopoConfig(
      {
        appId: "id",
        appKey: "key",
        appSecret: "secret",
        token: "tk",
        aesKey: "ak",
        masterUid: "me@corp.netease.com",
      },
      home,
    );
    const cfg = loadPopoConfig(home);
    expect(cfg).toEqual({
      appId: "id",
      appKey: "key",
      appSecret: "secret",
      token: "tk",
      aesKey: "ak",
      masterUid: "me@corp.netease.com",
    });
  });

  it("defaults missing token/aesKey/masterUid to empty strings", () => {
    const home = tempHome();
    fs.writeFileSync(
      getPopoConfigPath(home),
      JSON.stringify({ appId: "id", appKey: "key", appSecret: "secret" }),
      "utf8",
    );
    const cfg = loadPopoConfig(home);
    expect(cfg.token).toBe("");
    expect(cfg.aesKey).toBe("");
    expect(cfg.masterUid).toBe("");
  });

  it("throws when appId/appKey/appSecret missing", () => {
    const home = tempHome();
    fs.writeFileSync(getPopoConfigPath(home), JSON.stringify({}), "utf8");
    expect(() => loadPopoConfig(home)).toThrow(/POPO 配置不完整/);
  });

  it("throws when file missing", () => {
    expect(() => loadPopoConfig(tempHome())).toThrow(/读取 POPO 配置失败/);
  });
});
