import type {
  EffectiveTheme,
  ThemeAccentColor,
  ThemeGrayColor,
  ThemePreference,
  ThemeRadius,
  ThemeScaling,
} from "../types";
import {
  DEFAULT_THEME_ACCENT_COLOR,
  DEFAULT_THEME_GRAY_COLOR,
  DEFAULT_THEME_RADIUS,
  DEFAULT_THEME_SCALING,
  isThemeAccentColor,
  isThemeGrayColor,
  isThemeRadius,
  THEME_SCALINGS,
} from "./themeOptions";

export const THEME_PREFERENCE_STORAGE_KEY = "muse.themePreference";
export const THEME_SCALING_STORAGE_KEY = "muse.themeScaling";
export const THEME_ACCENT_COLOR_STORAGE_KEY = "muse.themeAccentColor";
export const THEME_RADIUS_STORAGE_KEY = "muse.themeRadius";
export const THEME_GRAY_COLOR_STORAGE_KEY = "muse.themeGrayColor";
export {
  DEFAULT_THEME_SCALING,
  DEFAULT_THEME_ACCENT_COLOR,
  DEFAULT_THEME_RADIUS,
  DEFAULT_THEME_GRAY_COLOR,
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  isSystemDark: boolean,
): EffectiveTheme {
  if (preference === "light" || preference === "dark") return preference;
  return isSystemDark ? "dark" : "light";
}

export function readStoredPreference(): ThemePreference {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_PREFERENCE_STORAGE_KEY);
    if (isThemePreference(raw)) return raw;
  } catch {
    // privacy mode
  }
  return "system";
}

export function writeStoredPreference(preference: ThemePreference): void {
  try {
    globalThis.localStorage?.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // privacy mode: session-only
  }
}

export function isThemeScaling(value: unknown): value is ThemeScaling {
  return (
    typeof value === "string" &&
    (THEME_SCALINGS as readonly string[]).includes(value)
  );
}

export function readStoredScaling(): ThemeScaling {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_SCALING_STORAGE_KEY);
    if (isThemeScaling(raw)) return raw;
  } catch {
    // privacy mode
  }
  return DEFAULT_THEME_SCALING;
}

export function writeStoredScaling(scaling: ThemeScaling): void {
  try {
    globalThis.localStorage?.setItem(THEME_SCALING_STORAGE_KEY, scaling);
  } catch {
    // privacy mode: session-only
  }
}

export function readStoredAccentColor(): ThemeAccentColor {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_ACCENT_COLOR_STORAGE_KEY);
    if (isThemeAccentColor(raw)) return raw;
  } catch {
    // privacy mode
  }
  return DEFAULT_THEME_ACCENT_COLOR;
}

export function writeStoredAccentColor(accentColor: ThemeAccentColor): void {
  try {
    globalThis.localStorage?.setItem(
      THEME_ACCENT_COLOR_STORAGE_KEY,
      accentColor,
    );
  } catch {
    // privacy mode: session-only
  }
}

export function readStoredRadius(): ThemeRadius {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_RADIUS_STORAGE_KEY);
    if (isThemeRadius(raw)) return raw;
  } catch {
    // privacy mode
  }
  return DEFAULT_THEME_RADIUS;
}

export function writeStoredRadius(radius: ThemeRadius): void {
  try {
    globalThis.localStorage?.setItem(THEME_RADIUS_STORAGE_KEY, radius);
  } catch {
    // privacy mode: session-only
  }
}

export function readStoredGrayColor(): ThemeGrayColor {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_GRAY_COLOR_STORAGE_KEY);
    if (isThemeGrayColor(raw)) return raw;
  } catch {
    // privacy mode
  }
  return DEFAULT_THEME_GRAY_COLOR;
}

export function writeStoredGrayColor(grayColor: ThemeGrayColor): void {
  try {
    globalThis.localStorage?.setItem(THEME_GRAY_COLOR_STORAGE_KEY, grayColor);
  } catch {
    // privacy mode: session-only
  }
}
