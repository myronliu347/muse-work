import type { ThemePreference } from "../types";
import { isDarkTheme } from "../utils/theme";
import {
  isThemePreference,
  readStoredPreference,
  writeStoredPreference,
} from "./themeStorage";

const listeners = new Set<() => void>();
const systemDarkListeners = new Set<() => void>();
let current: ThemePreference = "system";
let initialized = false;
let systemDark = false;
let systemDarkInitialized = false;
let systemDarkTrackingStarted = false;

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
  if (typeof window !== "undefined" && window.waveHostType !== "desktop") {
    return isDarkTheme();
  }
  return Boolean(
    globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
}

function updateSystemDark(next: boolean): void {
  systemDarkInitialized = true;
  if (systemDark === next) return;
  systemDark = next;
  systemDarkListeners.forEach((listener) => listener());
}

function refreshSystemDark(): void {
  updateSystemDark(detectSystemDark());
}

function startSystemDarkTracking(): void {
  if (
    systemDarkTrackingStarted ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }
  systemDarkTrackingStarted = true;

  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", refreshSystemDark);

  const observer = new MutationObserver((mutations) => {
    if (
      window.waveHostType === "desktop" &&
      mutations.some((mutation) => mutation.target === document.documentElement)
    ) {
      return;
    }
    refreshSystemDark();
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { command?: string; effective?: string };
    if (
      data?.command === "desktopThemeChange" &&
      getThemePreference() === "system" &&
      (data.effective === "light" || data.effective === "dark")
    ) {
      updateSystemDark(data.effective === "dark");
    }
  });
}

export function getSystemDark(): boolean {
  if (!systemDarkInitialized) {
    systemDark = detectSystemDark();
    systemDarkInitialized = true;
  }
  return systemDark;
}

export function subscribeSystemDark(listener: () => void): () => void {
  systemDarkListeners.add(listener);
  startSystemDarkTracking();
  return () => {
    systemDarkListeners.delete(listener);
  };
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
