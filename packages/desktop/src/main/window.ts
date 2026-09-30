import { BrowserWindow, nativeImage, shell } from "electron";
import * as path from "path";

export type CreateMainWindowOpts = {
  serverBaseUrl: string;
  backgroundColor: string;
  /** Absolute path to preload.cjs */
  preloadPath: string;
  /** Absolute path to webview/index.html */
  webviewHtmlPath: string;
  title?: string;
};

/**
 * Create the single Muse BrowserWindow and load the synced webview.
 * Server base URL is passed via additionalArguments for the preload to expose.
 */
export function createMainWindow(opts: CreateMainWindowOpts): BrowserWindow {
  const packageRoot = path.join(path.dirname(opts.preloadPath), "..", "..");
  const icon = nativeImage.createFromPath(
    path.join(packageRoot, "assets", "icon.png"),
  );

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    title: opts.title ?? "Muse",
    show: false,
    backgroundColor: opts.backgroundColor,
    icon: icon.isEmpty() ? undefined : icon,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 12 },
        }
      : {}),
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Required for PreviewPane's <webview> guest (Electron ≥5 defaults this off).
      webviewTag: true,
      additionalArguments: [
        `--muse-server-url=${opts.serverBaseUrl}`,
      ],
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:")) return;
    event.preventDefault();
    if (/^https?:/.test(url)) {
      void shell.openExternal(url);
    }
  });

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });

  void win.loadFile(opts.webviewHtmlPath);
  attachRendererRecovery(win);
  return win;
}

export function attachRendererRecovery(win: {
  isDestroyed: () => boolean;
  reload: () => void;
  on?: (event: "unresponsive", listener: () => void) => void;
  webContents: {
    on: (
      event: "render-process-gone",
      listener: (
        event: unknown,
        details: { reason: string },
      ) => void,
    ) => void;
  };
}): void {
  const reloadIfAlive = () => {
    if (win.isDestroyed()) return;
    win.reload();
  };
  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    reloadIfAlive();
  });
  win.on?.("unresponsive", reloadIfAlive);
}

export type DesktopPathsOpts = {
  /** When true, resolve muse-server from Electron resources (packaged app). */
  isPackaged?: boolean;
  /** `process.resourcesPath` in the packaged app. */
  resourcesPath?: string;
};

/** Resolve package-root-relative paths from dist/main. */
export function desktopPaths(
  dirname = __dirname,
  opts: DesktopPathsOpts = {},
): {
  preloadPath: string;
  webviewHtmlPath: string;
  serverEntry: string;
} {
  const packageRoot = path.join(dirname, "..", "..");
  const serverEntry = opts.isPackaged
    ? path.join(
        opts.resourcesPath ?? process.resourcesPath,
        "muse-server",
        "dist",
        "index.js",
      )
    : path.join(packageRoot, "..", "server", "dist", "index.js");
  return {
    preloadPath: path.join(dirname, "preload.cjs"),
    webviewHtmlPath: path.join(packageRoot, "webview", "index.html"),
    serverEntry,
  };
}
