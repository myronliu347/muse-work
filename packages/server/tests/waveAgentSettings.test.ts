import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getWaveUserSettingsPath,
  readWaveUserSettingsText,
  WaveSettingsJsonError,
  writeWaveUserSettingsText,
} from "../src/services/waveAgentSettings.js";

describe("waveAgentSettings", () => {
  let home: string | undefined;

  afterEach(() => {
    if (home) {
      fs.rmSync(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it("returns empty object text when the file is missing", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "wave-settings-"));
    const result = readWaveUserSettingsText(home);
    expect(result.path).toBe(getWaveUserSettingsPath(home));
    expect(JSON.parse(result.content)).toEqual({});
  });

  it("writes valid JSON and re-reads it", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "wave-settings-"));
    const written = writeWaveUserSettingsText(
      '{"env":{"WAVE_VISION_MODEL":"kimi-k3"}}',
      home,
    );
    expect(fs.existsSync(written.path)).toBe(true);
    expect(JSON.parse(written.content)).toEqual({
      env: { WAVE_VISION_MODEL: "kimi-k3" },
    });
    expect(JSON.parse(readWaveUserSettingsText(home).content)).toEqual({
      env: { WAVE_VISION_MODEL: "kimi-k3" },
    });
  });

  it("rejects invalid JSON and non-object roots", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "wave-settings-"));
    expect(() => writeWaveUserSettingsText("{", home)).toThrow(
      WaveSettingsJsonError,
    );
    expect(() => writeWaveUserSettingsText("[1]", home)).toThrow(
      WaveSettingsJsonError,
    );
    expect(fs.existsSync(getWaveUserSettingsPath(home))).toBe(false);
  });
});
