import React, { useCallback, useEffect, useRef } from "react";
import { ChatApp } from "./ChatApp";
import { VsCodeApi, OpenPaneOptions } from "../types";
import { useDesktopShell } from "../stores/desktopStore";
import { prunePanelGroupCache, workdirTermId } from "../stores/panelGroupStore";
import { useDesktopStore } from "../stores/desktopStore";
import "../styles/DesktopApp.css";

interface DesktopAppProps {
  vscode: VsCodeApi;
}

/**
 * Root component for the desktop (Electron) host. Owns the workdir state pushed
 * by the main process and renders the shared ChatApp with a desktop sidebar.
 */
export const DesktopApp: React.FC<DesktopAppProps> = ({ vscode }) => {
  const {
    workdirState,
    sessionTree,
    panes,
    rowHeights,
    focusedPaneId,
    setWorkdirState,
    setSessionTree,
    setPanes,
  } = useDesktopShell();

  const sessionTreeRef = useRef(sessionTree);
  sessionTreeRef.current = sessionTree;

  useEffect(() => {
    const prunePanels = () => {
      const keep = new Set<string>();
      const currentWd =
        useDesktopStore.getState().workdirState?.workdir?.trim();
      if (currentWd) keep.add(currentWd);
      for (const g of sessionTreeRef.current) {
        for (const s of g.sessions) {
          if (s.workdir) keep.add(s.workdir);
        }
      }
      const removed = prunePanelGroupCache(keep);
      for (const path of removed) {
        vscode.postMessage({
          command: "desktopTerminalKill",
          termId: workdirTermId(path),
        });
      }
    };
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "desktopWorkdirState") {
        setWorkdirState({
          workdir: message.workdir,
          recentWorkdirs: message.recentWorkdirs ?? [],
          host: message.host ?? "local",
        });
      } else if (message.command === "desktopSessionTree") {
        sessionTreeRef.current = message.groups ?? [];
        setSessionTree(sessionTreeRef.current);
        prunePanels();
      } else if (message.command === "desktopPanes") {
        const nextPanes = message.panes ?? [];
        setPanes(nextPanes, message.rowHeights, message.focusedPaneId ?? null);
        prunePanels();
      }
    };
    window.addEventListener("message", handleMessage);
    vscode.postMessage({ command: "desktopReady" });
    return () => window.removeEventListener("message", handleMessage);
  }, [vscode, setWorkdirState, setSessionTree, setPanes]);

  const handleSelectWorkdir = useCallback(() => {
    vscode.postMessage({ command: "desktopSelectWorkdir" });
  }, [vscode]);

  const handleSelectRecentWorkdir = useCallback(
    (path: string, host?: string) => {
      vscode.postMessage({ command: "desktopSelectRecentWorkdir", path, host });
    },
    [vscode],
  );

  const handleRemoveRecentWorkdir = useCallback(
    (path: string, host?: string) => {
      vscode.postMessage({ command: "desktopRemoveRecentWorkdir", path, host });
    },
    [vscode],
  );

  const handleSelectSession = useCallback(
    (workdir: string, sessionId: string) => {
      vscode.postMessage({
        command: "desktopSelectSession",
        workdir,
        sessionId,
      });
    },
    [vscode],
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      vscode.postMessage({ command: "desktopDeleteSession", sessionId });
    },
    [vscode],
  );

  const handleTogglePin = useCallback(
    (sessionId: string, pinned: boolean) => {
      vscode.postMessage({
        command: "desktopTogglePinSession",
        sessionId,
        pinned,
      });
    },
    [vscode],
  );

  const handleRenameSession = useCallback(
    (sessionId: string, title: string) => {
      vscode.postMessage({
        command: "desktopRenameSession",
        sessionId,
        title,
      });
    },
    [vscode],
  );

  const handleOpenPane = useCallback(
    (workdir: string, sessionId: string, opts?: OpenPaneOptions) => {
      vscode.postMessage({
        command: "desktopOpenPane",
        workdir,
        sessionId,
        ...opts,
      });
    },
    [vscode],
  );

  if (workdirState === null) {
    return (
      <div className="desktop-loading" data-testid="desktop-loading"></div>
    );
  }

  const { workdir, recentWorkdirs, host } = workdirState;

  return (
    <ChatApp
      vscode={vscode}
      host={{
        type: "desktop",
        host,
        workdir,
        recentWorkdirs,
        onSelectWorkdir: handleSelectWorkdir,
        onSelectRecentWorkdir: handleSelectRecentWorkdir,
        onRemoveRecentWorkdir: handleRemoveRecentWorkdir,
        sessionTree,
        onSelectSession: handleSelectSession,
        onDeleteSession: handleDeleteSession,
        onTogglePin: handleTogglePin,
        onRenameSession: handleRenameSession,
        onOpenPane: handleOpenPane,
        panes,
        rowHeights,
        focusedPaneId,
      }}
    />
  );
};

export default DesktopApp;
