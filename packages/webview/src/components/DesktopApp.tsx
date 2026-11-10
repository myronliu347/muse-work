import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { ChatApp } from "./ChatApp";
import { VsCodeApi, OpenPaneOptions } from "../types";
import { useDesktopShell } from "../stores/desktopStore";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  issueFileGroupKey,
  prunePanelGroupCache,
  workdirTermId,
} from "../stores/panelGroupStore";
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
    issueGroups,
    closedIssueGroups,
    panes,
    rowHeights,
    focusedPaneId,
    setWorkdirState,
    setSessionTree,
    setIssueGroups,
    setClosedIssueGroups,
    setPanes,
  } = useDesktopShell();

  const sessionTreeRef = useRef(sessionTree);
  sessionTreeRef.current = sessionTree;
  const issueGroupsRef = useRef(issueGroups);
  issueGroupsRef.current = issueGroups;

  useEffect(() => {
    const prunePanels = () => {
      const keep = new Set<string>([ASSISTANT_PANEL_GROUP_KEY]);
      const currentWd =
        useDesktopStore.getState().workdirState?.workdir?.trim();
      if (currentWd) keep.add(currentWd);
      for (const g of sessionTreeRef.current) {
        for (const s of g.sessions) {
          if (s.workdir) keep.add(s.workdir);
        }
      }
      // 还开着的 Issue 目录要留着。已经关闭的 Issue 不占右侧面板，
      // 除非这个目录仍是当前工作区或别的会话在用。
      for (const g of issueGroupsRef.current) {
        keep.add(issueFileGroupKey(g.issueId));
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
        const prevHome = useDesktopStore.getState().workdirState?.homeDir;
        const homeDir =
          typeof message.homeDir === "string" && message.homeDir
            ? message.homeDir
            : prevHome;
        setWorkdirState({
          workdir: message.workdir,
          recentWorkdirs: message.recentWorkdirs ?? [],
          host: message.host ?? "local",
          ...(homeDir ? { homeDir } : {}),
        });
      } else if (message.command === "desktopSessionTree") {
        sessionTreeRef.current = message.groups ?? [];
        issueGroupsRef.current = message.issueGroups ?? [];
        setSessionTree(sessionTreeRef.current);
        setIssueGroups(issueGroupsRef.current);
        setClosedIssueGroups(message.closedIssueGroups ?? []);
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
  }, [vscode, setWorkdirState, setSessionTree, setIssueGroups, setClosedIssueGroups, setPanes]);

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

  const workdir = workdirState?.workdir;
  const recentWorkdirs = workdirState?.recentWorkdirs;
  const host = workdirState?.host;
  const desktopHost = useMemo(
    () => ({
      type: "desktop" as const,
      host,
      workdir,
      recentWorkdirs,
      onSelectWorkdir: handleSelectWorkdir,
      onSelectRecentWorkdir: handleSelectRecentWorkdir,
      onRemoveRecentWorkdir: handleRemoveRecentWorkdir,
      sessionTree,
      issueGroups,
      closedIssueGroups,
      onSelectSession: handleSelectSession,
      onDeleteSession: handleDeleteSession,
      onTogglePin: handleTogglePin,
      onRenameSession: handleRenameSession,
      onOpenPane: handleOpenPane,
      panes,
      rowHeights,
      focusedPaneId,
      homeDir: workdirState?.homeDir,
    }),
    [
      host,
      workdir,
      recentWorkdirs,
      handleSelectWorkdir,
      handleSelectRecentWorkdir,
      handleRemoveRecentWorkdir,
      sessionTree,
      issueGroups,
      closedIssueGroups,
      handleSelectSession,
      handleDeleteSession,
      handleTogglePin,
      handleRenameSession,
      handleOpenPane,
      panes,
      rowHeights,
      focusedPaneId,
      workdirState?.homeDir,
    ],
  );

  if (workdirState === null) {
    return (
      <div className="desktop-loading" data-testid="desktop-loading"></div>
    );
  }

  return <ChatApp vscode={vscode} host={desktopHost} />;
};

export default DesktopApp;
