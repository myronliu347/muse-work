import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FROM_WEBVIEW,
  installWorkdirHost,
  loadPersistedWorkdirState,
  rememberWorkdir,
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
      hosts: [],
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
      hosts: [],
    });
    expect(loadPersistedWorkdirState(userData).workdir).toBe("/picked/project");
    fs.rmSync(userData, { recursive: true, force: true });
  });
});
