/**
 * Muse Electron main-process entry.
 *
 * Starts the local Muse HTTP/WS server, then loads the webview with the
 * server base URL injected via preload (`window.museServerBaseUrl`).
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, shell, webContents } from "electron";
import { execFileSync } from "child_process";
import * as path from "path";
import {
  checkForHotUpdate,
  discardActiveHot,
  HOT_REPO,
  readBundledHot,
  readShellVersion,
  resolveLaunchResources,
  type LaunchResources,
} from "./hotUpdate";
import { createUpdateMonitor, type UpdateOffer, type UpdateStatus } from "./updateCheck";
import { museServerBaseUrl, startMuseServer } from "./serverProcess";
import { installThemeHost } from "./themeHost";
import { windowBackgroundFor } from "./uiPrefs";
import { applyPreviewViewport, clearPreviewGuestData, createMainWindow, desktopPaths } from "./window";
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
  // Dev: point the whole state dir (server db/sessions/auth + logs, and
  // desktop ui.json) at ~/.dev-muse-work so dev never touches production's
  // ~/.muse-work. The server child inherits this env (serverProcess merges
  // process.env); getMuseHomeDir reads it in every package.
  process.env.MUSE_HOME_DIR = ".dev-muse-work";
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
        {
          label: "关闭",
          accelerator: "CommandOrControl+W",
          click: () => {
            getWindow()?.webContents.send(TO_WEBVIEW, {
              command: "desktopCloseFocused",
            });
          },
        },
        { type: "separator" },
        ...(isMac ? [] : [{ role: "quit" as const }]),
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openMainWindow(
  quitGate: ReturnType<typeof createQuitGate>,
  webviewHtmlPath: string,
): void {
  if (!serverBaseUrl || !themeHost) return;
  const paths = resolveDesktopPaths();
  mainWindow = createMainWindow({
    serverBaseUrl,
    backgroundColor: windowBackgroundFor(themeHost.effective),
    preloadPath: paths.preloadPath,
    webviewHtmlPath,
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

    const publishUpdate = (status: UpdateStatus): void => {
      const win = mainWindow;
      if (!win || win.isDestroyed()) return;
      win.webContents.send(TO_WEBVIEW, {
        command: "desktopUpdateStatus",
        phase: status.phase,
        offer: status.offer
          ? { kind: status.offer.kind, version: status.offer.version }
          : null,
        detail: status.detail,
      });
    };
    const bundledHot = app.isPackaged ? readBundledHot(process.resourcesPath) : null;
    const shellVersion =
      bundledHot?.shell ??
      readShellVersion(path.join(app.getAppPath(), "package.json")) ??
      app.getVersion();
    const updateMonitor = createUpdateMonitor({
      check: () =>
        checkForHotUpdate({
          hotRoot: path.join(app.getPath("userData"), "hot"),
          shellVersion,
          bundledVersion: bundledHot?.version ?? app.getVersion(),
          repo: HOT_REPO,
        }),
      publish: publishUpdate,
    });
    const showUpdateDialog = (offer: UpdateOffer): void => {
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      if (offer.kind === "installer") {
        const prompt = {
          type: "info" as const,
          buttons: ["下载安装包", "稍后"],
          defaultId: 0,
          cancelId: 1,
          title: "需要重新安装",
          message: "这一版要换桌面程序",
          detail:
            "热更新带不上这次改动。安装包会下到「下载」文件夹。打开后，把 Muse 拖进「应用程序」（/Applications），覆盖原来的那个。",
        };
        const box = win ? dialog.showMessageBox(win, prompt) : dialog.showMessageBox(prompt);
        void box
          .then(({ response }) => {
            if (response !== 0 || !offer.url) return;
            return shell.openExternal(offer.url);
          })
          .catch((err) => {
            console.error("[muse-desktop] installer prompt failed:", err);
          });
        return;
      }
      const busy = quitGate.isAgentBusy();
      const prompt = {
        type: "info" as const,
        buttons: busy ? ["稍后", "重启并中断"] : ["立即重启", "稍后"],
        defaultId: 0,
        cancelId: busy ? 0 : 1,
        title: "有新版本",
        message: "界面和服务已更新",
        detail: busy ? "重启后即可使用。当前有任务在运行，重启会中断它。" : "重启后即可使用。",
      };
      const box = win ? dialog.showMessageBox(win, prompt) : dialog.showMessageBox(prompt);
      void box
        .then(({ response }) => {
          const restart = busy ? response === 1 : response === 0;
          if (!restart) return;
          return stopServer?.().finally(() => {
            app.relaunch();
            app.exit(0);
          });
        })
        .catch((err) => {
          console.error("[muse-desktop] update prompt failed:", err);
        });
    };

    ipcMain.on(FROM_WEBVIEW, (_event, raw: unknown) => {
      const msg = raw as { command?: string } | null;
      if (msg?.command === "previewClearCache") {
        void clearPreviewGuestData("cache");
        return;
      }
      if (msg?.command === "previewClearCookies") {
        void clearPreviewGuestData("cookies");
        return;
      }
      if (msg?.command === "previewSetViewport" || msg?.command === "previewClearViewport") {
        applyPreviewViewport(msg, (id) => webContents.fromId(id) ?? undefined);
        return;
      }
      if (msg?.command === "desktopUpdateQuery" || msg?.command === "desktopCheckForUpdate") {
        if (msg.command === "desktopCheckForUpdate") {
          void updateMonitor.checkNow();
          return;
        }
        publishUpdate(updateMonitor.status());
        return;
      }
      if (msg?.command === "desktopApplyUpdate") {
        const offer = updateMonitor.offer();
        if (offer) showUpdateDialog(offer);
        return;
      }
      if (msg?.command !== "desktopCloseWindow") return;
      const win = mainWindow;
      if (!win || win.isDestroyed()) return;
      win.close();
    });

    const paths = resolveDesktopPaths();
    const hotRoot = path.join(app.getPath("userData"), "hot");
    const bundledVersion = bundledHot?.version ?? app.getVersion();
    const bundledLaunch: LaunchResources = {
      webviewHtmlPath: paths.webviewHtmlPath,
      serverEntry: paths.serverEntry,
      source: "bundled",
      version: bundledVersion,
    };
    let launch = app.isPackaged
      ? resolveLaunchResources({
          hotRoot,
          bundled: bundledLaunch,
        })
      : bundledLaunch;

    const boot = async (entry: string): Promise<void> => {
      const server = await startMuseServer({
        entry,
        // MUSE_HOME_DIR was set in the dev block above (and inherited here via
        // process.env merge), so the server keeps ALL state (db/settings/
        // providers/sessions/auth + logs) under ~/.dev-muse-work instead
        // of the packaged app's ~/.muse-work.
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
    };

    try {
      await boot(launch.serverEntry);
    } catch (err) {
      if (launch.source !== "hot") {
        console.error("[muse-desktop] failed to start:", err);
        app.quit();
        return;
      }
      console.error("[muse-desktop] hot resources failed, using bundled copy:", err);
      discardActiveHot(hotRoot);
      launch = bundledLaunch;
      try {
        await boot(launch.serverEntry);
      } catch (fallbackErr) {
        console.error("[muse-desktop] failed to start:", fallbackErr);
        app.quit();
        return;
      }
    }

    console.log(
      `[muse-desktop] server ready at ${serverBaseUrl} (${launch.source} ${launch.version})`,
    );
    openMainWindow(quitGate, launch.webviewHtmlPath);
    if (app.isPackaged) updateMonitor.start();

    powerMonitor.on("resume", () => {
      void recoverAfterResume();
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openMainWindow(quitGate, launch.webviewHtmlPath);
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
