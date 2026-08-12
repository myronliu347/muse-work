import React from "react";
import ReactDOM from "react-dom/client";
import { ChatApp } from "./components/ChatApp";
import { DesktopApp } from "./components/DesktopApp";
import { MuseApiClient } from "./muse/apiClient";
import { MuseWsClient } from "./muse/wsClient";
import { createHostBridge, resolveMuseServerUrl } from "./muse/hostBridge";
import "./styles/globals.css";
import "@vscode/codicons/dist/codicon.css";

declare global {
  interface Window {
    __MUSE_SERVER_URL__?: string;
    museServerUrl?: string;
    museWorkdir?: string;
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
  window.waveHostType === "desktop" ? (
    <DesktopApp vscode={vscode} />
  ) : (
    <ChatApp vscode={vscode} />
  ),
);
