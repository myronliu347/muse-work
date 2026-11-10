import { useCallback, type ReactNode, type MutableRefObject, type RefObject } from "react";
import { ChatComposer, type ChatComposerProps } from "./ChatComposer";
import type { MessageInputHandle } from "./MessageInput";
import { IssueSessionHeader, type IssueViewTab } from "../issue/IssueSessionHeader";
import { isSplitIssueGroup, resolveIssuePlanningSessionId } from "../../utils/issueGroups";
import type { ChatAppCore } from "../../hooks/useChatAppCore";
import type { ChatState, DesktopHostProps, DesktopIssueGroup, VsCodeApi } from "../../types";

type Send = (
  text: string,
  images?: Array<{ data: string; mediaType: string }>,
  force?: boolean,
) => void;

/** Issue header plus the composer. Sends from an execution tab go to planning. */
export function useIssueComposer(input: {
  activeIssueGroup: DesktopIssueGroup | undefined;
  issueViewTab: IssueViewTab;
  handleIssueTabChange: (tab: IssueViewTab) => void;
  shownIssueGroup: DesktopIssueGroup | undefined;
  assistantVisible: boolean;
  openIssueViewTab: IssueViewTab;
  setIssueTabChoice: (choice: { issueId: string; tab: IssueViewTab }) => void;
  issueSendSessionRef: MutableRefObject<string | undefined>;
  handleSendMessage: Send;
  messageInputRef: RefObject<MessageInputHandle>;
  issueStreaming: boolean;
  state: ChatState;
  handleAbortMessage: () => void;
  handleSubmitQueuedEdit: ChatComposerProps["onSubmitQueuedEdit"];
  handleCancelQueuedEdit: () => void;
  handleInputCleared: () => void;
  vscode: VsCodeApi;
  host: DesktopHostProps | undefined;
  isDraftSession: boolean;
  effectiveHost: string;
  effectiveWorkdir?: string;
  panelWorkdir?: string;
  gitBranches: ChatComposerProps["gitBranches"];
  worktreeBranch: string;
  worktreeChecked: boolean;
  patchPane: ChatAppCore["patchPane"];
  resolvedModelId?: string;
  handleSessionModelChange: (modelId: string) => void;
  rewindPopupOpen: boolean;
  rewindCheckpointsLoading: boolean;
  rewindCheckpoints: ChatComposerProps["rewindCheckpoints"];
  handleRewindCheckpointSelect: (messageId: string) => void;
  handleRewindPopupClose: () => void;
  modelPopupOpen: boolean;
  modelLoading: boolean;
  configuredModels: string[];
  currentModel: string | undefined;
  handleModelSelect: (model: string) => void;
  handleModelPopupClose: () => void;
  issueClosed: boolean;
}): {
  showIssueChrome: boolean;
  issueSessionHeader: ReactNode;
  sendIssueMessage: Send;
  composer: ReactNode;
} {
  const {
    activeIssueGroup,
    issueViewTab,
    handleIssueTabChange,
    shownIssueGroup,
    assistantVisible,
    openIssueViewTab,
    setIssueTabChoice,
    issueSendSessionRef,
    handleSendMessage,
    messageInputRef,
    issueStreaming,
    state,
    handleAbortMessage,
    handleSubmitQueuedEdit,
    handleCancelQueuedEdit,
    handleInputCleared,
    vscode,
    host,
    isDraftSession,
    effectiveHost,
    effectiveWorkdir,
    panelWorkdir,
    gitBranches,
    worktreeBranch,
    worktreeChecked,
    patchPane,
    resolvedModelId,
    handleSessionModelChange,
    rewindPopupOpen,
    rewindCheckpointsLoading,
    rewindCheckpoints,
    handleRewindCheckpointSelect,
    handleRewindPopupClose,
    modelPopupOpen,
    modelLoading,
    configuredModels,
    currentModel,
    handleModelSelect,
    handleModelPopupClose,
    issueClosed,
  } = input;
  const showIssueChrome = Boolean(activeIssueGroup);
  const issueSessionHeader =
    showIssueChrome && activeIssueGroup ? (
      <IssueSessionHeader
        title={activeIssueGroup.title}
        activeTab={issueViewTab}
        onTabChange={handleIssueTabChange}
        showTabs={Boolean(
          activeIssueGroup && isSplitIssueGroup(activeIssueGroup),
        )}
        executionEnabled={Boolean(activeIssueGroup.executionSessionId)}
      />
    ) : undefined;

  // 执行会话不收用户消息。从执行标签发出去时，改投规划会话并切过去。
  const sendIssueMessage = useCallback(
    (
      text: string,
      images?: Array<{ data: string; mediaType: string }>,
      force?: boolean,
    ) => {
      const planningId =
        shownIssueGroup && isSplitIssueGroup(shownIssueGroup)
          ? resolveIssuePlanningSessionId(shownIssueGroup)
          : undefined;
      if (
        assistantVisible &&
        shownIssueGroup &&
        planningId &&
        openIssueViewTab === "execution" &&
        (text.trim() || (images && images.length > 0))
      ) {
        issueSendSessionRef.current = planningId;
        setIssueTabChoice({ issueId: shownIssueGroup.issueId, tab: "planning" });
      }
      handleSendMessage(text, images, force);
    },
    [assistantVisible, shownIssueGroup, openIssueViewTab, handleSendMessage],
  );

  const composer = (
    <ChatComposer
      ref={messageInputRef}
      onSendMessage={sendIssueMessage}
      isStreaming={
        assistantVisible && shownIssueGroup ? issueStreaming : state.isStreaming
      }
      onAbortMessage={handleAbortMessage}
      onSubmitQueuedEdit={handleSubmitQueuedEdit}
      editingQueuedId={state.editingQueuedId}
      onCancelQueuedEdit={handleCancelQueuedEdit}
      shouldClearInput={state.shouldClearInput}
      onInputCleared={handleInputCleared}
      vscode={vscode}
      selection={state.selection}
      inputContent={state.inputContent}
      sessionId={state.currentSession?.id}
      permissionMode={state.permissionMode}
      initialAttachedImages={state.attachedImages}
      host={host}
      isDraftSession={isDraftSession}
      effectiveHost={effectiveHost}
      effectiveWorkdir={effectiveWorkdir}
      panelWorkdir={panelWorkdir}
      gitBranches={gitBranches}
      worktreeBranch={worktreeBranch}
      worktreeChecked={worktreeChecked}
      patchPane={patchPane}
      modelId={resolvedModelId}
      onModelChange={handleSessionModelChange}
      rewindPopupOpen={rewindPopupOpen}
      rewindCheckpointsLoading={rewindCheckpointsLoading}
      rewindCheckpoints={rewindCheckpoints}
      onRewindCheckpointSelect={handleRewindCheckpointSelect}
      onRewindPopupClose={handleRewindPopupClose}
      modelPopupOpen={modelPopupOpen}
      modelLoading={modelLoading}
      configuredModels={configuredModels}
      currentModel={currentModel}
      onModelSelect={handleModelSelect}
      onModelPopupClose={handleModelPopupClose}
      closed={issueClosed}
      showDraftControls={isDraftSession && !(assistantVisible && shownIssueGroup)}
    />
  );

  return { showIssueChrome, issueSessionHeader, sendIssueMessage, composer };
}
