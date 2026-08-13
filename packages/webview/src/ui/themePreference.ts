import type { ThemePreference } from "../types";
import { isDarkTheme } from "../utils/theme";
import {
  isThemePreference,
  readStoredPreference,
  writeStoredPreference,
} from "./themeStorage";

const listeners = new Set<() => void>();
let current: ThemePreference = "system";
let initialized = false;

export function detectSystemDark(): boolean {
  if (typeof document !== "undefined") {
    const body = document.body?.classList;
    if (
      body?.contains("vscode-dark") ||
      body?.contains("vscode-high-contrast") ||
      body?.contains("vscode-light") ||
      body?.contains("vscode-high-contrast-light")
    ) {
      return isDarkTheme();
    }
  }
  return Boolean(
    globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
}

export function readInitialPreference(): ThemePreference {
  const injected = (globalThis as { __MUSE_THEME_PREFERENCE__?: unknown })
    .__MUSE_THEME_PREFERENCE__;
  if (isThemePreference(injected)) return injected;
  return readStoredPreference();
}

export function getThemePreference(): ThemePreference {
  if (!initialized) {
    current = readInitialPreference();
    initialized = true;
  }
  return current;
}

export function setThemePreference(preference: ThemePreference): void {
  current = preference;
  initialized = true;
  writeStoredPreference(preference);
  if (
    typeof window !== "undefined" &&
    window.waveHostType === "desktop" &&
    typeof window.acquireVsCodeApi === "function"
  ) {
    window.acquireVsCodeApi().postMessage({
      command: "desktopSetThemePreference",
      preference,
    });
  }
  listeners.forEach((fn) => fn());
}

export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
