/**
 * Local PTY terminal for the desktop terminal panel (node-pty, lazy-loaded).
 */

import * as fs from "fs";

export interface TerminalExitInfo {
  exitCode?: number;
  error?: string;
}

interface PtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number }) => void): { dispose(): void };
}

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cwd: string;
      cols: number;
      rows: number;
      env: Record<string, string>;
    },
  ): PtyProcess;
}

let ptyModule: PtyModule | null | undefined;
let ptyLoadError = "";

async function loadPty(): Promise<PtyModule | null> {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = (await import("node-pty")) as unknown as PtyModule;
  } catch (err) {
    ptyLoadError = err instanceof Error ? err.message : String(err);
    ptyModule = null;
  }
  return ptyModule;
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === "win32") return { file: "powershell.exe", args: [] };
  for (const candidate of [process.env.SHELL, "/bin/zsh", "/bin/bash"]) {
    if (candidate && fs.existsSync(candidate)) {
      return { file: candidate, args: ["-l"] };
    }
  }
  return { file: "/bin/sh", args: ["-l"] };
}

export interface TerminalManagerCallbacks {
  onData: (termId: string, data: string) => void;
  onExit: (termId: string, info: TerminalExitInfo) => void;
}

interface TerminalEntry {
  proc: PtyProcess;
  disposables: Array<{ dispose(): void }>;
  buffer: string;
}

const BUFFER_CAP_BYTES = 256 * 1024;

export class TerminalManager {
  private terminals = new Map<string, TerminalEntry>();

  constructor(private callbacks: TerminalManagerCallbacks) {}

  async create(
    termId: string,
    cwd: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const existing = this.terminals.get(termId);
    if (existing) {
      try {
        existing.proc.resize(cols, rows);
      } catch {
        // ignore
      }
      if (existing.buffer) this.callbacks.onData(termId, existing.buffer);
      return;
    }
    // A deleted worktree leaves sessions pointing at a directory that no
    // longer exists; node-pty's helper then exits 1 without printing why.
    // Say it plainly instead of showing a bare exit code.
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(cwd).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) {
      this.callbacks.onExit(termId, {
        error: `工作目录不存在（可能已被删除）：${cwd}`,
      });
      return;
    }
    const pty = await loadPty();
    if (!pty) {
      this.callbacks.onExit(termId, {
        error: `终端组件加载失败：${ptyLoadError || "node-pty unavailable"}`,
      });
      return;
    }
    const shell = defaultShell();
    const env = {
      ...(process.env as Record<string, string>),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    };
    try {
      const proc = pty.spawn(shell.file, shell.args, {
        name: "xterm-256color",
        cwd,
        cols,
        rows,
        env,
      });
      const entry: TerminalEntry = { proc, disposables: [], buffer: "" };
      entry.disposables.push(
        proc.onData((data) => {
          entry.buffer = (entry.buffer + data).slice(-BUFFER_CAP_BYTES);
          this.callbacks.onData(termId, data);
        }),
        proc.onExit(({ exitCode }) => {
          if (this.terminals.get(termId) !== entry) return;
          this.terminals.delete(termId);
          this.callbacks.onExit(termId, { exitCode });
        }),
      );
      this.terminals.set(termId, entry);
    } catch (err) {
      this.callbacks.onExit(termId, {
        error: `终端启动失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  write(termId: string, data: string): void {
    this.terminals.get(termId)?.proc.write(data);
  }

  resize(termId: string, cols: number, rows: number): void {
    try {
      this.terminals.get(termId)?.proc.resize(cols, rows);
    } catch {
      // ignore
    }
  }

  /** Clear the replay buffer so a reattach no longer replays cleared output.
   * The pty process is left running — only the screen/buffer history is reset. */
  clear(termId: string): void {
    const entry = this.terminals.get(termId);
    if (!entry) return;
    entry.buffer = "";
  }

  kill(termId: string): void {
    const entry = this.terminals.get(termId);
    if (!entry) return;
    this.terminals.delete(termId);
    for (const d of entry.disposables) d.dispose();
    try {
      entry.proc.kill();
    } catch {
      // already dead
    }
  }

  killAll(): void {
    for (const termId of [...this.terminals.keys()]) this.kill(termId);
  }
}
