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
    fs.mkdirSync(path.dirname(getUiPrefsPath(home)), { recursive: true });
    fs.writeFileSync(getUiPrefsPath(home), "{not json", "utf8");
    expect(loadUiPrefs(home).themePreference).toBe("system");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("round-trips a preference and maps window background", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ui-"));
    saveUiPrefs({ version: 1, themePreference: "light" }, home);
    expect(loadUiPrefs(home).themePreference).toBe("light");
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(windowBackgroundFor("light")).toBe("#fcfcfc");
    expect(windowBackgroundFor("dark")).toBe("#111111");
    fs.rmSync(home, { recursive: true, force: true });
  });
});
