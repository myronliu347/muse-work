/**
 * Desktop IPC host: workdir bootstrap, file panel, diff, terminal, preview.
 */

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readLocalFileForPanel } from "./filePanel.js";
import {
  findFilesByPathQuery,
  listWorkspaceDir,
  searchContentInWorkspace,
  searchWorkspaceFiles,
} from "./fileSearch.js";
import { listGitBranches } from "./gitBranches.js";
import {
  getCommitDiff,
  getWorkspaceDiff,
  listRecentCommits,
  type CommitCompare,
} from "./gitDiff.js";
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
  /** Reveal a file in the OS file manager. Injected in tests. */
  showItemInFolder?: (filePath: string) => void;
  /** Open a folder in VS Code (`code <workdir>`). Injected in tests. */
  openInEditor?: (workdir: string) => void;
  /** Open a folder in the system terminal. Injected in tests. */
  openInTerminal?: (workdir: string) => void;
  /** Home directory for `~/` expansion. Injected in tests. */
  homedir?: () => string;
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

const ITERM_BUNDLE_NAMES = ["iTerm.app", "iTerm2.app"] as const;

/** Prefer iTerm2 when installed; otherwise Terminal.app. */
export function resolveDarwinTerminalApp(
  existsSync: (filePath: string) => boolean = fs.existsSync,
  homedir: () => string = os.homedir,
): "iTerm" | "Terminal" {
  const dirs = ["/Applications", path.join(homedir(), "Applications")];
  for (const dir of dirs) {
    for (const bundle of ITERM_BUNDLE_NAMES) {
      if (existsSync(path.join(dir, bundle))) {
        return "iTerm";
      }
    }
  }
  return "Terminal";
}

