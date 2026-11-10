import type { ChatState, ChatAction } from "../../types";
import { transcriptScore } from "../../utils/subagentTranscript";
import {
  applyStreamingContent,
  applyToolBlock,
  bindAgentTools,
  enqueueSubagent,
  ensureMessage,
  patchTranscript,
} from "./shared";

type Action = Extract<ChatAction, { type: "APPEND_SUBAGENT_MESSAGE" | "SET_SUBAGENT_MESSAGES" | "UPDATE_SUBAGENT_STREAMING_CONTENT" | "UPDATE_SUBAGENT_TOOL_BLOCK" }>;

export function reduceSubagent(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "APPEND_SUBAGENT_MESSAGE": {
      const { subagentId, messageId } = action.payload;
      return bindAgentTools(
        enqueueSubagent(
          {
            ...state,
            subagentMessages: patchTranscript(
              state.subagentMessages,
              subagentId,
              (messages) => ensureMessage(messages, messageId),
            ),
          },
          subagentId,
        ),
      );
    }
    case "SET_SUBAGENT_MESSAGES": {
      const { subagentId, messages: incoming } = action.payload;
      const existing = state.subagentMessages[subagentId];
      const messages =
        transcriptScore(incoming) >= transcriptScore(existing)
          ? incoming
          : (existing ?? incoming);
      return bindAgentTools(
        enqueueSubagent(
          {
            ...state,
            subagentMessages: {
              ...state.subagentMessages,
              [subagentId]: messages,
            },
          },
          subagentId,
        ),
      );
    }
    case "UPDATE_SUBAGENT_STREAMING_CONTENT": {
      const { subagentId, ...payload } = action.payload;
      return bindAgentTools({
        ...state,
        subagentMessages: patchTranscript(
          state.subagentMessages,
          subagentId,
          (messages) => applyStreamingContent(messages, payload),
        ),
      });
    }
    case "UPDATE_SUBAGENT_TOOL_BLOCK": {
      const { subagentId, params } = action.payload;
      return bindAgentTools({
        ...state,
        subagentMessages: patchTranscript(
          state.subagentMessages,
          subagentId,
          (messages) => applyToolBlock(messages, params),
        ),
      });
    }
  }
}
