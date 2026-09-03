import ConfigDialog from "./ConfigDialog";
import PluginDialog from "./PluginDialog";
import McpDialog from "./McpDialog";
import StatusDialog from "./StatusDialog";
import WorkflowManager from "../settings/WorkflowManager";
import AgentsDialog from "./AgentsDialog";
import LoginDialog from "./LoginDialog";
import { AgentTranscriptPopup } from "./AgentTranscriptPopup";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToastStack } from "../shared/ToastStack";
import { QuickOpenPalette } from "../panels/QuickOpenPalette";
import { resolveSubagentMessages } from "../../utils/subagentTranscript";
import type { AgentTranscriptState } from "../../stores";
import type {
  ChatState,
  ConfigurationData,
  Message,
  SerializableWorkflowRun,
  UpdateToast,
  VsCodeApi,
} from "../../types";

export interface ChatDialogsProps {
  activeDialog: ChatState["activeDialog"];
  configurationData?: ConfigurationData;
  configurationLoading: boolean;
  configurationError?: string;
  projectSettings?: { enabledPlugins: Record<string, boolean> };
  onLoadProjectSettings: () => void;
  onToggleBuiltinPlugin: (pluginId: string, enabled: boolean) => void;
  onConfigurationSave: (config: ConfigurationData) => void;
  onDialogClose: () => void;
  vscode: VsCodeApi;
  workflowRuns: SerializableWorkflowRun[];
  onOpenFile: (path: string, startLine?: number, endLine?: number) => void;
  isAuthenticated: boolean;
  loginError?: string;
  onLogin: () => void;
  agentTranscript: AgentTranscriptState | null;
  subagentMessages: Record<string, Message[]>;
  agentToolSubagentIds: Record<string, string>;
  onCloseAgentTranscript: () => void;
  pendingRewindId: string | null;
  onRewindConfirm: () => void;
  onCancelRewind: () => void;
  toasts: UpdateToast[];
  onToastDismiss: (id: string) => void;
  onToastAction: (toast: UpdateToast) => void;
  quickOpenOpen: boolean;
  quickOpenQuery?: string;
  onQuickOpenClose: () => void;
  effectiveWorkdir?: string;
}

/**
 * All overlays render at the component root — not inside chatContainer — so
 * they stay visible in every layout: the desktop split-view shell (where the
 * root ChatApp never mounts its own chatContainer) still shows the config
 * dialog opened from the sidebar 更多 menu.
 */
export const ChatDialogs: React.FC<ChatDialogsProps> = ({
  activeDialog,
  configurationData,
  configurationLoading,
  configurationError,
  projectSettings,
  onLoadProjectSettings,
  onToggleBuiltinPlugin,
  onConfigurationSave,
  onDialogClose,
  vscode,
  workflowRuns,
  onOpenFile,
  isAuthenticated,
  loginError,
  onLogin,
  agentTranscript,
  subagentMessages,
  agentToolSubagentIds,
  onCloseAgentTranscript,
  pendingRewindId,
  onRewindConfirm,
  onCancelRewind,
  toasts,
  onToastDismiss,
  onToastAction,
  quickOpenOpen,
  quickOpenQuery,
  onQuickOpenClose,
  effectiveWorkdir,
}) => {
  return (
    <>
      {activeDialog === "config" && (
        <ConfigDialog
          configurationData={configurationData || {}}
          isLoading={configurationLoading}
          error={configurationError}
          onSave={onConfigurationSave}
          onCancel={onDialogClose}
          projectSettings={projectSettings}
          onLoadProjectSettings={onLoadProjectSettings}
          onToggleBuiltinPlugin={onToggleBuiltinPlugin}
          vscode={vscode}
        />
      )}
      {activeDialog === "plugin" && (
        <PluginDialog vscode={vscode} onClose={onDialogClose} />
      )}
      {activeDialog === "mcp" && (
        <McpDialog vscode={vscode} onClose={onDialogClose} />
      )}
      {activeDialog === "status" && (
        <StatusDialog
          onClose={onDialogClose}
          vscode={vscode}
        />
      )}
      {activeDialog === "workflows" && (
        <WorkflowManager
          runs={workflowRuns}
          vscode={vscode}
          onCancel={onDialogClose}
          onOpenFile={(path) => {
            onOpenFile(path);
            onDialogClose();
          }}
        />
      )}
      {activeDialog === "agents" && (
        <AgentsDialog vscode={vscode} onClose={onDialogClose} />
      )}
      {activeDialog === "login" && (
        <LoginDialog
          isAuthenticated={isAuthenticated}
          loginError={loginError}
          onLogin={onLogin}
          onCancel={onDialogClose}
        />
      )}
      {agentTranscript && (
        <AgentTranscriptPopup
          title={agentTranscript.title}
          messages={resolveSubagentMessages(
            subagentMessages,
            agentToolSubagentIds,
            agentTranscript.subagentId,
            {
              nestedMessages: agentTranscript.nestedMessages,
              fallbackText: agentTranscript.fallbackText,
              prompt: agentTranscript.prompt,
            },
          )}
          vscode={vscode}
          onClose={onCloseAgentTranscript}
        />
      )}
      {pendingRewindId && (
        <ConfirmDialog
          title="确定要回滚到此消息吗？"
          description="这将删除之后的所有消息并撤销相关的文件更改。"
          onConfirm={onRewindConfirm}
          onCancel={onCancelRewind}
        />
      )}
      <ToastStack
        toasts={toasts}
        onDismiss={onToastDismiss}
        onAction={onToastAction}
      />
      <QuickOpenPalette
        open={quickOpenOpen}
        initialQuery={quickOpenQuery}
        workdir={effectiveWorkdir}
        vscode={vscode}
        onClose={onQuickOpenClose}
        onOpenFile={(path) => onOpenFile(path)}
      />
    </>
  );
};
