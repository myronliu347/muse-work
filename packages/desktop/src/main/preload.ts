import { contextBridge } from "electron";

/**
 * Minimal preload: expose Muse server base URL + desktop host marker.
 * Wave's acquireVsCodeApi IPC bridge is not required for Muse HTTP/WS MVP —
 * the webview hostBridge talks to the local server directly.
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

// Stub VS Code API so DesktopApp / ChatApp do not throw if something still
// calls acquireVsCodeApi before hostBridge wraps it.
contextBridge.exposeInMainWorld("acquireVsCodeApi", () => ({
  postMessage: (_message: unknown) => {
    // Muse MVP: UI → Muse HTTP/WS via hostBridge; outer postMessage is unused.
  },
  getState: () => undefined,
  setState: () => undefined,
}));
