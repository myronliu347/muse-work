import { app, BrowserWindow, nativeImage, session, shell } from "electron";
import * as path from "path";
import {
  attachCloseFocusedShortcut,
  attachTabStepShortcut,
  TAB_STEP_CHANNEL,
} from "./tabStepShortcut";

export type CreateMainWindowOpts = {
  serverBaseUrl: string;
  backgroundColor: string;
  /** Absolute path to preload.cjs */
  preloadPath: string;
  /** Absolute path to webview/index.html */
  webviewHtmlPath: string;
  title?: string;
};

/** Guest pages stay out of the Muse window session. */
export const PREVIEW_PARTITION = "persist:muse-preview";

type PreviewSession = {
  clearCache: () => Promise<void>;
  clearStorageData: (options: { storages: Array<"cookies"> }) => Promise<void>;
};

/** Drop the preview guest's HTTP cache, or only its cookies. */
export async function clearPreviewGuestData(
  kind: "cache" | "cookies",
  ses: PreviewSession = session.fromPartition(PREVIEW_PARTITION),
): Promise<void> {
  if (kind === "cache") {
    await ses.clearCache();
    return;
  }
  await ses.clearStorageData({ storages: ["cookies"] });
}

type PreviewViewportTarget = {
  isDestroyed: () => boolean;
  enableDeviceEmulation: (parameters: {
    screenPosition: "desktop" | "mobile";
    screenSize: { width: number; height: number };
    viewPosition: { x: number; y: number };
    deviceScaleFactor: number;
    viewSize: { width: number; height: number };
    scale: number;
  }) => void;
  disableDeviceEmulation: () => void;
  debugger: {
    isAttached: () => boolean;
    attach: (protocolVersion: string) => void;
    sendCommand: (method: string, params?: object) => Promise<unknown>;
  };
};

export type PreviewViewportRequest = {
  command?: string;
  webContentsId?: number;
  width?: number;
  height?: number;
  scale?: number;
  mobile?: boolean;
};

function guestDebugger(contents: PreviewViewportTarget): PreviewViewportTarget["debugger"] | null {
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    return contents.debugger;
  } catch {
    // DevTools may already own the only debugger attachment.
    return contents.debugger.isAttached() ? contents.debugger : null;
  }
}

/** Set or clear the guest layout viewport (CSS pixels), not just the painted scale. */
export function applyPreviewViewport(
  msg: PreviewViewportRequest,
  fromId: (id: number) => PreviewViewportTarget | undefined,
): void {
  if (typeof msg.webContentsId !== "number") return;
  const contents = fromId(msg.webContentsId);
  if (!contents || contents.isDestroyed()) return;
  const dbg = guestDebugger(contents);
  if (msg.command === "previewClearViewport") {
    contents.disableDeviceEmulation();
    void dbg?.sendCommand("Emulation.clearDeviceMetricsOverride").catch(() => {});
    return;
  }
  if (msg.command !== "previewSetViewport") return;
  const { width, height } = msg;
  if (typeof width !== "number" || typeof height !== "number") return;
  if (width < 200 || height < 200 || width > 3840 || height > 3840) return;
  const mobile = msg.mobile === true;
  const scale =
    typeof msg.scale === "number" && msg.scale > 0 && msg.scale <= 1 ? msg.scale : 1;
  // deviceScaleFactor 1 keeps the layout viewport in CSS pixels.
  // scale fits that viewport into the panel without changing its CSS size.
  contents.enableDeviceEmulation({
    screenPosition: mobile ? "mobile" : "desktop",
    screenSize: { width, height },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 1,
    viewSize: { width, height },
    scale,
  });
  void dbg
    ?.sendCommand("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      scale,
      screenWidth: width,
      screenHeight: height,
    })
    .catch(() => {});
}

export function lockPreviewWebviewAttach(
  webPreferences: {
    nodeIntegration?: boolean;
    contextIsolation?: boolean;
    sandbox?: boolean;
  },
  params: { partition?: string },
): void {
  params.partition = PREVIEW_PARTITION;
  webPreferences.nodeIntegration = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
}

