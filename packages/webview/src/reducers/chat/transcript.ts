import type { ChatState, ChatAction, Message, MessageBlock, TextBlock, ToolBlock, ErrorBlock, EnrichedFileSnapshot } from "../../types";
import {
  materializeMessageImages,
  revokeUnusedMessageImageBlobs,
} from "../../utils/messageImages";
import { pinSessionTitle } from "../../utils/session";
import { AGENT_TOOL_NAME } from "@muse-work/agent/constants";
import {
  bindAgentTools,
  enqueueAgentTool,
  isEmptyTurnErrorMessage,
  isOptimisticUserId,
  nearestUserIndex,
  userTextContent,
  userTextsMatch,
  nestedMessagesFromLoaded,
} from "./shared";

type Action = Extract<ChatAction, { type: "SET_MESSAGES" | "PREPEND_MESSAGES" | "APPEND_MESSAGES" | "UPDATE_MESSAGE_ID" | "APPEND_MESSAGE" | "UPDATE_STREAMING_CONTENT" | "UPDATE_STREAMING_REASONING" | "UPDATE_FILE_HISTORY" | "UPDATE_TOOL_BLOCK" | "APPEND_ERROR_BLOCK" | "APPEND_BANG_MESSAGE" | "UPDATE_BANG_MESSAGE" | "COMPLETE_BANG_MESSAGE" }>;

