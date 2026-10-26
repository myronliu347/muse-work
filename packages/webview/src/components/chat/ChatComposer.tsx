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
  /** Issue 已完成或已取消，输入框只保留阅读，不能再发。 */
  closed?: boolean;
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
    closed = false,
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
      disabled={
        closed ||
        (host?.type === "desktop" && !effectiveWorkdir && !isDraftSession)
      }
      placeholder={closed ? "这条 Issue 已关闭，不能再发消息" : undefined}
      modelId={modelId}
      onModelChange={onModelChange}
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
              variant="ghost"
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
