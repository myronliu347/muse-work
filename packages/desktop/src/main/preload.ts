import { contextBridge, ipcRenderer } from "electron";
import { loadUiPrefs } from "./uiPrefs.js";

/**
 * Minimal preload: expose Muse server base URL + desktop host marker,
 * and bridge webview postMessage ↔ main process for workdir folder pick.
 */

function readMuseServerUrl(): string {
  const prefix = "--muse-server-url=";
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  return process.env.MUSE_SERVER_URL ?? "http://127.0.0.1:8787";
}

const serverBaseUrl = readMuseServerUrl();

contextBridge.exposeInMainWorld("museServerBaseUrl", serverBaseUrl);
contextBridge.exposeInMainWorld("museServerUrl", serverBaseUrl);
contextBridge.exposeInMainWorld("__MUSE_SERVER_URL__", serverBaseUrl);
contextBridge.exposeInMainWorld("waveHostType", "desktop");
contextBridge.exposeInMainWorld("museWorkdir", process.cwd());

// additionalArguments are fixed at window creation and stale after live updates.
// Read ui.json on every preload execution so reloads receive the current preference.
const uiPrefs = loadUiPrefs();
contextBridge.exposeInMainWorld(
  "__MUSE_THEME_PREFERENCE__",
  uiPrefs.themePreference,
);
contextBridge.exposeInMainWorld("__MUSE_THEME_SCALING__", uiPrefs.themeScaling);
contextBridge.exposeInMainWorld(
  "__MUSE_THEME_ACCENT__",
  uiPrefs.themeAccentColor,
);
contextBridge.exposeInMainWorld("__MUSE_THEME_RADIUS__", uiPrefs.themeRadius);
contextBridge.exposeInMainWorld("__MUSE_THEME_GRAY__", uiPrefs.themeGrayColor);

function applyBootTheme(): void {
  const themePreference = uiPrefs.themePreference;
  const dark =
    themePreference === "dark" ||
    (themePreference === "system" &&
      globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const effective =
    themePreference === "light" ? "light" : dark ? "dark" : "light";
  document.documentElement?.setAttribute("data-theme", effective);
}
applyBootTheme();
document.addEventListener("DOMContentLoaded", applyBootTheme);

const FROM_WEBVIEW = "muse:from-webview";
const TO_WEBVIEW = "muse:to-webview";

contextBridge.exposeInMainWorld("acquireVsCodeApi", () => ({
  postMessage: (message: unknown) => {
    ipcRenderer.send(FROM_WEBVIEW, message);
  },
  getState: () => undefined,
  setState: () => undefined,
}));

ipcRenderer.on(TO_WEBVIEW, (_event, data: unknown) => {
  window.dispatchEvent(new MessageEvent("message", { data }));
});