export function reduceTranscript(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "SET_MESSAGES": {
      const messages = materializeMessageImages(action.payload);
      revokeUnusedMessageImageBlobs(state.messages, messages);
      return {
        ...state,
        messages,
        transcriptPending: false,
        hasOlderMessages:
          typeof action.hasMore === "boolean" ? action.hasMore : false,
        currentSession: pinSessionTitle(state.currentSession, messages),
        subagentMessages: {
          ...state.subagentMessages,
          ...nestedMessagesFromLoaded(messages),
        },
      };
    }
    case "PREPEND_MESSAGES": {
      const known = new Set(state.messages.map((message) => message.id));
      const older = materializeMessageImages(
        action.payload.filter(
          (message) => message.id && !known.has(message.id),
        ),
      );
      return {
        ...state,
        messages: [...older, ...state.messages],
        hasOlderMessages: action.hasMore,
        subagentMessages: {
          ...state.subagentMessages,
          ...nestedMessagesFromLoaded(older),
        },
      };
    }
    case "APPEND_MESSAGES": {
      const known = new Set(state.messages.map((message) => message.id));
      const extra = materializeMessageImages(
        action.payload.filter(
          (message) => message.id && !known.has(message.id),
        ),
      );
      if (extra.length === 0) return state;
      return {
        ...state,
        messages: [...state.messages, ...extra],
        subagentMessages: {
          ...state.subagentMessages,
          ...nestedMessagesFromLoaded(extra),
        },
      };
    }
    case "UPDATE_MESSAGE_ID": {
      // 乐观用户气泡的客户端临时 id 对齐成 SDK 真实 id：rewind 等按 id 的
      // 操作依赖服务器 agent 消息里的 id，临时 id 从未持久化会 404。
      const { from, to } = action.payload;
      if (!from || !to || from === to) return state;
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === from ? { ...m, id: to } : m,
        ),
      };
    }
    case "APPEND_MESSAGE": {
      const payload = materializeMessageImages([action.payload])[0] ?? action.payload;
      // Dedupe by id: hostBridge clears its knownAssistantIds guard on turn end
      // / error / session switch, so a straggler delta for a message already in
      // the list would otherwise be re-appended (duplicate React key warning).
      if (state.messages.some((m) => m.id === payload.id)) return state;
      // Fast-turn race: SDK echo and host optimistic bubble can land in either
      // order (and the router may miss the bubble when stateRef lags). Same
      // text + one optimistic id + one real id → keep a single row.
      if (payload.role === "user") {
        const incoming = userTextContent(payload);
        if (incoming) {
          const idx = nearestUserIndex(state.messages);
          if (idx !== -1) {
            const nearest = state.messages[idx];
            const nearestText = userTextContent(nearest);
            if (nearestText && userTextsMatch(nearestText, incoming)) {
              const incomingOpt = isOptimisticUserId(payload.id);
              const nearestOpt = isOptimisticUserId(nearest.id);
              if (incomingOpt && !nearestOpt) {
                return state;
              }
              if (!incomingOpt && nearestOpt) {
                const messages = state.messages.map((m, i) =>
                  i === idx ? { ...m, id: payload.id } : m,
                );
                return {
                  ...state,
                  messages,
                  currentSession: pinSessionTitle(
                    state.currentSession,
                    messages,
                  ),
                };
              }
            }
          }
        }
      }
      let messages = state.messages;
      if (payload.role === "assistant") {
        messages = messages.filter((m) => !isEmptyTurnErrorMessage(m));
      }
      messages = [...messages, payload];
      return {
        ...state,
        messages,
        // The desktop host delivers user messages incrementally and never
        // routes them through SET_MESSAGES, so the title pin must happen here
        // too — otherwise compaction wipes the derivation material.
        currentSession: pinSessionTitle(state.currentSession, messages),
      };
    }
    case "UPDATE_STREAMING_CONTENT": {
      const { messageId, chunk, stage } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const textBlockIndex = message.blocks.findIndex((b) => b.type === "text");

      let newBlocks: MessageBlock[];
      if (textBlockIndex === -1) {
        // No text block yet, append one
        const newTextBlock: TextBlock = {
          type: "text",
          content: chunk,
          stage,
        };
        newBlocks = [...message.blocks, newTextBlock];
      } else {
        // Append the delta chunk to the existing text block
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === textBlockIndex && block.type === "text") {
            return {
              ...block,
              content: block.content + chunk,
              stage,
            } as TextBlock;
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      return {
        ...state,
        messages: newMessages,
      };
    }
    case "UPDATE_STREAMING_REASONING": {
      const { messageId, chunk, stage } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const reasoningBlockIndex = message.blocks.findIndex(
        (b) => b.type === "reasoning",
      );

      let newBlocks: MessageBlock[];
      if (reasoningBlockIndex === -1) {
        // No reasoning block yet, append one. Record startTime so the UI can show
        // elapsed thinking time during streaming (SET_MESSAGES later overrides it
        // with the SDK's persisted value).
        const newReasoningBlock = {
          type: "reasoning" as const,
          content: chunk,
          stage,
          startTime: Date.now(),
          ...(stage === "end" ? { endTime: Date.now() } : {}),
        };
        newBlocks = [...message.blocks, newReasoningBlock];
      } else {
        // Append the delta chunk to the existing reasoning block, preserving
        // startTime and stamping endTime when the reasoning finishes.
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === reasoningBlockIndex && block.type === "reasoning") {
            return {
              ...block,
              content: block.content + chunk,
              stage,
              startTime: block.startTime ?? Date.now(),
              ...(stage === "end"
                ? { endTime: block.endTime ?? Date.now() }
                : {}),
            };
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      return {
        ...state,
        messages: newMessages,
      };
    }
    case "UPDATE_FILE_HISTORY": {
      // Turn ended: merge the turn's file_history blocks (messageId → enriched
      // snapshots) into the matching messages. Delta events never carry
      // file_history, so without this the card only appears after a session
      // switch re-fetches messages.
      const updates = action.payload.messages;
      if (!Array.isArray(updates) || updates.length === 0) return state;
      const byId = new Map(updates.map((u) => [u.messageId, u.snapshots]));
      const newMessages = state.messages.map((m) => {
        const snapshots = byId.get(m.id);
        if (!snapshots) return m;
        // Replace any existing file_history blocks with the fresh snapshot set
        // (a turn may append multiple blocks; the card wants the merged view).
        const otherBlocks = (m.blocks ?? []).filter(
          (b) => b.type !== "file_history",
        );
        return {
          ...m,
          blocks: [
            ...otherBlocks,
            {
              type: "file_history" as const,
              snapshots: snapshots as EnrichedFileSnapshot[],
            },
          ],
        };
      });
      return { ...state, messages: newMessages };
    }
    case "UPDATE_TOOL_BLOCK": {
      const {
        messageId,
        id: toolBlockId,
        parametersChunk,
        ...rest
      } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const toolBlockIndex = message.blocks.findIndex(
        (b) => b.type === "tool" && b.id === toolBlockId,
      );

      let newBlocks: MessageBlock[];
      if (toolBlockIndex === -1) {
        // Tool block doesn't exist yet, add it as a new block
        const newToolBlock: ToolBlock = {
          type: "tool",
          id: toolBlockId,
          name: rest.name || "",
          stage: rest.stage || "start",
          result: rest.result || "",
          success: rest.success ?? false,
          ...rest,
          parameters: (rest.parameters || "") + (parametersChunk || ""),
        };
        newBlocks = [...message.blocks, newToolBlock];
      } else {
        // Update existing tool block
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === toolBlockIndex && block.type === "tool") {
            const merged: ToolBlock = { ...block, ...rest };
            if (parametersChunk) {
              // Delta form (streaming): append the chunk to the accumulated parameters
              merged.parameters = (block.parameters || "") + parametersChunk;
            }
            return merged;
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      const isAgentTool =
        rest.name === AGENT_TOOL_NAME ||
        (toolBlockIndex !== -1 &&
          message.blocks[toolBlockIndex].type === "tool" &&
          message.blocks[toolBlockIndex].name === AGENT_TOOL_NAME);

      return bindAgentTools(
        enqueueAgentTool(
          { ...state, messages: newMessages },
          isAgentTool ? String(toolBlockId ?? "") : "",
        ),
      );
    }
    case "APPEND_ERROR_BLOCK": {
      const { error } = action.payload;
      const last = state.messages[state.messages.length - 1];
      // Empty-turn is a server bookkeeping miss when the SDK flickers loading
      // around Agent/tools. Don't pin "模型没有产生输出" under a live tool row.
      if (
        error === "模型没有产生输出" &&
        last?.role === "assistant" &&
        last.blocks.some((b) => b.type !== "error")
      ) {
        return state;
      }
      const newErrorBlock: ErrorBlock = { type: "error", content: error };

      // Compact / LLM errors must appear after the latest user send. Attaching
      // them to an older assistant bubble hides the failure above the follow-up.
      if (!last || last.role !== "assistant") {
        const errorMessage: Message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          role: "assistant",
          timestamp: new Date().toISOString(),
          blocks: [newErrorBlock],
        };
        return {
          ...state,
          messages: [...state.messages, errorMessage],
        };
      }

      return {
        ...state,
        messages: state.messages.map((m, idx) =>
          idx === state.messages.length - 1
            ? { ...m, blocks: [...m.blocks, newErrorBlock] }
            : m,
        ),
      };
    }
    // Bang message incremental updates (keyed by messageId). Mirrors the CLI's
    // incremental bang handlers in useChat.tsx: add creates the user message
    // wrapper, update merges command/output, complete stamps exitCode + stage.
    case "APPEND_BANG_MESSAGE": {
      const { command, messageId } = action.payload;
      if (state.messages.some((m) => m.id === messageId)) return state;
      const bangMessage: Message = {
        id: messageId,
        role: "user",
        timestamp: new Date().toISOString(),
        blocks: [
          {
            type: "bang",
            command,
            output: "",
            stage: "running",
            exitCode: null,
          },
        ],
      };
      const messages = [...state.messages, bangMessage];
      return {
        ...state,
        messages,
        currentSession: pinSessionTitle(state.currentSession, messages),
      };
    }
    case "UPDATE_BANG_MESSAGE": {
      const { command, output, messageId } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;
      const newMessages = state.messages.map((m, idx) => {
        if (idx !== messageIndex) return m;
        return {
          ...m,
          blocks: m.blocks.map((b, bidx) =>
            bidx === m.blocks.length - 1 && b.type === "bang"
              ? { ...b, command, output }
              : b,
          ),
        };
      });
      return { ...state, messages: newMessages };
    }
    case "COMPLETE_BANG_MESSAGE": {
      const { command, exitCode, messageId, output } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;
      const newMessages = state.messages.map((m, idx) => {
        if (idx !== messageIndex) return m;
        return {
          ...m,
          blocks: m.blocks.map((b, bidx) =>
            bidx === m.blocks.length - 1 && b.type === "bang"
              ? {
                  ...b,
                  command,
                  exitCode,
                  stage: "end" as const,
                  ...(output !== undefined ? { output } : {}),
                }
              : b,
          ),
        };
      });
      return { ...state, messages: newMessages };
    }
  }
}
