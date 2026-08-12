/**
 * Desktop workdir host: replies to webview workdir commands via Electron IPC
 * and opens a native folder picker when requested.
 */

import { BrowserWindow, dialog, ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";

export const FROM_WEBVIEW = "muse:from-webview";
export const TO_WEBVIEW = "muse:to-webview";

export type WorkdirHostState = {
  workdir?: string;
  recentWorkdirs: string[];
  host: string;
};

export type WorkdirHost = {
  getState: () => WorkdirHostState;
  dispose: () => void;
};

export type WorkdirHostDeps = {
  userDataPath: string;
  getWindow: () => BrowserWindow | null;
  defaultWorkdir?: string;
  ipc?: Pick<typeof ipcMain, "on" | "removeListener">;
  showOpenDialog?: typeof dialog.showOpenDialog;
  fromWebContents?: typeof BrowserWindow.fromWebContents;
};

function persistPath(userDataPath: string): string {
  return path.join(userDataPath, "workdir-state.json");
}

export function loadPersistedWorkdirState(
  userDataPath: string,
): WorkdirHostState {
  const file = persistPath(userDataPath);
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        workdir?: string;
        recentWorkdirs?: string[];
      };
      return {
        workdir: raw.workdir,
        recentWorkdirs: Array.isArray(raw.recentWorkdirs)
          ? raw.recentWorkdirs.filter((p) => typeof p === "string")
          : [],
        host: "local",
      };
    }
  } catch {
    // ignore corrupt state
  }
  return { recentWorkdirs: [], host: "local" };
}

export function savePersistedWorkdirState(
  userDataPath: string,
  state: WorkdirHostState,
): void {
  try {
    fs.writeFileSync(
      persistPath(userDataPath),
      JSON.stringify(
        {
          workdir: state.workdir,
          recentWorkdirs: state.recentWorkdirs,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  } catch {
    // best-effort
  }
}

export function rememberWorkdir(state: WorkdirHostState, dir: string): void {
  state.workdir = dir;
  state.recentWorkdirs = [
    dir,
    ...state.recentWorkdirs.filter((p) => p !== dir),
  ].slice(0, 10);
}

function pushState(win: BrowserWindow | null, state: WorkdirHostState): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(TO_WEBVIEW, {
    command: "desktopWorkdirState",
    workdir: state.workdir,
    recentWorkdirs: state.recentWorkdirs,
    host: state.host,
    hosts: [],
  });
}

/**
 * Wire IPC handlers for desktop workdir bootstrap + folder pick.
 * `getWindow` should return the current BrowserWindow (may be null briefly).
 */
export function installWorkdirHost(options: WorkdirHostDeps): WorkdirHost {
  const ipc = options.ipc ?? ipcMain;
  const showOpenDialog = options.showOpenDialog ?? dialog.showOpenDialog.bind(dialog);
  const fromWebContents =
    options.fromWebContents ?? BrowserWindow.fromWebContents.bind(BrowserWindow);

  const state = loadPersistedWorkdirState(options.userDataPath);
  if (!state.workdir && options.defaultWorkdir) {
    state.workdir = options.defaultWorkdir;
  }

  const handler = async (
    event: Electron.IpcMainEvent,
    raw: unknown,
  ): Promise<void> => {
    const msg = raw as { command?: string; path?: string; host?: string };
    const command = msg?.command;
    if (!command) return;

    const win = fromWebContents(event.sender) ?? options.getWindow();

    if (command === "desktopReady") {
      pushState(win, state);
      return;
    }

    if (command === "desktopSelectWorkdir") {
      if (!win) return;
      const result = await showOpenDialog(win, {
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return;
      rememberWorkdir(state, result.filePaths[0]);
      savePersistedWorkdirState(options.userDataPath, state);
      pushState(win, state);
      return;
    }

    if (command === "desktopSelectRecentWorkdir" && typeof msg.path === "string") {
      rememberWorkdir(state, msg.path);
      savePersistedWorkdirState(options.userDataPath, state);
      pushState(win, state);
      return;
    }

    if (command === "desktopRemoveRecentWorkdir" && typeof msg.path === "string") {
      state.recentWorkdirs = state.recentWorkdirs.filter((p) => p !== msg.path);
      if (state.workdir === msg.path) {
        state.workdir = state.recentWorkdirs[0];
      }
      savePersistedWorkdirState(options.userDataPath, state);
      pushState(win, state);
    }
  };

  ipc.on(FROM_WEBVIEW, handler);

  return {
    getState: () => ({ ...state, recentWorkdirs: [...state.recentWorkdirs] }),
    dispose: () => {
      ipc.removeListener(FROM_WEBVIEW, handler);
    },
  };
}
