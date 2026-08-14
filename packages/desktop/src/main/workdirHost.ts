/**
 * Desktop IPC host: workdir bootstrap, file panel, diff, terminal, preview.
 */

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import { readLocalFileForPanel } from "./filePanel.js";
import { listWorkspaceDir, searchWorkspaceFiles } from "./fileSearch.js";
import { listGitBranches } from "./gitBranches.js";
import { getWorkspaceDiff } from "./gitDiff.js";
import { generateRandomName } from "./nameGenerator.js";
import { TerminalManager } from "./terminal.js";
import { createWorktree, removeWorktree } from "./worktree.js";

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
  /** Open a folder in VS Code (`code <workdir>`). Injected in tests. */
  openInEditor?: (workdir: string) => void;
  /** Open a folder in the system terminal. Injected in tests. */
  openInTerminal?: (workdir: string) => void;
  /** Webview reports whether any agent turn is in flight. */
  onAgentBusyChange?: (busy: boolean) => void;
};

function defaultOpenInEditor(workdir: string): void {
  const child = spawn("code", [workdir], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  child.on("error", () => {
    // `code` CLI missing from PATH — ignore.
  });
  child.unref();
}

function escapeForAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function defaultOpenInTerminal(workdir: string): void {
  const platform = process.platform;
  const spawnOpts = {
    detached: true,
    stdio: "ignore" as const,
    windowsHide: true,
  };
  let child: ReturnType<typeof spawn> | null = null;

  if (platform === "darwin") {
    const escaped = escapeForAppleScriptString(workdir);
    child = spawn(
      "/usr/bin/osascript",
      [
        "-e",
        `tell application "Terminal" to do script "cd \\"${escaped}\\"; clear"`,
      ],
      spawnOpts,
    );
  } else if (platform === "win32") {
    child = spawn(
      "cmd.exe",
      ["/c", "start", "cmd.exe", "/K", `cd /d "${workdir}"`],
      { ...spawnOpts, shell: true },
    );
  } else {
    child = spawn(
      "x-terminal-emulator",
      ["--working-directory", workdir],
      spawnOpts,
    );
  }

  child.on("error", () => {
    // Terminal app / emulator missing — ignore.
  });
  child.unref();
}

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
  const openInEditor = options.openInEditor ?? defaultOpenInEditor;
  const openInTerminal = options.openInTerminal ?? defaultOpenInTerminal;


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
      filterText?: string;
      dir?: string;
      workdir?: string;
      baseBranch?: string;
      name?: string;
      text?: string;
      images?: unknown;
      branch?: string;
      repoRoot?: string;
      busy?: boolean;
    };
    const command = msg?.command;
    if (!command) return;

    const win = fromWebContents(event.sender) ?? options.getWindow();

    if (command === "desktopReady") {
      pushState(win, state);
      return;
    }

    if (command === "desktopAgentBusy") {
      options.onAgentBusyChange?.(Boolean(msg.busy));
      return;
    }

    if (command === "desktopOpenInEditor") {
      const workdir = typeof msg.workdir === "string" ? msg.workdir.trim() : "";
      if (workdir) openInEditor(workdir);
      return;
    }

    if (command === "desktopOpenInTerminal") {
      const workdir = typeof msg.workdir === "string" ? msg.workdir.trim() : "";
      if (workdir) openInTerminal(workdir);
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

    if (command === "requestFileSuggestions") {
      const requestId =
        typeof msg.requestId === "string" ? msg.requestId : undefined;
      const filterText =
        typeof msg.filterText === "string" ? msg.filterText : "";
      const dir = typeof msg.dir === "string" ? msg.dir : "";
      const cwd = state.workdir;
      try {
        const query = filterText.trim();
        const suggestions = cwd
          ? query
            ? searchWorkspaceFiles(cwd, { query, maxResults: 20 })
            : listWorkspaceDir(cwd, dir)
          : [];
        pushToWebview(win, {
          command: "fileSuggestionsResponse",
          suggestions,
          filterText,
          requestId,
        });
      } catch (err) {
        pushToWebview(win, {
          command: "fileSuggestionsError",
          error: err instanceof Error ? err.message : String(err),
          requestId,
        });
      }
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
      const cwd =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
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

    if (command === "desktopListGitBranches") {
      const cwd =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
      const result = cwd ? await listGitBranches(cwd) : null;
      pushToWebview(win, {
        command: "desktopGitBranches",
        workdir: cwd,
        paneId: msg.paneId,
        result,
      });
      return;
    }

    if (command === "desktopCreateWorktree") {
      const cwd =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
      const requestId =
        typeof msg.requestId === "string" ? msg.requestId : undefined;
      const baseBranch =
        typeof msg.baseBranch === "string" && msg.baseBranch
          ? msg.baseBranch
          : undefined;
      const name =
        typeof msg.name === "string" && msg.name.trim()
          ? msg.name.trim()
          : generateRandomName();
      if (!cwd) {
        pushToWebview(win, {
          command: "desktopWorktreeCreated",
          requestId,
          paneId: msg.paneId,
          error: "无法确定仓库目录",
        });
        return;
      }
      try {
        const session = await createWorktree(name, cwd, { baseBranch });
        rememberWorkdir(state, session.path);
        savePersistedWorkdirState(options.userDataPath, state);
        pushState(win, state);
        pushToWebview(win, {
          command: "desktopWorktreeCreated",
          requestId,
          paneId: msg.paneId,
          name: session.name,
          path: session.path,
          branch: session.branch,
          baseBranch: session.baseBranch,
          repoRoot: session.repoRoot,
          isNew: session.isNew,
          text: typeof msg.text === "string" ? msg.text : undefined,
          images: msg.images,
        });
      } catch (error) {
        pushToWebview(win, {
          command: "desktopWorktreeCreated",
          requestId,
          paneId: msg.paneId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (command === "desktopRemoveWorktree") {
      const wtPath = typeof msg.path === "string" ? msg.path : "";
      const branch = typeof msg.branch === "string" ? msg.branch : "";
      const repoRoot = typeof msg.repoRoot === "string" ? msg.repoRoot : "";
      if (wtPath && branch && repoRoot) {
        await removeWorktree({ path: wtPath, branch, repoRoot });
      }
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
      const cwd =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
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
