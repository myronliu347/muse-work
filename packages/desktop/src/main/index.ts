/**
 * Muse Work Electron main-process entry.
 *
 * Starts the local Muse HTTP/WS server, then loads the webview with the
 * server base URL injected via preload (`window.museServerBaseUrl`).
 */

import { app, BrowserWindow, nativeImage } from "electron";
import { execFileSync } from "child_process";
import * as path from "path";
import { museServerBaseUrl, startMuseServer } from "./serverProcess";
import { createMainWindow, desktopPaths } from "./window";
import { installWorkdirHost, type WorkdirHost } from "./workdirHost";

function adoptLoginShellPath(): void {
  if (process.platform === "win32") return;
  try {
    const probed = execFileSync("/bin/zsh", ["-lic", "echo $PATH"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split("\n")
      .pop()
      ?.trim();
    if (probed) process.env.PATH = probed;
  } catch {
    // keep default PATH
  }
}

adoptLoginShellPath();

app.setName("Muse Work");

if (!app.isPackaged) {
  app.setPath(
    "userData",
    path.join(app.getPath("appData"), "muse-work-desktop-dev"),
  );
}

let mainWindow: BrowserWindow | null = null;
let stopServer: (() => Promise<void>) | null = null;
let serverBaseUrl: string | null = null;
let workdirHost: WorkdirHost | null = null;

function openMainWindow(): void {
  if (!serverBaseUrl) return;
  const paths = desktopPaths(__dirname);
  mainWindow = createMainWindow({
    serverBaseUrl,
    preloadPath: paths.preloadPath,
    webviewHtmlPath: paths.webviewHtmlPath,
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    if (!app.isPackaged) {
      app.dock?.setIcon(
        nativeImage.createFromPath(
          path.join(__dirname, "../../assets/icon.png"),
        ),
      );
    }

    workdirHost = installWorkdirHost({
      userDataPath: app.getPath("userData"),
      getWindow: () => mainWindow,
      defaultWorkdir: process.cwd(),
    });

    const paths = desktopPaths(__dirname);

    try {
      const server = await startMuseServer({ entry: paths.serverEntry });
      stopServer = server.stop;
      serverBaseUrl = museServerBaseUrl(server.port, server.host);
      console.log(`[muse-desktop] server ready at ${serverBaseUrl}`);
      openMainWindow();
    } catch (err) {
      console.error("[muse-desktop] failed to start:", err);
      app.quit();
      return;
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    workdirHost?.dispose();
    workdirHost = null;
    void stopServer?.();
  });
}
