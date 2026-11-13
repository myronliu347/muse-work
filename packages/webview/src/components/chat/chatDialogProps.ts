import type { ChatDialogsProps } from "../dialogs/ChatDialogs";
import type { ChatAppCore } from "../../hooks/useChatAppCore";
import type { ChatState, DesktopHostProps, VsCodeApi } from "../../types";

export function buildChatDialogProps(input: {
  state: ChatState;
  vscode: VsCodeApi;
  host: DesktopHostProps | undefined;
  effectiveWorkdir?: string;
  quickOpenWorkdir?: string;
  quickOpenWorkdirs?: string[];
  /** Only the assistant search includes issues; 会话 searches files only. */
  quickOpenIssues: Array<{ id: string; title: string; type?: string }>;
  patchPane: ChatAppCore["patchPane"];
  handleConfigurationSave: ChatDialogsProps["onConfigurationSave"];
  handleDialogClose: () => void;
  handleOpenFile: ChatDialogsProps["onOpenFile"];
  handleLogin: () => void;
  agentTranscript: ChatDialogsProps["agentTranscript"];
  handleCloseAgentTranscript: () => void;
  pendingRewindId: string | null;
  handleRewindConfirm: () => void;
  toasts: ChatDialogsProps["toasts"];
  handleToastDismiss: ChatDialogsProps["onToastDismiss"];
  handleToastAction: ChatDialogsProps["onToastAction"];
  quickOpenOpen: boolean;
  quickOpenQuery: string;
  setQuickOpenOpen: (open: boolean) => void;
  setQuickOpenQuery: (query: string) => void;
  selectBotPanel: (panel: { kind: "issue"; issueId: string }) => void;
}): ChatDialogsProps {
  const {
    state,
    vscode,
    host,
    effectiveWorkdir,
    quickOpenWorkdir,
    quickOpenWorkdirs,
    quickOpenIssues,
    patchPane,
    handleConfigurationSave,
    handleDialogClose,
    handleOpenFile,
    handleLogin,
    agentTranscript,
    handleCloseAgentTranscript,
    pendingRewindId,
    handleRewindConfirm,
    toasts,
    handleToastDismiss,
    handleToastAction,
    quickOpenOpen,
    quickOpenQuery,
    setQuickOpenOpen,
    setQuickOpenQuery,
    selectBotPanel,
  } = input;
  return {
    activeDialog: state.activeDialog,
    configurationData: state.configurationData,
    configurationLoading: state.configurationLoading,
    configurationError: state.configurationError,
    onConfigurationSave: handleConfigurationSave,
    onDialogClose: handleDialogClose,
    vscode,
    workflowRuns: state.workflowRuns,
    onOpenFile: handleOpenFile,
    isAuthenticated: state.isAuthenticated,
    loginError: state.loginError,
    loginServiceName: state.loginServiceName,
    onLogin: handleLogin,
    agentTranscript,
    subagentMessages: state.subagentMessages,
    agentToolSubagentIds: state.agentToolSubagentIds,
    onCloseAgentTranscript: handleCloseAgentTranscript,
    pendingRewindId,
    onRewindConfirm: handleRewindConfirm,
    onCancelRewind: () => patchPane({ pendingRewindId: null }),
    toasts,
    onToastDismiss: handleToastDismiss,
    onToastAction: handleToastAction,
    quickOpenOpen,
    quickOpenQuery,
    onQuickOpenClose: () => {
      setQuickOpenOpen(false);
      setQuickOpenQuery("");
    },
    effectiveWorkdir,
    quickOpenWorkdir,
    quickOpenWorkdirs,
    quickOpenIssues,
    onQuickOpenIssue: (issueId: string) => {
      selectBotPanel({ kind: "issue", issueId });
    },
  };
}
