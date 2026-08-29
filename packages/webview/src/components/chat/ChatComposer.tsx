import { forwardRef } from "react";
import { MessageInput } from "./MessageInput";
import type { MessageInputHandle } from "./MessageInput";
import { RewindPopup, type RewindCheckpoint } from "../dialogs/RewindPopup";
import { ModelPopup } from "../dialogs/ModelPopup";
import { DesktopWorkdirSelector } from "../desktop/DesktopWorkdirSelector";
import { DesktopWorktreeControls } from "../desktop/DesktopWorktreeControls";
import type {
  DesktopHostProps,
  SelectionInfo,
  PermissionMode,
  AttachedImage,
  VsCodeApi,
} from "../../types";
import type { PaneGitBranches } from "../../stores";
import type { ChatAppCore } from "../../hooks/useChatAppCore";

export interface ChatComposerProps {
  onSendMessage: (
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
  ) => void;
  isStreaming: boolean;
  onAbortMessage: () => void;
  onSubmitQueuedEdit: (
    id: string,
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
  ) => void;
  editingQueuedId: string | null;
  onCancelQueuedEdit: () => void;
  shouldClearInput: boolean;
  onInputCleared: () => void;
  vscode: VsCodeApi;
  selection?: SelectionInfo;
  inputContent?: string;
  sessionId?: string;
  permissionMode?: PermissionMode;
  initialAttachedImages?: AttachedImage[];
  host?: DesktopHostProps;
  isDraftSession: boolean;
  effectiveHost: string;
  effectiveWorkdir?: string;
  panelWorkdir?: string;
  gitBranches: PaneGitBranches | null;
  worktreeBranch: string;
  worktreeChecked: boolean;
  patchPane: ChatAppCore["patchPane"];
  modelId?: string;
  onModelChange: (modelId: string) => void;
  /** 当前会话选用的数字人 agent key。 */
  agentName?: string;
  /** session 场景映射默认 agent key（无会话 agentName 时展示）。 */
  defaultAgentName?: string;
  /** 用户切换 agent → PATCH /sessions/:id { agent }。 */
  onAgentChange?: (agentKey: string) => void;
  rewindPopupOpen: boolean;
  rewindCheckpointsLoading: boolean;
  rewindCheckpoints: RewindCheckpoint[];
  onRewindCheckpointSelect: (messageId: string) => void;
  onRewindPopupClose: () => void;
  modelPopupOpen: boolean;
  modelLoading: boolean;
  configuredModels: string[];
  currentModel: string | undefined;
  onModelSelect: (model: string) => void;
  onModelPopupClose: () => void;
}

export const ChatComposer = forwardRef<
  MessageInputHandle,
  ChatComposerProps
>(function ChatComposer(
  {
    onSendMessage,
    isStreaming,
    onAbortMessage,
    onSubmitQueuedEdit,
    editingQueuedId,
    onCancelQueuedEdit,
    shouldClearInput,
    onInputCleared,
    vscode,
    selection,
    inputContent,
    sessionId,
    permissionMode,
    initialAttachedImages,
    host,
    isDraftSession,
    effectiveHost,
    effectiveWorkdir,
    panelWorkdir,
    gitBranches,
    worktreeBranch,
    worktreeChecked,
    patchPane,
    modelId,
    onModelChange,
    agentName,
    defaultAgentName,
    onAgentChange,
    rewindPopupOpen,
    rewindCheckpointsLoading,
    rewindCheckpoints,
    onRewindCheckpointSelect,
    onRewindPopupClose,
    modelPopupOpen,
    modelLoading,
    configuredModels,
    currentModel,
    onModelSelect,
    onModelPopupClose,
  },
  ref,
) {
  return (
    <MessageInput
      ref={ref}
      onSendMessage={onSendMessage}
      isStreaming={isStreaming}
      onAbortMessage={onAbortMessage}
      onSubmitQueuedEdit={onSubmitQueuedEdit}
      editingQueuedId={editingQueuedId}
      onCancelQueuedEdit={onCancelQueuedEdit}
      shouldClearInput={shouldClearInput}
      onInputCleared={onInputCleared}
      vscode={vscode}
      selection={selection}
      inputContent={inputContent}
      sessionId={sessionId}
      permissionMode={permissionMode}
      initialAttachedImages={initialAttachedImages}
      disabled={host?.type === "desktop" && !effectiveWorkdir && !isDraftSession}
      modelId={modelId}
      onModelChange={onModelChange}
      agentName={agentName}
      defaultAgentName={defaultAgentName}
      onAgentChange={onAgentChange}
      workdir={effectiveWorkdir ?? panelWorkdir}
      workdirSelector={
        host?.type === "desktop" && isDraftSession ? (
          <>
            <DesktopWorkdirSelector
              host={effectiveHost}
              workdir={effectiveWorkdir}
              recentWorkdirs={host.recentWorkdirs}
              onSelectWorkdir={host.onSelectWorkdir}
              onSelectRecentWorkdir={host.onSelectRecentWorkdir}
              onRemoveRecentWorkdir={host.onRemoveRecentWorkdir}
            />
            {effectiveWorkdir &&
              gitBranches &&
              gitBranches.branches.length > 0 && (
                <DesktopWorktreeControls
                  branches={gitBranches.branches}
                  branch={worktreeBranch || gitBranches.current}
                  worktreeChecked={worktreeChecked}
                  onBranchChange={(branch) =>
                    patchPane({ worktreeBranch: branch })
                  }
                  onWorktreeChange={(checked) =>
                    patchPane({ worktreeChecked: checked })
                  }
                />
              )}
          </>
        ) : undefined
      }
      rewindPopup={
        <RewindPopup
          isVisible={rewindPopupOpen}
          isLoading={rewindCheckpointsLoading}
          checkpoints={rewindCheckpoints}
          onSelect={onRewindCheckpointSelect}
          onClose={onRewindPopupClose}
        />
      }
      modelPopup={
        <ModelPopup
          isVisible={modelPopupOpen}
          isLoading={modelLoading}
          models={configuredModels}
          currentModel={currentModel}
          onSelect={onModelSelect}
          onClose={onModelPopupClose}
        />
      }
    />
  );
});
