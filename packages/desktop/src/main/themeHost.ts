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
  type ThemePreference,
} from "./uiPrefs.js";

export function installThemeHost(opts: {
  getWindow: () => BrowserWindow | null;
  nativeTheme?: typeof electronNativeTheme;
  ipc?: Pick<typeof ipcMain, "on" | "removeListener">;
  home?: string;
}) {
  const nativeTheme = opts.nativeTheme ?? electronNativeTheme;
  const ipc = opts.ipc ?? ipcMain;
  let preference = loadUiPrefs(opts.home).themePreference;
  nativeTheme.themeSource = preference;

  const effective = () =>
    resolveEffectiveTheme(preference, nativeTheme.shouldUseDarkColors);

  const paint = () => {
    const win = opts.getWindow();
    win?.setBackgroundColor(windowBackgroundFor(effective()));
    win?.webContents.send(TO_WEBVIEW, {
      command: "desktopThemeChange",
      effective: effective(),
    });
  };

  const onIpc = (_event: unknown, message: unknown) => {
    const msg = message as { command?: string; preference?: string };
    if (msg?.command !== "desktopSetThemePreference") return;
    if (
      msg.preference !== "system" &&
      msg.preference !== "light" &&
      msg.preference !== "dark"
    ) {
      return;
    }
    preference = msg.preference as ThemePreference;
    saveUiPrefs({ version: 1, themePreference: preference }, opts.home);
    nativeTheme.themeSource = preference;
    paint();
  };

  ipc.on(FROM_WEBVIEW, onIpc);
  nativeTheme.on("updated", paint);

  return {
    get preference() {
      return preference;
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
