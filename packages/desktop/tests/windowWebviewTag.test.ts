import { describe, expect, it, vi } from "vitest";

// Capture BrowserWindow constructor options without launching Electron.
const ctorOpts: Array<Record<string, unknown>> = [];

vi.mock("electron", () => {
  class BrowserWindow {
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    };
    loadFile = vi.fn();
    isDestroyed = () => false;
    reload = vi.fn();
    on = vi.fn();
    constructor(opts: Record<string, unknown>) {
      ctorOpts.push(opts);
    }
  }
  return {
    BrowserWindow,
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true }),
    },
    shell: { openExternal: vi.fn() },
  };
});

import { createMainWindow } from "../src/main/window.js";

describe("createMainWindow", () => {
  it("enables webviewTag for the preview guest", () => {
    ctorOpts.length = 0;
    createMainWindow({
      serverBaseUrl: "http://127.0.0.1:8787",
      backgroundColor: "#000",
      preloadPath: "/tmp/preload.cjs",
      webviewHtmlPath: "/tmp/index.html",
    });
    expect(ctorOpts).toHaveLength(1);
    const prefs = (ctorOpts[0].webPreferences ?? {}) as Record<
      string,
      unknown
    >;
    expect(prefs.webviewTag).toBe(true);
  });
});
