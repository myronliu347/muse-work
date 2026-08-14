import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getUiPrefsPath,
  loadUiPrefs,
  resolveEffectiveTheme,
  saveUiPrefs,
  windowBackgroundFor,
} from "../src/main/uiPrefs.js";

describe("uiPrefs", () => {
  it("defaults to system when the file is missing or corrupt", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ui-"));
    expect(loadUiPrefs(home).themePreference).toBe("system");
    expect(loadUiPrefs(home).themeScaling).toBe("100%");
    expect(loadUiPrefs(home).themeAccentColor).toBe("red");
    expect(loadUiPrefs(home).themeRadius).toBe("large");
    expect(loadUiPrefs(home).themeGrayColor).toBe("gray");
    fs.mkdirSync(path.dirname(getUiPrefsPath(home)), { recursive: true });
    fs.writeFileSync(getUiPrefsPath(home), "{not json", "utf8");
    expect(loadUiPrefs(home).themeGrayColor).toBe("gray");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("round-trips theme prefs and maps window background", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ui-"));
    saveUiPrefs(
      {
        version: 1,
        themePreference: "light",
        themeScaling: "105%",
        themeAccentColor: "blue",
        themeRadius: "small",
        themeGrayColor: "slate",
      },
      home,
    );
    const loaded = loadUiPrefs(home);
    expect(loaded.themePreference).toBe("light");
    expect(loaded.themeScaling).toBe("105%");
    expect(loaded.themeAccentColor).toBe("blue");
    expect(loaded.themeRadius).toBe("small");
    expect(loaded.themeGrayColor).toBe("slate");
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(windowBackgroundFor("light")).toBe("#fcfcfc");
    expect(windowBackgroundFor("dark")).toBe("#111111");
    fs.rmSync(home, { recursive: true, force: true });
  });
});
