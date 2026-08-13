import type { EffectiveTheme, ThemePreference } from "../types";

export const THEME_PREFERENCE_STORAGE_KEY = "muse.themePreference";

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
