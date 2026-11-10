import type React from "react";
import { AssistantNotice } from "../assistant/museBotNotice";
import { AutomationsPage } from "../automation/AutomationsPage";
import { ChatDialogs, type ChatDialogsProps } from "../dialogs/ChatDialogs";
import ConfigDialog, { settingsPageLeaveBlocked, type ConfigDialogHandle } from "../dialogs/ConfigDialog";
import { DesktopSessionList } from "../desktop/DesktopSessionList";
import { DesktopShell } from "../desktop/DesktopShell";
import { DesktopSidebar, resolveSidebarSessions } from "../desktop/DesktopSidebar";
import { DesktopSidebarToggle } from "../desktop/DesktopSidebarToggle";
import type { BotWorkspaceContextValue } from "../desktop/BotTabs";
import type { ShellSurface } from "../desktop/shellSurface";
import { NewIssueDialog } from "../issue/NewIssueDialog";
import { OpenPlanningDialog } from "../issue/OpenPlanningDialog";
import { SkillsPage } from "../skills/SkillsPage";
import type { MuseApiClient } from "../../muse/apiClient";
import type { ChatState, ConfigurationData, DesktopHostProps, VsCodeApi } from "../../types";

type AppView = "newChat" | "chat" | "automations" | "skills" | "assistant";

