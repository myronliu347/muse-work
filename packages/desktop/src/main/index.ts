/**
 * Muse Electron main-process entry.
 *
 * Starts the local Muse HTTP/WS server, then loads the webview with the
 * server base URL injected via preload (`window.museServerBaseUrl`).
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor } from "electron";
import { execFileSync } from "child_process";
import * as path from "path";
import { museServerBaseUrl, startMuseServer } from "./serverProcess";
import { installThemeHost } from "./themeHost";
import { windowBackgroundFor } from "./uiPrefs";
import { createMainWindow, desktopPaths } from "./window";
import { createQuitGate } from "./quitGate";
import {
  FROM_WEBVIEW,
  installWorkdirHost,
  TO_WEBVIEW,
  type WorkdirHost,
} from "./workdirHost";

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

function installAppMenu(getWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: isMac ? "文件" : "File",
      submenu: [
        {
          label: "新对话",
          accelerator: "CommandOrControl+N",
          click: () => {
            getWindow()?.webContents.send(TO_WEBVIEW, {
              command: "desktopNewSessionShortcut",
            });
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openMainWindow(quitGate: ReturnType<typeof createQuitGate>): void {
  if (!serverBaseUrl || !themeHost) return;
  const paths = resolveDesktopPaths();
  mainWindow = createMainWindow({
    serverBaseUrl,
    backgroundColor: windowBackgroundFor(themeHost.effective),
    preloadPath: paths.preloadPath,
    webviewHtmlPath: paths.webviewHtmlPath,
    title: APP_DISPLAY_NAME,
  });
  mainWindow.on("close", (event) => {
    quitGate.handleWindowClose(event);
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

    const quitGate = createQuitGate({
      dispose: () => {
        workdirHost?.dispose();
        workdirHost = null;
        themeHost?.dispose();
        themeHost = null;
        serverHandle = null;
        serverBaseUrl = null;
      },
      stopServer: async () => {
        await stopServer?.();
      },
      quit: () => app.quit(),
      confirmQuitWhileBusy: async () => {
        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const options: Electron.MessageBoxOptions = {
          type: "warning",
          buttons: ["取消", "退出并中断"],
          defaultId: 0,
          cancelId: 0,
          title: "仍有任务在运行",
          message: "有对话或后台任务正在运行",
          detail: "关闭应用将中断当前生成和后台任务。确定要退出吗？",
        };
        const result = win
          ? await dialog.showMessageBox(win, options)
          : await dialog.showMessageBox(options);
        return result.response === 1;
      },
      prepareQuit: async () => {
        const win = mainWindow;
        if (!win || win.isDestroyed()) return;
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            cleanup();
            resolve();
          }, 2500);
          const onDone = (_event: Electron.IpcMainEvent, raw: unknown) => {
            const msg = raw as { command?: string } | null;
            if (msg?.command !== "desktopPrepareQuitDone") return;
            cleanup();
            resolve();
          };
          const cleanup = () => {
            clearTimeout(timeout);
            ipcMain.removeListener(FROM_WEBVIEW, onDone);
          };
          ipcMain.on(FROM_WEBVIEW, onDone);
          win.webContents.send(TO_WEBVIEW, { command: "desktopPrepareQuit" });
        });
      },
    });

    workdirHost = installWorkdirHost({
      userDataPath: app.getPath("userData"),
      getWindow: () => mainWindow,
      defaultWorkdir: process.cwd(),
      onAgentBusyChange: (busy) => quitGate.setAgentBusy(busy),
    });
    themeHost = installThemeHost({
      getWindow: () => mainWindow,
    });

    installAppMenu(() => mainWindow);

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
      openMainWindow(quitGate);

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
        openMainWindow(quitGate);
      }
    });

    app.on("before-quit", (event) => {
      quitGate.handleBeforeQuit(event);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
