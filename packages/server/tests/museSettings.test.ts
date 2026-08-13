import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getSettingsPath,
  loadMuseSettings,
  patchMuseSettings,
  resolveSuperpowersPluginDir,
  saveMuseSettings,
  superpowersPluginDirIfPresent,
} from "../src/museSettings.js";

describe("museSettings", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("defaults superpowers on when the file is missing", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-settings-"));
    homes.push(home);
    expect(loadMuseSettings(home)).toEqual({
      version: 1,
      plugins: { superpowers: true },
    });
    expect(fs.existsSync(getSettingsPath(home))).toBe(false);
  });

  it("defaults superpowers on when JSON is corrupt", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-settings-"));
    homes.push(home);
    const file = getSettingsPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not-json");
    expect(loadMuseSettings(home).plugins.superpowers).toBe(true);
  });

  it("honors explicit false and round-trips via patch", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-settings-"));
    homes.push(home);
    saveMuseSettings(
      { version: 1, plugins: { superpowers: false } },
      home,
    );
    expect(loadMuseSettings(home).plugins.superpowers).toBe(false);
    const next = patchMuseSettings(
      { plugins: { superpowers: true } },
      home,
    );
    expect(next.plugins.superpowers).toBe(true);
    expect(loadMuseSettings(home).plugins.superpowers).toBe(true);
  });

  it("resolves plugin dir next to src/dist", () => {
    const dir = resolveSuperpowersPluginDir();
    expect(dir.endsWith(`${path.sep}plugins${path.sep}superpowers`)).toBe(
      true,
    );
    const present = superpowersPluginDirIfPresent();
    if (fs.existsSync(path.join(dir, ".wave-plugin", "plugin.json"))) {
      expect(present).toBe(dir);
    } else {
      expect(present).toBeUndefined();
    }
  });
});
