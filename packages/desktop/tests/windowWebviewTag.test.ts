import { describe, expect, it, vi } from "vitest";

// Capture BrowserWindow constructor options without launching Electron.
const ctorOpts: Array<Record<string, unknown>> = [];

vi.mock("electron", () => {
  class BrowserWindow {
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
    };
    loadFile = vi.fn();
    isDestroyed = () => false;
    reload = vi.fn();
    on = vi.fn();
    once = vi.fn();
    show = vi.fn();
    constructor(opts: Record<string, unknown>) {
      ctorOpts.push(opts);
    }
  }
  return {
    app: { on: vi.fn() },
    BrowserWindow,
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true }),
    },
    shell: { openExternal: vi.fn() },
    session: {
      fromPartition: () => ({
        clearCache: vi.fn(),
        clearStorageData: vi.fn(),
      }),
    },
  };
});

import {
  applyPreviewViewport,
  attachPreviewGuestOpener,
  clearPreviewGuestData,
  createMainWindow,
  lockPreviewWebviewAttach,
  PREVIEW_PARTITION,
} from "../src/main/window.js";

describe("createMainWindow", () => {
  it("enables webviewTag for the preview guest", () => {
    ctorOpts.length = 0;
    const win = createMainWindow({
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
    expect(win.webContents.on).toHaveBeenCalledWith(
      "will-attach-webview",
      expect.any(Function),
    );
    const listener = win.webContents.on.mock.calls.find(
      (call) => call[0] === "before-input-event",
    )?.[1] as (
      event: { preventDefault: () => void },
      input: {
        type: string;
        key: string;
        code: string;
        meta: boolean;
        control: boolean;
        alt: boolean;
        shift: boolean;
      },
    ) => void;
    const event = { preventDefault: vi.fn() };
    const primary = process.platform === "darwin" ? { meta: true, control: false } : { meta: false, control: true };
    listener(event, {
      type: "keyDown",
      key: "]",
      code: "BracketRight",
      alt: false,
      shift: false,
      ...primary,
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith("muse:to-webview", {
      command: "desktopStepTab",
      direction: 1,
    });
  });

  it("isolates preview guests and opens popups in the same page", () => {
    const prefs = { nodeIntegration: true, contextIsolation: false, sandbox: false };
    const params: { partition?: string } = {};
    lockPreviewWebviewAttach(prefs, params);
    expect(params.partition).toBe(PREVIEW_PARTITION);
    expect(prefs).toEqual({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    });

    const loadURL = vi.fn();
    let handler: (details: { url: string }) => { action: string } = () => ({
      action: "allow",
    });
    attachPreviewGuestOpener({
      setWindowOpenHandler: (next) => {
        handler = next;
      },
      loadURL,
    });
    expect(handler({ url: "https://example.com/docs" })).toEqual({ action: "deny" });
    expect(loadURL).toHaveBeenCalledWith("https://example.com/docs");
    loadURL.mockClear();
    expect(handler({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(loadURL).not.toHaveBeenCalled();
  });

  it("uses a hiddenInset titlebar on macOS so traffic lights sit in the shell strip", () => {
    ctorOpts.length = 0;
    createMainWindow({
      serverBaseUrl: "http://127.0.0.1:8787",
      backgroundColor: "#000",
      preloadPath: "/tmp/preload.cjs",
      webviewHtmlPath: "/tmp/index.html",
    });
    if (process.platform === "darwin") {
      expect(ctorOpts[0].titleBarStyle).toBe("hiddenInset");
      expect(ctorOpts[0].trafficLightPosition).toEqual({ x: 14, y: 12 });
    } else {
      expect(ctorOpts[0].titleBarStyle).toBeUndefined();
    }
  });

  it("stays hidden until ready-to-show so the first paint is not a white flash", () => {
    ctorOpts.length = 0;
    const win = createMainWindow({
      serverBaseUrl: "http://127.0.0.1:8787",
      backgroundColor: "#111111",
      preloadPath: "/tmp/preload.cjs",
      webviewHtmlPath: "/tmp/index.html",
    });
    expect(ctorOpts[0].show).toBe(false);
    expect(ctorOpts[0].backgroundColor).toBe("#111111");
    expect(win.once).toHaveBeenCalledWith("ready-to-show", expect.any(Function));
  });

  it("clears the preview cache and cookies separately", async () => {
    const ses = {
      clearCache: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
    };
    await clearPreviewGuestData("cache", ses);
    expect(ses.clearCache).toHaveBeenCalledOnce();
    expect(ses.clearStorageData).not.toHaveBeenCalled();
    await clearPreviewGuestData("cookies", ses);
    expect(ses.clearStorageData).toHaveBeenCalledWith({ storages: ["cookies"] });
  });

  it("sets the guest layout viewport instead of only resizing the element", () => {
    const sendCommand = vi.fn(async () => {});
    const contents = {
      isDestroyed: () => false,
      enableDeviceEmulation: vi.fn(),
      disableDeviceEmulation: vi.fn(),
      debugger: {
        isAttached: () => false,
        attach: vi.fn(),
        sendCommand,
      },
    };
    const fromId = (id: number) => (id === 7 ? contents : undefined);
    applyPreviewViewport(
      { command: "previewSetViewport", webContentsId: 7, width: 384, height: 832, scale: 0.5, mobile: true },
      fromId,
    );
    expect(contents.enableDeviceEmulation).toHaveBeenCalledWith({
      screenPosition: "mobile",
      screenSize: { width: 384, height: 832 },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 1,
      viewSize: { width: 384, height: 832 },
      scale: 0.5,
    });
    expect(sendCommand).toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", {
      width: 384,
      height: 832,
      deviceScaleFactor: 1,
      mobile: true,
      scale: 0.5,
      screenWidth: 384,
      screenHeight: 832,
    });
    applyPreviewViewport({ command: "previewClearViewport", webContentsId: 7 }, fromId);
    expect(contents.disableDeviceEmulation).toHaveBeenCalledOnce();
  });
});
