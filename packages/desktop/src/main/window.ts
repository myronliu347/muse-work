import { BrowserWindow, nativeImage, shell } from "electron";
import * as path from "path";

export type CreateMainWindowOpts = {
  serverBaseUrl: string;
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
    title: opts.title ?? "Muse Work",
    backgroundColor: "#1e1e1e",
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--muse-server-url=${opts.serverBaseUrl}`],
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

  void win.loadFile(opts.webviewHtmlPath);
  return win;
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