/** Desktop chrome around one chat: split-view shell, a single pane, or the no-pane sidebar. */
export function DesktopChatLayout({
  host,
  paneId,
  vscode,
  workspace,
  state,
  museApi,
  postToHost,
  dialogProps,
  assistantFrame,
  chatContainer,
  providedShellSurface,
  view,
  setView,
  noPaneRail,
  setNoPaneRail,
  settingsPageRef,
  showNewIssue,
  setShowNewIssue,
  planningIssueId,
  setPlanningIssueId,
  handleSelectIssue,
  handleLogin,
  handleConfigurationSave,
  handleDesktopNewSession,
  handleDesktopNewSessionInWorkdir,
  sidebarCollapsed,
  contentInset,
  sidebarWidth,
  sessionListWidth,
  setSessionListWidth,
}: {
  host: DesktopHostProps;
  paneId: string | undefined;
  vscode: VsCodeApi;
  workspace: BotWorkspaceContextValue;
  state: ChatState;
  museApi: MuseApiClient;
  postToHost: (message: Record<string, unknown>) => void;
  dialogProps: ChatDialogsProps;
  assistantFrame: React.ReactNode;
  chatContainer: React.ReactNode;
  providedShellSurface: ShellSurface | null;
  view: AppView;
  setView: (view: AppView) => void;
  noPaneRail: ShellSurface;
  setNoPaneRail: (surface: ShellSurface) => void;
  settingsPageRef: React.RefObject<ConfigDialogHandle>;
  showNewIssue: boolean;
  setShowNewIssue: (open: boolean) => void;
  planningIssueId: string | null;
  setPlanningIssueId: (issueId: string | null) => void;
  handleSelectIssue: (issueId: string) => void;
  handleLogin: () => void;
  handleConfigurationSave: (configData: ConfigurationData) => void;
  handleDesktopNewSession: () => void;
  handleDesktopNewSessionInWorkdir: (workdir: string) => void;
  sidebarCollapsed: boolean;
  contentInset: number;
  sidebarWidth: number;
  sessionListWidth: number;
  setSessionListWidth: (width: number) => void;
}) {
    const refreshSessionTree = () =>
      postToHost({ command: "desktopRefreshSessionTree" });
    const issueSidebarProps = {
      issueGroups: host.issueGroups,
      closedIssueGroups: host.closedIssueGroups,
      onNewIssue: () => setShowNewIssue(true),
      onSelectIssue: (issueId: string) => {
        setView("chat");
        handleSelectIssue(issueId);
      },
      onOpenPlanning: (issueId: string) => setPlanningIssueId(issueId),
      onCompleteIssue: (issueId: string, note: string) => {
        void museApi
          .completeIssue(issueId, note)
          .then(refreshSessionTree)
          .catch((err) => {
            window.alert(
              err instanceof Error ? err.message : "完成 Issue 失败",
            );
          });
      },
      onCancelIssue: (issueId: string, note: string) => {
        void museApi
          .cancelIssue(issueId, note)
          .then(refreshSessionTree)
          .catch((err) => {
            window.alert(
              err instanceof Error ? err.message : "取消 Issue 失败",
            );
          });
      },
    };
    const newIssueDialog = showNewIssue ? (
      <NewIssueDialog
        api={museApi}
        onCancel={() => setShowNewIssue(false)}
        onCreated={() => {
          setShowNewIssue(false);
          refreshSessionTree();
        }}
      />
    ) : null;
    const openPlanningDialog = planningIssueId ? (
      <OpenPlanningDialog
        issueId={planningIssueId}
        api={museApi}
        postToHost={postToHost}
        recentWorkdirs={host.recentWorkdirs}
        onCancel={() => setPlanningIssueId(null)}
        onOpened={({ sessionId, workdir }) => {
          setPlanningIssueId(null);
          host.onSelectSession(workdir, sessionId);
          refreshSessionTree();
        }}
      />
    ) : null;

    // FR-032 split-view: when the host has pushed a pane layout, DesktopShell
    // owns the row of paneId-scoped ChatApp instances. This instance then only
    // contributes its pane-scoped chatContainer (rendered below); without a
    // paneId it would double-render, so bail out to the shell instead.
    if ((host.panes?.length ?? 0) > 0 && paneId === undefined) {
      return (
        <>
          <DesktopShell
            vscode={vscode}
            host={host}
            workspace={workspace}
            onLogin={handleLogin}
            isAuthenticated={state.isAuthenticated}
            configurationData={state.configurationData}
            configurationLoading={state.configurationLoading}
            configurationError={state.configurationError}
            onConfigurationSave={handleConfigurationSave}
            api={museApi}
            postToHost={postToHost}
            {...issueSidebarProps}
          />
          {newIssueDialog}
          {openPlanningDialog}
          <ChatDialogs {...dialogProps} />
        </>
      );
    }
    // Inside DesktopShell each pane renders only its own chatContainer; the
    // sidebar / preview pane live in the shell / single-pane layout.
    // 助理占中间栏，右侧是助手自己的文件、终端和浏览器。
    const showAssistantInPane =
      paneId !== undefined &&
      providedShellSurface === "assistant" &&
      (host.focusedPaneId ?? paneId) === paneId;
    if (paneId !== undefined) {
      return (
        <>
          {showAssistantInPane ? assistantFrame : chatContainer}
          <ChatDialogs {...dialogProps} />
        </>
      );
    }
    return (
      <div
        className="desktop-layout"
        data-sidebar-collapsed={sidebarCollapsed ? "true" : undefined}
        style={
          {
            "--desktop-sidebar-width": `${contentInset}px`,
            "--desktop-sidebar-drawer-width": `${sidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <AssistantNotice
          onOpen={() => {
            if (
              settingsPageLeaveBlocked(
                noPaneRail,
                "assistant",
                settingsPageRef.current,
              )
            ) {
              return;
            }
            setNoPaneRail("assistant");
            setView("assistant");
            workspace.focusTab("bot");
          }}
        />
        {noPaneRail === "sessions" ? <DesktopSidebarToggle /> : null}
        <DesktopSidebar
          onNewSession={() => {
            setView("chat");
            handleDesktopNewSession();
          }}
          onNewSessionInPane={() => {
            setView("chat");
            postToHost({ command: "desktopNewSessionInPane" });
          }}
          onNewSessionInWorkdir={handleDesktopNewSessionInWorkdir}
          isStreaming={state.isStreaming}
          disabled={false}
          onOpenSettings={() => {
            setNoPaneRail("settings");
            vscode.postMessage({ command: "getConfiguration" });
          }}
          onLogin={handleLogin}
          isAuthenticated={state.isAuthenticated}
          {...resolveSidebarSessions({ sessionTree: host.sessionTree })}
          {...issueSidebarProps}
          currentSessionId={
            view === "assistant" || view === "automations" || view === "skills"
              ? undefined
              : state.currentSession?.id
          }
          onSelectSession={(workdir, sessionId) => {
            setView("chat");
            host.onSelectSession(workdir, sessionId);
          }}
          onOpenPane={host.onOpenPane}
          onDeleteSession={host.onDeleteSession}
          onTogglePin={host.onTogglePin}
          onRenameSession={host.onRenameSession}
          onOpenInEditor={(workdir) =>
            postToHost({ command: "desktopOpenInEditor", workdir })
          }
          onOpenInTerminal={(workdir) =>
            postToHost({ command: "desktopOpenInTerminal", workdir })
          }
          onRevealInFinder={(workdir) =>
            postToHost({ command: "revealInFinder", path: workdir })
          }
          onOpenSessions={() => {
            if (
              settingsPageLeaveBlocked(
                noPaneRail,
                "sessions",
                settingsPageRef.current,
              )
            ) {
              return;
            }
            setNoPaneRail("sessions");
            setView("chat");
          }}
          onOpenAutomations={() => {
            if (
              settingsPageLeaveBlocked(
                noPaneRail,
                "automations",
                settingsPageRef.current,
              )
            ) {
              return;
            }
            setNoPaneRail("automations");
            setView("automations");
          }}
          onOpenSkills={() => {
            if (
              settingsPageLeaveBlocked(
                noPaneRail,
                "skills",
                settingsPageRef.current,
              )
            ) {
              return;
            }
            setNoPaneRail("skills");
            setView("skills");
          }}
          onOpenAssistant={() => {
            if (
              settingsPageLeaveBlocked(
                noPaneRail,
                "assistant",
                settingsPageRef.current,
              )
            ) {
              return;
            }
            setNoPaneRail("assistant");
            setView("assistant");
          }}
          activeMenu={noPaneRail}
        />
        {noPaneRail === "sessions" ? (
          <DesktopSessionList
            onNewSession={() => {
              setNoPaneRail("sessions");
              setView("chat");
              handleDesktopNewSession();
            }}
            onNewSessionInWorkdir={handleDesktopNewSessionInWorkdir}
            isStreaming={state.isStreaming}
            disabled={false}
            {...resolveSidebarSessions({ sessionTree: host.sessionTree })}
            currentSessionId={
              view === "assistant" || view === "automations" || view === "skills"
                ? undefined
                : state.currentSession?.id
            }
            onSelectSession={(workdir, sessionId) => {
              setView("chat");
              host.onSelectSession(workdir, sessionId);
            }}
            onOpenPane={host.onOpenPane}
            onDeleteSession={host.onDeleteSession}
            onTogglePin={host.onTogglePin}
            onRenameSession={host.onRenameSession}
            onOpenInEditor={(workdir) =>
              postToHost({ command: "desktopOpenInEditor", workdir })
            }
            onOpenInTerminal={(workdir) =>
              postToHost({ command: "desktopOpenInTerminal", workdir })
            }
            onRevealInFinder={(workdir) =>
              postToHost({ command: "revealInFinder", path: workdir })
            }
            width={sessionListWidth}
            onWidthChange={setSessionListWidth}
          />
        ) : null}
        {noPaneRail === "settings" ? (
          <ConfigDialog
            ref={settingsPageRef}
            layout="page"
            vscode={vscode}
            configurationData={state.configurationData || {}}
            isLoading={state.configurationLoading}
            error={state.configurationError}
            onSave={handleConfigurationSave}
            onCancel={() => {}}
            isAuthenticated={state.isAuthenticated}
            onLogin={handleLogin}
          />
        ) : noPaneRail === "skills" ? (
          <SkillsPage
            api={museApi}
            onRunInTerminal={(command) =>
              postToHost({ command: "desktopRunInTerminal", text: command })
            }
          />
        ) : view === "automations" ? (
          <AutomationsPage
            api={museApi}
            postToHost={postToHost}
            recentWorkdirs={host.recentWorkdirs ?? []}
          />
        ) : view === "assistant" ? (
          assistantFrame
        ) : (
          chatContainer
        )}
        {newIssueDialog}
        {openPlanningDialog}
        <ChatDialogs {...dialogProps} />
      </div>
    );
}
