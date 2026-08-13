import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";
export type UiPrefsFile = {
  version: 1;
  themePreference: ThemePreference;
};

export function getUiPrefsPath(home = os.homedir()): string {
  return path.join(home, ".muse-work", "ui.json");
}

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function loadUiPrefs(home = os.homedir()): UiPrefsFile {
  try {
    const raw = JSON.parse(fs.readFileSync(getUiPrefsPath(home), "utf8")) as {
      themePreference?: unknown;
    };
    if (isPreference(raw.themePreference)) {
      return { version: 1, themePreference: raw.themePreference };
    }
  } catch {
    // missing or corrupt
  }
  return { version: 1, themePreference: "system" };
}

export function saveUiPrefs(prefs: UiPrefsFile, home = os.homedir()): void {
  const file = getUiPrefsPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(prefs, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  shouldUseDarkColors: boolean,
): EffectiveTheme {
  if (preference === "light" || preference === "dark") return preference;
  return shouldUseDarkColors ? "dark" : "light";
}

export function windowBackgroundFor(effective: EffectiveTheme): string {
  return effective === "light" ? "#fcfcfc" : "#111111";
}
