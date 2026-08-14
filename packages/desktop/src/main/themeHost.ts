import {
  BrowserWindow,
  ipcMain,
  nativeTheme as electronNativeTheme,
} from "electron";
import { FROM_WEBVIEW, TO_WEBVIEW } from "./workdirHost.js";
import {
  loadUiPrefs,
  resolveEffectiveTheme,
  saveUiPrefs,
  windowBackgroundFor,
  type ThemeAccentColor,
  type ThemeGrayColor,
  type ThemePreference,
  type ThemeRadius,
  type ThemeScaling,
  type UiPrefsFile,
} from "./uiPrefs.js";

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isScaling(value: unknown): value is ThemeScaling {
  return (
    value === "90%" ||
    value === "95%" ||
    value === "100%" ||
    value === "105%" ||
    value === "110%"
  );
}

function isAccentColor(value: unknown): value is ThemeAccentColor {
  return (
    typeof value === "string" &&
    [
      "gray",
      "gold",
      "bronze",
      "brown",
      "yellow",
      "amber",
      "orange",
      "tomato",
      "red",
      "ruby",
      "crimson",
      "pink",
      "plum",
      "purple",
      "violet",
      "iris",
      "indigo",
      "blue",
      "cyan",
      "teal",
      "jade",
      "green",
      "grass",
      "lime",
      "mint",
      "sky",
    ].includes(value)
  );
}

function isRadius(value: unknown): value is ThemeRadius {
  return (
    value === "none" ||
    value === "small" ||
    value === "medium" ||
    value === "large" ||
    value === "full"
  );
}

function isGrayColor(value: unknown): value is ThemeGrayColor {
  return (
    value === "auto" ||
    value === "gray" ||
    value === "mauve" ||
    value === "slate" ||
    value === "sage" ||
    value === "olive" ||
    value === "sand"
  );
}

export function installThemeHost(opts: {
  getWindow: () => BrowserWindow | null;
  nativeTheme?: typeof electronNativeTheme;
  ipc?: Pick<typeof ipcMain, "on" | "removeListener">;
  home?: string;
}) {
  const nativeTheme = opts.nativeTheme ?? electronNativeTheme;
  const ipc = opts.ipc ?? ipcMain;
  let prefs: UiPrefsFile = loadUiPrefs(opts.home);
  nativeTheme.themeSource = prefs.themePreference;

  const effective = () =>
    resolveEffectiveTheme(
      prefs.themePreference,
      nativeTheme.shouldUseDarkColors,
    );

  const persist = () => {
    saveUiPrefs(prefs, opts.home);
  };

  const paint = () => {
    const win = opts.getWindow();
    win?.setBackgroundColor(windowBackgroundFor(effective()));
    win?.webContents.send(TO_WEBVIEW, {
      command: "desktopThemeChange",
      effective: effective(),
    });
  };

  const onIpc = (_event: unknown, message: unknown) => {
    const msg = message as {
      command?: string;
      preference?: unknown;
      scaling?: unknown;
      accentColor?: unknown;
      radius?: unknown;
      grayColor?: unknown;
    };
    if (msg?.command === "desktopSetThemePreference") {
      if (!isPreference(msg.preference)) return;
      prefs = { ...prefs, themePreference: msg.preference };
      persist();
      nativeTheme.themeSource = prefs.themePreference;
      paint();
      return;
    }
    if (msg?.command === "desktopSetThemeScaling") {
      if (!isScaling(msg.scaling)) return;
      prefs = { ...prefs, themeScaling: msg.scaling };
      persist();
      return;
    }
    if (msg?.command === "desktopSetThemeAccentColor") {
      if (!isAccentColor(msg.accentColor)) return;
      prefs = { ...prefs, themeAccentColor: msg.accentColor };
      persist();
      return;
    }
    if (msg?.command === "desktopSetThemeRadius") {
      if (!isRadius(msg.radius)) return;
      prefs = { ...prefs, themeRadius: msg.radius };
      persist();
      return;
    }
    if (msg?.command === "desktopSetThemeGrayColor") {
      if (!isGrayColor(msg.grayColor)) return;
      prefs = { ...prefs, themeGrayColor: msg.grayColor };
      persist();
    }
  };

  ipc.on(FROM_WEBVIEW, onIpc);
  nativeTheme.on("updated", paint);

  return {
    get preference() {
      return prefs.themePreference;
    },
    get scaling() {
      return prefs.themeScaling;
    },
    get accentColor() {
      return prefs.themeAccentColor;
    },
    get radius() {
      return prefs.themeRadius;
    },
    get grayColor() {
      return prefs.themeGrayColor;
    },
    get effective() {
      return effective();
    },
    dispose: () => {
      ipc.removeListener(FROM_WEBVIEW, onIpc);
      nativeTheme.off("updated", paint);
    },
  };
}
