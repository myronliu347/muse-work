/**
 * Desktop IPC host: workdir bootstrap, file panel, diff, terminal, preview.
 */

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as fs from "fs";
import * as path from "path";
import { readLocalFileForPanel } from "./filePanel.js";
import { getWorkspaceDiff } from "./gitDiff.js";
import { TerminalManager } from "./terminal.js";

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
  openPath?: (filePath: string) => Promise<string>;
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

function pushToWebview(win: BrowserWindow | null, data: unknown): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(TO_WEBVIEW, data);
}

function pushState(win: BrowserWindow | null, state: WorkdirHostState): void {
  pushToWebview(win, {
    command: "desktopWorkdirState",
    workdir: state.workdir,
    recentWorkdirs: state.recentWorkdirs,
    host: state.host,
    hosts: [],
  });
}

/**
 * Wire IPC handlers for desktop workdir + panels.
 */
export function installWorkdirHost(options: WorkdirHostDeps): WorkdirHost {
  const ipc = options.ipc ?? ipcMain;
  const showOpenDialog =
    options.showOpenDialog ?? dialog.showOpenDialog.bind(dialog);
  const fromWebContents =
    options.fromWebContents ?? BrowserWindow.fromWebContents.bind(BrowserWindow);
  const openPath =
    options.openPath ??
    (typeof shell?.openPath === "function"
      ? shell.openPath.bind(shell)
      : async () => "shell.openPath unavailable");


  const state = loadPersistedWorkdirState(options.userDataPath);
  if (!state.workdir && options.defaultWorkdir) {
    state.workdir = options.defaultWorkdir;
  }

  const terminalManager = new TerminalManager({
    onData: (termId, data) => {
      pushToWebview(options.getWindow(), {
        command: "desktopTerminalData",
        termId,
        data,
      });
    },
    onExit: (termId, info) => {
      pushToWebview(options.getWindow(), {
        command: "desktopTerminalExit",
        termId,
        ...info,
      });
    },
  });

  const handler = async (
    event: Electron.IpcMainEvent,
    raw: unknown,
  ): Promise<void> => {
    const msg = raw as {
      command?: string;
      path?: string;
      host?: string;
      url?: string;
      requestId?: string;
      sessionId?: string;
      paneId?: string;
      termId?: string;
      data?: string;
      cols?: number;
      rows?: number;
      startLine?: number;
      endLine?: number;
    };
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
      return;
    }

    if (command === "openFile" || command === "previewImage") {
      const filePath = typeof msg.path === "string" ? msg.path : "";
      if (!filePath) return;
      const fileView = await readLocalFileForPanel(filePath, {
        startLine: msg.startLine,
        endLine: msg.endLine,
      });
      pushToWebview(win, {
        command: "desktopFileContent",
        paneId: msg.paneId,
        fileView,
      });
      return;
    }

    if (command === "desktopOpenFileExternal" && typeof msg.path === "string") {
      const err = await openPath(msg.path);
      if (err) {
        pushToWebview(win, {
          command: "desktopFileContent",
          paneId: msg.paneId,
          fileView: {
            path: msg.path,
            host: "local",
            error: `无法用系统应用打开：${err}`,
          },
        });
      }
      return;
    }

    if (command === "desktopGetWorkspaceDiff") {
      const cwd = state.workdir;
      const result = cwd
        ? await getWorkspaceDiff(cwd)
        : ({ kind: "not-a-repo" } as const);
      pushToWebview(win, {
        command: "desktopWorkspaceDiff",
        paneId: msg.paneId,
        result,
      });
      return;
    }

    if (command === "desktopForwardPort") {
      // Local-only MVP: no SSH tunnel — echo the localhost URL back.
      pushToWebview(win, {
        command: "desktopForwardPortResult",
        paneId: msg.paneId,
        requestId: msg.requestId,
        url: msg.url,
        originalUrl: msg.url,
      });
      return;
    }

    if (command === "desktopTerminalCreate") {
      const cwd = state.workdir;
      const termId = typeof msg.termId === "string" ? msg.termId : "";
      if (!termId) return;
      if (!cwd) {
        pushToWebview(win, {
          command: "desktopTerminalExit",
          termId,
          error: "无法确定终端工作目录",
        });
        return;
      }
      await terminalManager.create(
        termId,
        cwd,
        msg.cols || 80,
        msg.rows || 24,
      );
      return;
    }

    if (command === "desktopTerminalInput") {
      if (typeof msg.termId === "string" && typeof msg.data === "string") {
        terminalManager.write(msg.termId, msg.data);
      }
      return;
    }

    if (command === "desktopTerminalResize") {
      if (typeof msg.termId === "string") {
        terminalManager.resize(msg.termId, msg.cols || 80, msg.rows || 24);
      }
      return;
    }

    if (command === "desktopTerminalKill") {
      if (typeof msg.termId === "string") {
        terminalManager.kill(msg.termId);
      }
    }
  };

  ipc.on(FROM_WEBVIEW, handler);

  return {
    getState: () => ({ ...state, recentWorkdirs: [...state.recentWorkdirs] }),
    dispose: () => {
      ipc.removeListener(FROM_WEBVIEW, handler);
      terminalManager.killAll();
    },
  };
}
