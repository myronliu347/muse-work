import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_MUSE_USER_SETTINGS,
  ensureDefaultMuseUserSettings,
  getMuseUserSettingsPath,
  readMuseUserSettingsText,
  MuseSettingsJsonError,
  writeMuseUserSettingsText,
} from "../src/services/museAgentSettings.js";

describe("museAgentSettings", () => {
  let home: string | undefined;

  afterEach(() => {
    if (home) {
      fs.rmSync(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it("returns empty object text when the file is missing", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "wave-settings-"));
    const result = readMuseUserSettingsText(home);
    expect(result.path).toBe(getMuseUserSettingsPath(home));
    expect(JSON.parse(result.content)).toEqual({});
  });

  it("ensureDefaultMuseUserSettings writes defaults only when missing", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "wave-settings-"));
    ensureDefaultMuseUserSettings(home);
    const file = getMuseUserSettingsPath(home);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(
      DEFAULT_MUSE_USER_SETTINGS,
    );
    fs.writeFileSync(file, '{"env":{"CUSTOM":"1"}}\n');
    ensureDefaultMuseUserSettings(home);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      env: { CUSTOM: "1" },
    });
  });

  it("writes valid JSON and re-reads it", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "wave-settings-"));
    const written = writeMuseUserSettingsText(
      '{"env":{"MUSE_VISION_MODEL":"kimi-k3"}}',
      home,
    );
    expect(fs.existsSync(written.path)).toBe(true);
    expect(JSON.parse(written.content)).toEqual({
      env: { MUSE_VISION_MODEL: "kimi-k3" },
    });
    expect(JSON.parse(readMuseUserSettingsText(home).content)).toEqual({
      env: { MUSE_VISION_MODEL: "kimi-k3" },
    });
  });

  it("rejects invalid JSON and non-object roots", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "wave-settings-"));
    expect(() => writeMuseUserSettingsText("{", home)).toThrow(
      MuseSettingsJsonError,
    );
    expect(() => writeMuseUserSettingsText("[1]", home)).toThrow(
      MuseSettingsJsonError,
    );
    expect(fs.existsSync(getMuseUserSettingsPath(home))).toBe(false);
  });
});