function darwinTerminalScript(workdir: string): string {
  const escaped = escapeForAppleScriptString(workdir);
  if (resolveDarwinTerminalApp() === "iTerm") {
    return [
      'tell application "iTerm"',
      "activate",
      "set newWindow to (create window with default profile)",
      "tell current session of newWindow",
      `write text "cd \\"${escaped}\\""`,
      "end tell",
      "end tell",
    ].join("\n");
  }
  return `tell application "Terminal" to do script "cd \\"${escaped}\\"; clear"`;
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
    child = spawn(
      "/usr/bin/osascript",
      ["-e", darwinTerminalScript(workdir)],
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

/** Markdown hrefs percent-encode CJK names; restore the on-disk path. */
function decodeUriPath(filePath: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(filePath)) return filePath;
  try {
    return decodeURIComponent(filePath);
  } catch {
    return filePath;
  }
}

/**
 * True when a clicked path would open a file or the quick-open list.
 * A path that misses on disk and has no workdir hit stays plain text.
 */
export function clickedFileWillOpen(
  workdir: string | undefined,
  requested: string,
  home = os.homedir(),
): boolean {
  const filePath = decodeUriPath(requested);
  if (!filePath) return false;
  const expanded = filePath.startsWith("~/")
    ? path.join(home, filePath.slice(2))
    : filePath;
  const absPath =
    workdir && !path.isAbsolute(expanded)
      ? path.resolve(workdir, expanded)
      : expanded;
  if (fs.existsSync(absPath)) return true;
  const searchQuery = pathQueryForMissingOpen(workdir, filePath, absPath);
  const hits = workdir ? findFilesByPathQuery(workdir, searchQuery) : [];
  return hits.length > 0;
}

/** Query used to search the workdir when a clicked path is not on disk. */
function pathQueryForMissingOpen(
  workdir: string | undefined,
  requested: string,
  absPath: string,
): string {
  const trimmed = requested.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (trimmed.startsWith("~/")) return path.basename(trimmed);
  if (!path.isAbsolute(requested)) return trimmed;
  if (workdir) {
    const rel = path.relative(workdir, absPath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return rel.replace(/\\/g, "/");
    }
  }
  return path.basename(absPath);
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
          ? raw.recentWorkdirs.filter(
              (p): p is string =>
                typeof p === "string" && !isTransientWorkdir(p),
            )
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

/**
 * Workdirs that must not appear in the "recently opened" list: the server's
 * auto-minted `~/.muse-work/projects/<date>-<uid>` scratch dirs (or
 * `~/.dev-muse-work/…` under MUSE_HOME_DIR dev instances) and git worktree
 * dirs (`~/.muse-work/worktrees/<name>`, plus leftover `<repo>/.wave/worktrees`；
 * `.wave` 段是旧树兼容判定，刻意保留）。
 */
export function isTransientWorkdir(dir: string): boolean {
  const segments = dir.split(/[\\/]/).filter(Boolean);
  const stateDir = process.env.MUSE_HOME_DIR ?? ".muse-work";
  return segments.some(
    (seg, i) =>
      seg === stateDir ||
      (seg === ".wave" && segments[i + 1] === "worktrees"),
  );
}

export function rememberWorkdir(state: WorkdirHostState, dir: string): void {
  state.workdir = dir;
  if (isTransientWorkdir(dir)) return;
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
  const showItemInFolder =
    options.showItemInFolder ??
    (typeof shell?.showItemInFolder === "function"
      ? shell.showItemInFolder.bind(shell)
      : () => {});
  const openInEditor = options.openInEditor ?? defaultOpenInEditor;
  const openInTerminal = options.openInTerminal ?? defaultOpenInTerminal;
  const homedir = options.homedir ?? os.homedir;


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
      source?: string;
      query?: string;
      caseSensitive?: boolean;
      wholeWord?: boolean;
      regex?: boolean;
      baseBranch?: string;
      name?: string;
      text?: string;
      images?: unknown;
      branch?: string;
      repoRoot?: string;
      paths?: string[];
      busy?: boolean;
      rev?: string;
      compare?: string;
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

    if (command === "desktopSelectFiles") {
      if (!win) return;
      const result = await showOpenDialog(win, {
        properties: ["openFile", "multiSelections"],
        defaultPath: state.workdir,
      });
      if (result.canceled || !result.filePaths?.length) return;
      pushToWebview(win, {
        command: "desktopSelectFilesResult",
        paths: result.filePaths,
      });
      return;
    }

    if (command === "desktopPickDirectory") {
      // 只选目录回传路径，不动工作目录状态
      if (!win) return;
      const result = await showOpenDialog(win, {
        properties: ["openDirectory", "createDirectory"],
        defaultPath: state.workdir,
      });
      if (result.canceled || !result.filePaths[0]) return;
      pushToWebview(win, {
        command: "desktopPickDirectoryResult",
        path: result.filePaths[0],
      });
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
      const cwd =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
      try {
        const query = filterText.trim();
        const isQuickOpen = msg.source === "quickOpen";
        const suggestions = cwd
          ? query
            ? searchWorkspaceFiles(cwd, {
                query,
                maxResults: isQuickOpen ? 50 : 20,
                respectGitignore: isQuickOpen,
                filesOnly: isQuickOpen,
              })
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

    if (command === "desktopListDir") {
      const requestId =
        typeof msg.requestId === "string" ? msg.requestId : "";
      const dir = typeof msg.dir === "string" ? msg.dir : "";
      const cwd =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
      const entries = cwd
        ? listWorkspaceDir(cwd, dir, { respectGitignore: true }).map((e) => ({
            name: e.name,
            path: e.path,
            relativePath: e.relativePath.replace(/\/$/, ""),
            isDirectory: e.isDirectory,
          }))
        : [];
      pushToWebview(win, {
        command: "desktopListDirResult",
        requestId,
        dir,
        entries,
      });
      return;
    }

    if (command === "desktopSearchContent") {
      const requestId =
        typeof msg.requestId === "string" ? msg.requestId : "";
      const cwd =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
      const query = typeof msg.query === "string" ? msg.query : "";
      const out = cwd
        ? searchContentInWorkspace(cwd, {
            query,
            caseSensitive: Boolean(msg.caseSensitive),
            wholeWord: Boolean(msg.wholeWord),
            regex: Boolean(msg.regex),
          })
        : { results: [], totalMatches: 0 };
      pushToWebview(win, {
        command: "desktopSearchContentResult",
        requestId,
        results: out.results,
        totalMatches: out.totalMatches,
        truncated: out.truncated,
        error: out.error,
      });
      return;
    }

    if (command === "probeFileLinks") {
      const workdir =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
      const paths = Array.isArray(msg.paths)
        ? msg.paths.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
      pushToWebview(win, {
        command: "probeFileLinksResult",
        requestId: msg.requestId,
        openable: paths.filter((item) => clickedFileWillOpen(workdir, item)),
      });
      return;
    }

    if (command === "openFile" || command === "previewImage") {
      const filePath = decodeUriPath(
        typeof msg.path === "string" ? msg.path : "",
      );
      if (!filePath) return;
      const workdir =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
      // linkify keeps `~/x` links intact but path.isAbsolute("~/x") is false;
      // expand the leading `~` to the home directory here (Node context has
      // os; the webview linkify is pure front-end).
      const expanded = filePath.startsWith("~/")
        ? path.join(homedir(), filePath.slice(2))
        : filePath;
      // Message markdown linkify emits relative paths (e.g. src/foo.ts); resolve
      // them against the workdir. Absolute paths pass through path.resolve
      // unchanged.
      const absPath =
        workdir && !path.isAbsolute(expanded)
          ? path.resolve(workdir, expanded)
          : expanded;
      const replyContent = async (resolvedAbs: string) => {
        const fileView = await readLocalFileForPanel(resolvedAbs, {
          startLine: msg.startLine,
          endLine: msg.endLine,
          workdir,
        });
        pushToWebview(win, {
          command: "desktopFileContent",
          paneId: msg.paneId,
          requestedPath: filePath,
          fileView,
        });
      };
      if (fs.existsSync(absPath)) {
        await replyContent(absPath);
        return;
      }
      // Direct path missed: search by the requested path. One hit opens it;
      // several hits open Cmd+P with that query; none reports not found.
      const searchQuery = pathQueryForMissingOpen(workdir, filePath, absPath);
      const hits = workdir ? findFilesByPathQuery(workdir, searchQuery) : [];
      if (hits.length === 1) {
        await replyContent(hits[0].path);
        return;
      }
      if (hits.length > 1) {
        pushToWebview(win, {
          command: "openQuickOpen",
          paneId: msg.paneId,
          query: searchQuery,
          path: filePath,
        });
        return;
      }
      const error = `文件不存在：${absPath}`;
      pushToWebview(win, {
        command: "showToast",
        toast: { id: "muse-server", message: error },
      });
      pushToWebview(win, {
        command: "desktopFileContent",
        paneId: msg.paneId,
        requestedPath: filePath,
        fileView: { path: filePath, host: "local", error },
      });
      return;
    }

    if (command === "revealInFinder" && typeof msg.path === "string" && msg.path) {
      showItemInFolder(msg.path);
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
        ...(typeof msg.requestId === "string" ? { requestId: msg.requestId } : {}),
        result,
      });
      return;
    }

    if (command === "desktopListCommits") {
      const cwd =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
      const result = cwd
        ? await listRecentCommits(cwd)
        : ({ kind: "not-a-repo" } as const);
      pushToWebview(win, {
        command: "desktopCommits",
        paneId: msg.paneId,
        result,
      });
      return;
    }

    if (command === "desktopGetCommitDiff") {
      const cwd =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
      const rev = typeof msg.rev === "string" ? msg.rev : "";
      const compare: CommitCompare =
        msg.compare === "head" || msg.compare === "worktree" ? msg.compare : "patch";
      const result = cwd
        ? await getCommitDiff(cwd, rev, compare)
        : ({ kind: "not-a-repo" } as const);
      pushToWebview(win, {
        command: "desktopWorkspaceDiff",
        paneId: msg.paneId,
        ...(typeof msg.requestId === "string" ? { requestId: msg.requestId } : {}),
        result,
      });
      return;
    }

    if (command === "desktopRevertWorkspaceDiff") {
      const cwd =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
      const paths = Array.isArray(msg.paths)
        ? msg.paths.filter((p: unknown): p is string => typeof p === "string")
        : undefined;
      const result = cwd
        ? await revertWorkspaceDiff(cwd, paths)
        : ({ ok: false, error: "无法确定仓库目录" } as const);
      pushToWebview(win, {
        command: "desktopWorkspaceDiffReverted",
        paneId: msg.paneId,
        ok: result.ok,
        ...(result.ok ? {} : { error: result.error }),
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

    if (command === "desktopTerminalClear") {
      if (typeof msg.termId === "string") {
        terminalManager.clear(msg.termId);
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
