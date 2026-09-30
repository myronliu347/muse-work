import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";
export type ThemeScaling = "90%" | "95%" | "100%" | "105%" | "110%";
export type ThemeAccentColor =
  | "gray"
  | "gold"
  | "bronze"
  | "brown"
  | "yellow"
  | "amber"
  | "orange"
  | "tomato"
  | "red"
  | "ruby"
  | "crimson"
  | "pink"
  | "plum"
  | "purple"
  | "violet"
  | "iris"
  | "indigo"
  | "blue"
  | "cyan"
  | "teal"
  | "jade"
  | "green"
  | "grass"
  | "lime"
  | "mint"
  | "sky";
export type ThemeRadius = "none" | "small" | "medium" | "large" | "full";
export type ThemeGrayColor =
  | "auto"
  | "gray"
  | "mauve"
  | "slate"
  | "sage"
  | "olive"
  | "sand";

export const DEFAULT_THEME_SCALING: ThemeScaling = "100%";
export const DEFAULT_THEME_ACCENT_COLOR: ThemeAccentColor = "indigo";
export const DEFAULT_THEME_RADIUS: ThemeRadius = "large";
export const DEFAULT_THEME_GRAY_COLOR: ThemeGrayColor = "gray";

export type UiPrefsFile = {
  version: 1;
  themePreference: ThemePreference;
  themeScaling: ThemeScaling;
  themeAccentColor: ThemeAccentColor;
  themeRadius: ThemeRadius;
  themeGrayColor: ThemeGrayColor;
};

export function getUiPrefsPath(home = os.homedir()): string {
  // Mirrors getMuseHomeDir (MUSE_HOME_DIR) so dev instances keep UI prefs out
  // of production's ~/.muse-work without a provider dependency here.
  const dirName = process.env.MUSE_HOME_DIR ?? ".muse-work";
  return path.join(home, dirName, "ui.json");
}

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isScaling(value: unknown): value is ThemeScaling {
  return (
    value === "90%" ||
    value === "95%" ||
    value === "100%" ||
    value === "105%" ||
    value === "110%"
  );
}

function isAccentColor(value: unknown): value is ThemeAccentColor {
  const colors: ThemeAccentColor[] = [
    "gray",
    "gold",
    "bronze",
    "brown",
    "yellow",
    "amber",
    "orange",
    "tomato",
    "red",
    "ruby",
    "crimson",
    "pink",
    "plum",
    "purple",
    "violet",
    "iris",
    "indigo",
    "blue",
    "cyan",
    "teal",
    "jade",
    "green",
    "grass",
    "lime",
    "mint",
    "sky",
  ];
  return typeof value === "string" && colors.includes(value as ThemeAccentColor);
}

function isRadius(value: unknown): value is ThemeRadius {
  return (
    value === "none" ||
    value === "small" ||
    value === "medium" ||
    value === "large" ||
    value === "full"
  );
}

function isGrayColor(value: unknown): value is ThemeGrayColor {
  return (
    value === "auto" ||
    value === "gray" ||
    value === "mauve" ||
    value === "slate" ||
    value === "sage" ||
    value === "olive" ||
    value === "sand"
  );
}

export function loadUiPrefs(home = os.homedir()): UiPrefsFile {
  try {
    const raw = JSON.parse(fs.readFileSync(getUiPrefsPath(home), "utf8")) as {
      themePreference?: unknown;
      themeScaling?: unknown;
      themeAccentColor?: unknown;
      themeRadius?: unknown;
      themeGrayColor?: unknown;
    };
    return {
      version: 1,
      themePreference: isPreference(raw.themePreference)
        ? raw.themePreference
        : "system",
      themeScaling: isScaling(raw.themeScaling)
        ? raw.themeScaling
        : DEFAULT_THEME_SCALING,
      themeAccentColor: isAccentColor(raw.themeAccentColor)
        ? raw.themeAccentColor
        : DEFAULT_THEME_ACCENT_COLOR,
      themeRadius: isRadius(raw.themeRadius)
        ? raw.themeRadius
        : DEFAULT_THEME_RADIUS,
      themeGrayColor: isGrayColor(raw.themeGrayColor)
        ? raw.themeGrayColor
        : DEFAULT_THEME_GRAY_COLOR,
    };
  } catch {
    // missing or corrupt
  }
  return {
    version: 1,
    themePreference: "system",
    themeScaling: DEFAULT_THEME_SCALING,
    themeAccentColor: DEFAULT_THEME_ACCENT_COLOR,
    themeRadius: DEFAULT_THEME_RADIUS,
    themeGrayColor: DEFAULT_THEME_GRAY_COLOR,
  };
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
