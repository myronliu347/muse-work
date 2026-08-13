/**
 * Muse Electron main-process entry.
 *
 * Starts the local Muse HTTP/WS server, then loads the webview with the
 * server base URL injected via preload (`window.museServerBaseUrl`).
 */

import { app, BrowserWindow, nativeImage, powerMonitor } from "electron";
import { execFileSync } from "child_process";
import * as path from "path";
import { museServerBaseUrl, startMuseServer } from "./serverProcess";
import { installThemeHost } from "./themeHost";
import { windowBackgroundFor } from "./uiPrefs";
import { createMainWindow, desktopPaths } from "./window";
import { installWorkdirHost, TO_WEBVIEW, type WorkdirHost } from "./workdirHost";

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

/** Packaged: "Muse"; local `pnpm dev`: "Muse developing". */
const APP_DISPLAY_NAME = app.isPackaged
  ? "Muse"
  : "Muse developing";

app.setName(APP_DISPLAY_NAME);

if (!app.isPackaged) {
  app.setPath(
    "userData",
    path.join(app.getPath("appData"), "muse-work-desktop-dev"),
  );
}

let mainWindow: BrowserWindow | null = null;
let stopServer: (() => Promise<void>) | null = null;
let serverHandle: Awaited<ReturnType<typeof startMuseServer>> | null = null;
let serverBaseUrl: string | null = null;
let workdirHost: WorkdirHost | null = null;
let themeHost: ReturnType<typeof installThemeHost> | null = null;

function resolveDesktopPaths() {
  return desktopPaths(__dirname, {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
}

function openMainWindow(): void {
  if (!serverBaseUrl || !themeHost) return;
  const paths = resolveDesktopPaths();
  mainWindow = createMainWindow({
    serverBaseUrl,
    backgroundColor: windowBackgroundFor(themeHost.effective),
    preloadPath: paths.preloadPath,
    webviewHtmlPath: paths.webviewHtmlPath,
    title: APP_DISPLAY_NAME,
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function recoverAfterResume(): Promise<void> {
  if (!serverHandle || !serverBaseUrl) return;
  const healthy = await serverHandle.probeHealth();
  if (!healthy) {
    serverHandle.killUnhealthy();
    return;
  }
  try {
    await fetch(`${serverBaseUrl}/control/resume`, { method: "POST" });
  } catch {
    // Server may still be coming back; WS reconnect below is best-effort.
  }
  mainWindow?.webContents.send(TO_WEBVIEW, {
    command: "museServerLifecycle",
    state: "resume",
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
    const iconPath = path.join(__dirname, "../../assets/icon.png");
    const appIcon = nativeImage.createFromPath(iconPath);

    app.setAboutPanelOptions({
      applicationName: APP_DISPLAY_NAME,
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      iconPath,
    });

    if (!app.isPackaged && !appIcon.isEmpty()) {
      app.dock?.setIcon(appIcon);
    }

    workdirHost = installWorkdirHost({
      userDataPath: app.getPath("userData"),
      getWindow: () => mainWindow,
      defaultWorkdir: process.cwd(),
    });
    themeHost = installThemeHost({
      getWindow: () => mainWindow,
    });

    const paths = resolveDesktopPaths();

    try {
      const server = await startMuseServer({
        entry: paths.serverEntry,
        onLifecycle: (event) => {
          mainWindow?.webContents.send(TO_WEBVIEW, {
            command: "museServerLifecycle",
            ...event,
          });
        },
      });
      stopServer = server.stop;
      serverHandle = server;
      serverBaseUrl = museServerBaseUrl(server.port, server.host);
      console.log(`[muse-desktop] server ready at ${serverBaseUrl}`);
      openMainWindow();

      powerMonitor.on("resume", () => {
        void recoverAfterResume();
      });
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
    themeHost?.dispose();
    themeHost = null;
    void stopServer?.();
    serverHandle = null;
    serverBaseUrl = null;
  });
}