/** A popup or target=_blank loads in the same preview instead of a new window. */
export function attachPreviewGuestOpener(contents: {
  loadURL: (url: string) => Promise<void> | void;
  setWindowOpenHandler: (
    handler: (details: { url: string }) => { action: "deny" },
  ) => void;
}): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) || url.startsWith("file:")) {
      void contents.loadURL(url);
    }
    return { action: "deny" };
  });
}

let previewGuestPolicyInstalled = false;

export function installPreviewGuestPolicy(): void {
  if (previewGuestPolicyInstalled) return;
  previewGuestPolicyInstalled = true;
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    attachPreviewGuestOpener(contents);
    attachTabStepShortcut(contents, (direction) => {
      const host = contents.hostWebContents;
      if (!host || host.isDestroyed()) return;
      host.send(TAB_STEP_CHANNEL, { command: "desktopStepTab", direction });
    });
    attachCloseFocusedShortcut(contents, () => {
      const host = contents.hostWebContents;
      if (!host || host.isDestroyed()) return;
      host.send(TAB_STEP_CHANNEL, { command: "desktopCloseFocused" });
    });
  });
}

/**
 * Create the single Muse BrowserWindow and load the synced webview.
 * Server base URL is passed via additionalArguments for the preload to expose.
 */
export function createMainWindow(opts: CreateMainWindowOpts): BrowserWindow {
  const packageRoot = path.join(path.dirname(opts.preloadPath), "..", "..");
  const icon = nativeImage.createFromPath(
    path.join(packageRoot, "assets", "icon.png"),
  );

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    title: opts.title ?? "Muse",
    show: false,
    backgroundColor: opts.backgroundColor,
    icon: icon.isEmpty() ? undefined : icon,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 12 },
        }
      : {}),
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Required for PreviewPane's <webview> guest (Electron ≥5 defaults this off).
      webviewTag: true,
      additionalArguments: [
        `--muse-server-url=${opts.serverBaseUrl}`,
      ],
    },
  });

  win.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
    lockPreviewWebviewAttach(webPreferences, params);
  });
  attachTabStepShortcut(win.webContents, (direction) => {
    if (win.isDestroyed()) return;
    win.webContents.send(TAB_STEP_CHANNEL, {
      command: "desktopStepTab",
      direction,
    });
  });
  attachCloseFocusedShortcut(win.webContents, () => {
    if (win.isDestroyed()) return;
    win.webContents.send(TAB_STEP_CHANNEL, { command: "desktopCloseFocused" });
  });
  installPreviewGuestPolicy();

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:")) return;
    event.preventDefault();
    if (/^https?:/.test(url)) {
      void shell.openExternal(url);
    }
  });

  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });

  void win.loadFile(opts.webviewHtmlPath);
  attachRendererRecovery(win);
  return win;
}

export function attachRendererRecovery(win: {
  isDestroyed: () => boolean;
  reload: () => void;
  on?: (event: "unresponsive", listener: () => void) => void;
  webContents: {
    on: (
      event: "render-process-gone",
      listener: (
        event: unknown,
        details: { reason: string },
      ) => void,
    ) => void;
  };
}): void {
  const reloadIfAlive = () => {
    if (win.isDestroyed()) return;
    win.reload();
  };
  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    reloadIfAlive();
  });
  win.on?.("unresponsive", reloadIfAlive);
}

export type DesktopPathsOpts = {
  /** When true, resolve muse-server from Electron resources (packaged app). */
  isPackaged?: boolean;
  /** `process.resourcesPath` in the packaged app. */
  resourcesPath?: string;
};

/** Resolve package-root-relative paths from dist/main. */
export function desktopPaths(
  dirname = __dirname,
  opts: DesktopPathsOpts = {},
): {
  preloadPath: string;
  webviewHtmlPath: string;
  serverEntry: string;
} {
  const packageRoot = path.join(dirname, "..", "..");
  const serverEntry = opts.isPackaged
    ? path.join(
        opts.resourcesPath ?? process.resourcesPath,
        "muse-server",
        "dist",
        "index.js",
      )
    : path.join(packageRoot, "..", "server", "dist", "index.js");
  return {
    preloadPath: path.join(dirname, "preload.cjs"),
    webviewHtmlPath: path.join(packageRoot, "webview", "index.html"),
    serverEntry,
  };
}
