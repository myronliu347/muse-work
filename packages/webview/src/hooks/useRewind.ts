import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
} from "react";
import type {
  ChatAction,
  ConfirmationDecision,
  Message,
  ToolBlock,
} from "../types";
import { parseAgentPrompt } from "../utils/subagentTranscript";
import type { ChatAppCore } from "./useChatAppCore";

export interface RewindHandlers {
  handleConfirmation: (
    confirmationId: string,
    decision?: ConfirmationDecision,
  ) => void;
  handleRejection: (confirmationId: string) => void;
  handleRewindToMessage: (messageId: string) => void;
  handleOpenAgentTranscript: (toolBlock: ToolBlock) => void;
  handleCloseAgentTranscript: () => void;
  handleRewindCheckpointSelect: (messageId: string) => void;
  handleRewindPopupClose: () => void;
  handleRewindConfirm: () => void;
}

interface UseRewindParams {
  postToHost: ChatAppCore["postToHost"];
  patchPane: ChatAppCore["patchPane"];
  dispatch: Dispatch<ChatAction>;
  isStreaming: boolean;
  pendingRewindId: string | null;
  messageInputRef: RefObject<{ focus: () => void }>;
}

export function useRewind({
  postToHost,
  patchPane,
  dispatch,
  isStreaming,
  pendingRewindId,
  messageInputRef,
}: UseRewindParams): RewindHandlers {
  const handleConfirmation = useCallback(
    (confirmationId: string, decision?: ConfirmationDecision) => {
      postToHost({
        command: "confirmationResponse",
        confirmationId,
        approved: true,
        decision,
      });
      dispatch({ type: "HIDE_CONFIRMATION", payload: confirmationId });
    },
    [postToHost],
  );

  const handleRejection = useCallback(
    (confirmationId: string) => {
      postToHost({
        command: "confirmationResponse",
        confirmationId,
        approved: false,
      });
      dispatch({ type: "HIDE_CONFIRMATION", payload: confirmationId });
    },
    [postToHost],
  );

  const handleRewindToMessage = useCallback(
    (messageId: string) => {
      if (isStreaming) return;
      patchPane({ pendingRewindId: messageId });
    },
    [isStreaming, patchPane],
  );

  const handleOpenAgentTranscript = useCallback(
    (toolBlock: ToolBlock) => {
      const nested = (
        toolBlock as ToolBlock & { nestedMessages?: Message[] }
      ).nestedMessages;
      const resultText = (toolBlock.result || "").trim();
      patchPane({
        agentTranscript: {
          subagentId: toolBlock.id ?? "",
          title: toolBlock.compactParams?.trim() || toolBlock.name || "Agent",
          nestedMessages: nested,
          fallbackText: resultText || undefined,
          prompt: parseAgentPrompt(toolBlock.parameters),
        },
      });
    },
    [patchPane],
  );

  const handleCloseAgentTranscript = useCallback(() => {
    patchPane({ agentTranscript: null });
  }, [patchPane]);

  // /rewind popup selection reuses the same ConfirmDialog flow as the
  // per-message rewind button.
  const handleRewindCheckpointSelect = useCallback(
    (messageId: string) => {
      patchPane({ rewindPopupOpen: false, pendingRewindId: messageId });
      messageInputRef.current?.focus();
    },
    [patchPane],
  );

  const handleRewindPopupClose = useCallback(() => {
    patchPane({ rewindPopupOpen: false });
    messageInputRef.current?.focus();
  }, [patchPane]);

  const handleRewindConfirm = useCallback(() => {
    const messageId = pendingRewindId;
    patchPane({ pendingRewindId: null });
    if (messageId) {
      postToHost({
        command: "rewindToMessage",
        messageId,
      });
    }
  }, [pendingRewindId, postToHost, patchPane]);

  return {
    handleConfirmation,
    handleRejection,
    handleRewindToMessage,
    handleOpenAgentTranscript,
    handleCloseAgentTranscript,
    handleRewindCheckpointSelect,
    handleRewindPopupClose,
    handleRewindConfirm,
  };
}
