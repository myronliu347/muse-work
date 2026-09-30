import React from "react";
import ReactDOM from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { DesktopApp } from "./components/DesktopApp";
import { MuseApiClient } from "./muse/apiClient";
import { MuseWsClient } from "./muse/wsClient";
import { createHostBridge, resolveMuseServerUrl } from "./muse/hostBridge";
import type {
  ThemePreference,
  ThemeScaling,
  ThemeAccentColor,
  ThemeRadius,
  ThemeGrayColor,
} from "./types";
import { MuseTheme } from "./ui/theme";
import "./styles/globals.css";
import "@vscode/codicons/dist/codicon.css";

declare global {
  interface Window {
    __MUSE_SERVER_URL__?: string;
    museServerUrl?: string;
    museServerBaseUrl?: string;
    museWorkdir?: string;
    museHostType?: string;
    __MUSE_THEME_PREFERENCE__?: ThemePreference;
    __MUSE_THEME_SCALING__?: ThemeScaling;
    __MUSE_THEME_ACCENT__?: ThemeAccentColor;
    __MUSE_THEME_RADIUS__?: ThemeRadius;
    __MUSE_THEME_GRAY__?: ThemeGrayColor;
  }
}

const serverUrl = resolveMuseServerUrl();
const api = new MuseApiClient({ baseUrl: serverUrl });
const ws = new MuseWsClient({ baseUrl: serverUrl });

const outer =
  typeof window.acquireVsCodeApi === "function"
    ? window.acquireVsCodeApi()
    : {
        postMessage: () => {},
        getState: () => null,
        setState: () => {},
      };

const vscode = createHostBridge({
  api,
  ws,
  workdir: window.museWorkdir || "/",
  outer,
});

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <MuseTheme>
    <DesktopApp vscode={vscode} />
  </MuseTheme>,
);
