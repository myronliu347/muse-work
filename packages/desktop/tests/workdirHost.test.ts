import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FROM_WEBVIEW,
  installWorkdirHost,
  isTransientWorkdir,
  loadPersistedWorkdirState,
  rememberWorkdir,
  resolveDarwinTerminalApp,
  savePersistedWorkdirState,
  TO_WEBVIEW,
  type WorkdirHostState,
} from "../src/main/workdirHost.js";

describe("workdirHost state helpers", () => {
  it("rememberWorkdir updates current and recent list", () => {
    const state: WorkdirHostState = {
      recentWorkdirs: ["/a", "/b"],
      host: "local",
    };
    rememberWorkdir(state, "/b");
    expect(state.workdir).toBe("/b");
    expect(state.recentWorkdirs).toEqual(["/b", "/a"]);
  });

  it("rememberWorkdir skips transient workdirs in recents but keeps current", () => {
    const state: WorkdirHostState = {
      recentWorkdirs: ["/a"],
      host: "local",
    };
    rememberWorkdir(state, "/Users/me/.muse-work/projects/20260818-abc123");
    expect(state.workdir).toBe("/Users/me/.muse-work/projects/20260818-abc123");
    expect(state.recentWorkdirs).toEqual(["/a"]);
  });

  it("persists and reloads workdir state", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-persist-"));
    const state: WorkdirHostState = {
      workdir: "/proj",
      recentWorkdirs: ["/proj", "/other"],
      host: "local",
    };
    savePersistedWorkdirState(dir, state);
    expect(loadPersistedWorkdirState(dir)).toEqual({
      workdir: "/proj",
      recentWorkdirs: ["/proj", "/other"],
      host: "local",
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loadPersistedWorkdirState drops transient recents", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-purge-"));
    const state: WorkdirHostState = {
      workdir: "/repo/.wave/worktrees/feat-x",
      recentWorkdirs: [
        "/repo/.wave/worktrees/feat-x",
        "/proj",
        "/Users/me/.muse-work/projects/20260818-abc123",
      ],
      host: "local",
    };
    savePersistedWorkdirState(dir, state);
    expect(loadPersistedWorkdirState(dir)).toEqual({
      workdir: "/repo/.wave/worktrees/feat-x",
      recentWorkdirs: ["/proj"],
      host: "local",
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("isTransientWorkdir", () => {
  it("flags server-minted ~/.muse-work project scratch dirs", () => {
    expect(
      isTransientWorkdir("/Users/me/.muse-work/projects/20260818-abc123"),
    ).toBe(true);
  });

  it("flags worktree dirs under .wave/worktrees", () => {
    expect(isTransientWorkdir("/repo/.wave/worktrees/feat-x")).toBe(true);
  });

  it("keeps regular project dirs", () => {
    expect(isTransientWorkdir("/Users/me/projects/muse-work")).toBe(false);
    expect(isTransientWorkdir("/Users/me/foo/.wave")).toBe(false);
    expect(isTransientWorkdir("C:\\dev\\project")).toBe(false);
  });
});

describe("installWorkdirHost", () => {
  it("desktopReady pushes default workdir via injectable ipc", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-host-"));
    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: "/tmp/default-wd",
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    expect(handler).toBeTypeOf("function");
    await handler!({ sender: {} }, { command: "desktopReady" });

    expect(sent).toContainEqual({
      command: "desktopWorkdirState",
      workdir: "/tmp/default-wd",
      recentWorkdirs: [],
      host: "local",
    });

    // Folder pick path
    sent.length = 0;
    await handler!(
      { sender: {} },
      { command: "desktopSelectWorkdir" },
    );
    // canceled → no push
    expect(sent).toEqual([]);

    (host as { dispose: () => void }).dispose();
    // silence unused
    expect(FROM_WEBVIEW).toBe("muse:from-webview");
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("desktopSelectWorkdir remembers picked folder", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-pick-"));
    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({
        canceled: false,
        filePaths: ["/picked/project"],
      }),
    });

    await handler!({ sender: {} }, { command: "desktopSelectWorkdir" });
    expect(sent).toContainEqual({
      command: "desktopWorkdirState",
      workdir: "/picked/project",
      recentWorkdirs: ["/picked/project"],
      host: "local",
    });
    expect(loadPersistedWorkdirState(userData).workdir).toBe("/picked/project");
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("openFile replies with desktopFileContent", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-file-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sample-"));
    const sample = path.join(dir, "nasl.extension.json");
    fs.writeFileSync(sample, '{"name":"demo"}\n', "utf8");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!({ sender: {} }, { command: "openFile", path: sample });
    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "desktopFileContent",
        fileView: expect.objectContaining({
          path: sample,
          content: expect.stringContaining('"name":"demo"'),
        }),
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("openFile embeds workdir-relative markdown images", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-file-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sample-"));
    fs.mkdirSync(path.join(dir, "docs"));
    fs.writeFileSync(path.join(dir, "docs", "img.png"), Buffer.from([1, 2, 3]));
    const md = path.join(dir, "README.md");
    fs.writeFileSync(md, "![shot](docs/img.png)\n", "utf8");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      { command: "openFile", path: md, workdir: dir },
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "desktopFileContent",
        fileView: expect.objectContaining({
          path: md,
          content: expect.stringContaining(
            "![shot](data:image/png;base64,AQID)",
          ),
        }),
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("openFile resolves workdir-relative paths and opens the file", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-rel-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rel-open-"));
    fs.writeFileSync(path.join(dir, "README.md"), "# hello\n", "utf8");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      { command: "openFile", path: "README.md", workdir: dir },
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "desktopFileContent",
        fileView: expect.objectContaining({
          path: path.join(dir, "README.md"),
          content: expect.stringContaining("# hello"),
        }),
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("openFile falls back to a workdir-wide basename search when direct path misses", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-fb-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-fb-open-"));
    // Link points at docs/hello.ts but the file actually lives in src/hello.ts.
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "hello.ts"), "export const a = 1\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      { command: "openFile", path: "docs/hello.ts", workdir: dir },
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "desktopFileContent",
        fileView: expect.objectContaining({
          path: path.join(dir, "src", "hello.ts"),
          content: expect.stringContaining("export const a = 1"),
        }),
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("openFile reports not found when the basename is absent from the workdir", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-nf-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-nf-open-"));
    fs.writeFileSync(path.join(dir, "other.ts"), "export {}\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      { command: "openFile", path: "missing.ts", workdir: dir },
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "desktopFileContent",
        fileView: expect.objectContaining({
          path: path.join(dir, "missing.ts"),
          error: expect.stringContaining("文件不存在"),
        }),
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("revealInFinder calls showItemInFolder", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-reveal-"));
    const showItemInFolder = vi.fn();
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: () => {} },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showItemInFolder,
    });

    await handler!(
      { sender: {} },
      { command: "revealInFinder", path: "/tmp/a.ts" },
    );
    expect(showItemInFolder).toHaveBeenCalledWith("/tmp/a.ts");

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("desktopOpenFileExternal opens the path with the system app", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-open-"));
    const openPath = vi.fn().mockResolvedValue("");
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: () => {} },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      openPath,
    });

    await handler!(
      { sender: {} },
      { command: "desktopOpenFileExternal", path: "/tmp/page.html" },
    );
    expect(openPath).toHaveBeenCalledWith("/tmp/page.html");

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("desktopListDir replies with entries", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-listdir-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-listdir-"));
    fs.writeFileSync(path.join(dir, "a.ts"), "export {}\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      { command: "desktopListDir", requestId: "r1", dir: "" },
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "desktopListDirResult",
        requestId: "r1",
        dir: "",
        entries: expect.arrayContaining([
          expect.objectContaining({
            name: "a.ts",
            isDirectory: false,
          }),
        ]),
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("desktopSearchContent replies with matches", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-cs-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-ipc-"));
    fs.writeFileSync(path.join(dir, "a.ts"), "hello world\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      {
        command: "desktopSearchContent",
        requestId: "cs1",
        workdir: dir,
        query: "hello",
        caseSensitive: false,
      },
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "desktopSearchContentResult",
        requestId: "cs1",
        totalMatches: 1,
        results: [
          expect.objectContaining({
            relativePath: "a.ts",
          }),
        ],
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("requestFileSuggestions replies with matching workspace files", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-sug-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sug-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "hello.ts"), "export {}\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      {
        command: "requestFileSuggestions",
        filterText: "hello",
        requestId: "req-1",
      },
    );

    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "fileSuggestionsResponse",
        requestId: "req-1",
        filterText: "hello",
        suggestions: expect.arrayContaining([
          expect.objectContaining({
            name: "hello.ts",
            relativePath: "src/hello.ts",
            isDirectory: false,
          }),
        ]),
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("requestFileSuggestions with empty filter lists dir children only", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-ls-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ls-host-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
    fs.writeFileSync(path.join(dir, "src", "hello.ts"), "export {}\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      {
        command: "requestFileSuggestions",
        filterText: "",
        dir: "src",
        requestId: "req-ls",
      },
    );

    const reply = sent.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { command?: string }).command === "fileSuggestionsResponse",
    ) as { suggestions: Array<{ name: string; relativePath: string }> };

    expect(reply.suggestions.map((s) => s.relativePath)).toEqual(["src/hello.ts"]);
    expect(reply.suggestions.some((s) => s.name === "README.md")).toBe(false);

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("requestFileSuggestions uses msg.workdir when host state has none", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-sug-wd-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sug-wd-"));
    fs.writeFileSync(path.join(dir, "a.ts"), "export {}\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      // no defaultWorkdir → state.workdir undefined
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      {
        command: "requestFileSuggestions",
        filterText: "",
        dir: "",
        requestId: "req-wd",
        workdir: dir,
      },
    );

    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "fileSuggestionsResponse",
        requestId: "req-wd",
        suggestions: expect.arrayContaining([
          expect.objectContaining({ name: "a.ts" }),
        ]),
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("requestFileSuggestions with query ignores dir and searches globally", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-q-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-q-host-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.mkdirSync(path.join(dir, "other"));
    fs.writeFileSync(path.join(dir, "src", "hello.ts"), "export {}\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      {
        command: "requestFileSuggestions",
        filterText: "hello",
        dir: "other",
        requestId: "req-q",
      },
    );

    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "fileSuggestionsResponse",
        requestId: "req-q",
        suggestions: expect.arrayContaining([
          expect.objectContaining({
            name: "hello.ts",
            relativePath: "src/hello.ts",
          }),
        ]),
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("desktopGetWorkspaceDiff and desktopListGitBranches reply", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-diff-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-diff-host-"));
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["-c", "init.templateDir=", "init"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "x.txt"), "1\n");
    execFileSync("git", ["add", "x.txt"], { cwd: dir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "i"], {
      cwd: dir,
    });
    fs.writeFileSync(path.join(dir, "x.txt"), "1\n2\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      {
        command: "desktopGetWorkspaceDiff",
        paneId: "p1",
        workdir: dir,
      },
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "desktopWorkspaceDiff",
        paneId: "p1",
        result: expect.objectContaining({ kind: "ok" }),
      }),
    );

    sent.length = 0;
    await handler!(
      { sender: {} },
      {
        command: "desktopListGitBranches",
        paneId: "p1",
        workdir: dir,
      },
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "desktopGitBranches",
        paneId: "p1",
        result: expect.objectContaining({
          branches: expect.any(Array),
          current: expect.any(String),
        }),
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("desktopRevertWorkspaceDiff replies and restores file", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-rv-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-host-"));
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["-c", "init.templateDir=", "init"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "x.txt"), "1\n");
    execFileSync("git", ["add", "x.txt"], { cwd: dir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "i"], {
      cwd: dir,
    });
    fs.writeFileSync(path.join(dir, "x.txt"), "1\n2\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      {
        command: "desktopRevertWorkspaceDiff",
        paneId: "p1",
        workdir: dir,
        paths: ["x.txt"],
      },
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "desktopWorkspaceDiffReverted",
        paneId: "p1",
        ok: true,
      }),
    );
    expect(fs.readFileSync(path.join(dir, "x.txt"), "utf8")).toBe("1\n");

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("desktopOpenInEditor runs code with the workdir", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-code-"));
    const opened: string[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: () => {} },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      openInEditor: (workdir) => {
        opened.push(workdir);
      },
    });

    await handler!(
      { sender: {} },
      { command: "desktopOpenInEditor", workdir: "/repo/beta" },
    );
    expect(opened).toEqual(["/repo/beta"]);

    opened.length = 0;
    await handler!({ sender: {} }, { command: "desktopOpenInEditor" });
    expect(opened).toEqual([]);

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("desktopOpenInTerminal runs openInTerminal with the workdir", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-term-"));
    const opened: string[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: () => {} },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      openInTerminal: (workdir) => {
        opened.push(workdir);
      },
    });

    await handler!(
      { sender: {} },
      { command: "desktopOpenInTerminal", workdir: "/repo/beta" },
    );
    expect(opened).toEqual(["/repo/beta"]);

    opened.length = 0;
    await handler!({ sender: {} }, { command: "desktopOpenInTerminal" });
    expect(opened).toEqual([]);

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("desktopSelectFiles opens multi file dialog and pushes paths", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-files-"));
    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ["/tmp/a.ts", "/tmp/b.md"],
    }));

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: "/proj",
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog,
    });

    await handler!({ sender: {} }, { command: "desktopSelectFiles" });

    expect(showOpenDialog).toHaveBeenCalledWith(
      fakeWin,
      expect.objectContaining({
        properties: expect.arrayContaining(["openFile", "multiSelections"]),
        defaultPath: "/proj",
      }),
    );
    expect(sent).toContainEqual({
      command: "desktopSelectFilesResult",
      paths: ["/tmp/a.ts", "/tmp/b.md"],
    });

    sent.length = 0;
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await handler!({ sender: {} }, { command: "desktopSelectFiles" });
    expect(sent).toEqual([]);

    (host as { dispose: () => void }).dispose();
    fs.rmSync(userData, { recursive: true, force: true });
  });
});

describe("resolveDarwinTerminalApp", () => {
  it("prefers iTerm when /Applications/iTerm.app exists", () => {
    expect(
      resolveDarwinTerminalApp((p) => p === "/Applications/iTerm.app"),
    ).toBe("iTerm");
  });

  it("prefers iTerm when iTerm2.app is in ~/Applications", () => {
    const home = "/Users/me";
    expect(
      resolveDarwinTerminalApp(
        (p) => p === path.join(home, "Applications", "iTerm2.app"),
        () => home,
      ),
    ).toBe("iTerm");
  });

  it("falls back to Terminal when iTerm is not installed", () => {
    expect(resolveDarwinTerminalApp(() => false, () => "/Users/me")).toBe(
      "Terminal",
    );
  });
});
