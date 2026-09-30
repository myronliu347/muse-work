import type { ThemePreference, ThemeAccentColor, ThemeGrayColor, ThemeRadius, ThemeScaling } from "../types";
import { isDarkTheme } from "../utils/theme";
import {
  isThemePreference,
  isThemeScaling,
  readStoredPreference,
  readStoredScaling,
  readStoredAccentColor,
  readStoredRadius,
  readStoredGrayColor,
  writeStoredPreference,
  writeStoredScaling,
  writeStoredAccentColor,
  writeStoredRadius,
  writeStoredGrayColor,
} from "./themeStorage";
import { isThemeAccentColor, isThemeGrayColor, isThemeRadius } from "./themeOptions";

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
  postDesktopThemeMessage({
    command: "desktopSetThemePreference",
    preference,
  });
  listeners.forEach((fn) => fn());
}

export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const scalingListeners = new Set<() => void>();
let currentScaling: ThemeScaling = "100%";
let scalingInitialized = false;

export function readInitialScaling(): ThemeScaling {
  const injected = (globalThis as { __MUSE_THEME_SCALING__?: unknown })
    .__MUSE_THEME_SCALING__;
  if (isThemeScaling(injected)) return injected;
  return readStoredScaling();
}

export function getThemeScaling(): ThemeScaling {
  if (!scalingInitialized) {
    currentScaling = readInitialScaling();
    scalingInitialized = true;
  }
  return currentScaling;
}

export function setThemeScaling(scaling: ThemeScaling): void {
  currentScaling = scaling;
  scalingInitialized = true;
  writeStoredScaling(scaling);
  postDesktopThemeMessage({ command: "desktopSetThemeScaling", scaling });
  scalingListeners.forEach((fn) => fn());
}

export function subscribeThemeScaling(listener: () => void): () => void {
  scalingListeners.add(listener);
  return () => {
    scalingListeners.delete(listener);
  };
}

const accentColorListeners = new Set<() => void>();
let currentAccentColor: ThemeAccentColor = "indigo";
let accentColorInitialized = false;

export function readInitialAccentColor(): ThemeAccentColor {
  const injected = (globalThis as { __MUSE_THEME_ACCENT__?: unknown })
    .__MUSE_THEME_ACCENT__;
  if (isThemeAccentColor(injected)) return injected;
  return readStoredAccentColor();
}

export function getThemeAccentColor(): ThemeAccentColor {
  if (!accentColorInitialized) {
    currentAccentColor = readInitialAccentColor();
    accentColorInitialized = true;
  }
  return currentAccentColor;
}

export function setThemeAccentColor(accentColor: ThemeAccentColor): void {
  currentAccentColor = accentColor;
  accentColorInitialized = true;
  writeStoredAccentColor(accentColor);
  postDesktopThemeMessage({ command: "desktopSetThemeAccentColor", accentColor });
  accentColorListeners.forEach((fn) => fn());
}

export function subscribeThemeAccentColor(listener: () => void): () => void {
  accentColorListeners.add(listener);
  return () => {
    accentColorListeners.delete(listener);
  };
}

const radiusListeners = new Set<() => void>();
let currentRadius: ThemeRadius = "large";
let radiusInitialized = false;

export function readInitialRadius(): ThemeRadius {
  const injected = (globalThis as { __MUSE_THEME_RADIUS__?: unknown })
    .__MUSE_THEME_RADIUS__;
  if (isThemeRadius(injected)) return injected;
  return readStoredRadius();
}

export function getThemeRadius(): ThemeRadius {
  if (!radiusInitialized) {
    currentRadius = readInitialRadius();
    radiusInitialized = true;
  }
  return currentRadius;
}

export function setThemeRadius(radius: ThemeRadius): void {
  currentRadius = radius;
  radiusInitialized = true;
  writeStoredRadius(radius);
  postDesktopThemeMessage({ command: "desktopSetThemeRadius", radius });
  radiusListeners.forEach((fn) => fn());
}

export function subscribeThemeRadius(listener: () => void): () => void {
  radiusListeners.add(listener);
  return () => {
    radiusListeners.delete(listener);
  };
}

const grayColorListeners = new Set<() => void>();
let currentGrayColor: ThemeGrayColor = "gray";
let grayColorInitialized = false;

export function readInitialGrayColor(): ThemeGrayColor {
  const injected = (globalThis as { __MUSE_THEME_GRAY__?: unknown })
    .__MUSE_THEME_GRAY__;
  if (isThemeGrayColor(injected)) return injected;
  return readStoredGrayColor();
}

export function getThemeGrayColor(): ThemeGrayColor {
  if (!grayColorInitialized) {
    currentGrayColor = readInitialGrayColor();
    grayColorInitialized = true;
  }
  return currentGrayColor;
}

export function setThemeGrayColor(grayColor: ThemeGrayColor): void {
  currentGrayColor = grayColor;
  grayColorInitialized = true;
  writeStoredGrayColor(grayColor);
  postDesktopThemeMessage({ command: "desktopSetThemeGrayColor", grayColor });
  grayColorListeners.forEach((fn) => fn());
}

export function subscribeThemeGrayColor(listener: () => void): () => void {
  grayColorListeners.add(listener);
  return () => {
    grayColorListeners.delete(listener);
  };
}

function postDesktopThemeMessage(message: Record<string, string>): void {
  if (
    typeof window !== "undefined" &&
    typeof window.acquireVsCodeApi === "function"
  ) {
    window.acquireVsCodeApi().postMessage(message);
  }
}
