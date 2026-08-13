import React from "react";
import ReactDOM from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { ChatApp } from "./components/ChatApp";
import { DesktopApp } from "./components/DesktopApp";
import { MuseApiClient } from "./muse/apiClient";
import { MuseWsClient } from "./muse/wsClient";
import { createHostBridge, resolveMuseServerUrl } from "./muse/hostBridge";
import type { ThemePreference } from "./types";
import { MuseTheme } from "./ui/theme";
import "./styles/globals.css";
import "@vscode/codicons/dist/codicon.css";

declare global {
  interface Window {
    __MUSE_SERVER_URL__?: string;
    museServerUrl?: string;
    museServerBaseUrl?: string;
    museWorkdir?: string;
    waveHostType?: string;
    __MUSE_THEME_PREFERENCE__?: ThemePreference;
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
    {window.waveHostType === "desktop" ? (
      <DesktopApp vscode={vscode} />
    ) : (
      <ChatApp vscode={vscode} />
    )}
  </MuseTheme>,
);
