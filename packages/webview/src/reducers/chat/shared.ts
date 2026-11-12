import type {
  ChatState,
  Message,
  ToolBlock,
  ToolBlockUpdateCallbackParams,
} from "../../types";
import { normalizeUserTextForDedupe } from "../../utils/messageUtils";

const SESSION_SCOPED_DIALOGS = new Set([
  "mcp",
  "status",
  "workflows",
  "agents",
]);

export function dialogAfterSessionSwitch(
  activeDialog: ChatState["activeDialog"],
): ChatState["activeDialog"] {
  if (activeDialog && SESSION_SCOPED_DIALOGS.has(activeDialog)) return null;
  return activeDialog;
}

export function isOptimisticUserId(id: string): boolean {
  return id.startsWith("user_") || id.startsWith("user-");
}

export function userTextContent(message: Message): string | undefined {
  const block = message.blocks.find((b) => b.type === "text");
  if (!block || block.type !== "text") return undefined;
  const text = block.content?.trim();
  return text || undefined;
}

/** Image refs on a user message (0 when it carries none). */
export function userImageCount(message: Message): number {
  const block = message.blocks.find((b) => b.type === "image");
  return block && block.type === "image" ? (block.imageUrls?.length ?? 0) : 0;
}

export function userTextsMatch(a: string, b: string): boolean {
  return a === b || normalizeUserTextForDedupe(a) === normalizeUserTextForDedupe(b);
}

export function isEmptyTurnErrorMessage(message: Message): boolean {
  return (
    message.role === "assistant" &&
    message.blocks.length > 0 &&
    message.blocks.every(
      (b) => b.type === "error" && b.content === "模型没有产生输出",
    )
  );
}

/** Nearest visible (non-meta) user message — meta SessionStart hooks must not
 *  shadow the optimistic bubble during user:message / APPEND_MESSAGE dedupe. */
export function nearestUserIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && !m.isMeta) return i;
  }
  return -1;
}

export function emptyAssistant(messageId: string): Message {
  return {
    id: messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
    blocks: [],
  };
}

export function ensureMessage(messages: Message[], messageId: string): Message[] {
  if (messages.some((m) => m.id === messageId)) return messages;
  return [...messages, emptyAssistant(messageId)];
}

export function patchTranscript(
  transcripts: Record<string, Message[]>,
  subagentId: string,
  patch: (messages: Message[]) => Message[],
): Record<string, Message[]> {
  return {
    ...transcripts,
    [subagentId]: patch(transcripts[subagentId] ?? []),
  };
}

export function applyStreamingContent(
  messages: Message[],
  payload: { messageId: string; chunk: string; stage: "streaming" | "end" },
): Message[] {
  const list = ensureMessage(messages, payload.messageId);
  return list.map((m) => {
    if (m.id !== payload.messageId) return m;
    const textBlockIndex = m.blocks.findIndex((b) => b.type === "text");
    if (textBlockIndex === -1) {
      return {
        ...m,
        blocks: [
          ...m.blocks,
          { type: "text" as const, content: payload.chunk, stage: payload.stage },
        ],
      };
    }
    return {
      ...m,
      blocks: m.blocks.map((block, idx) =>
        idx === textBlockIndex && block.type === "text"
          ? {
              ...block,
              content: block.content + payload.chunk,
              stage: payload.stage,
            }
          : block,
      ),
    };
  });
}

export function applyToolBlock(
  messages: Message[],
  payload: ToolBlockUpdateCallbackParams,
): Message[] {
  const messageId = payload.messageId as string;
  const list = ensureMessage(messages, messageId);
  const { messageId: _ignored, id: toolBlockId, parametersChunk, ...rest } =
    payload;
  return list.map((m) => {
    if (m.id !== messageId) return m;
    const toolBlockIndex = m.blocks.findIndex(
      (b) => b.type === "tool" && b.id === toolBlockId,
    );
    if (toolBlockIndex === -1) {
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
      return { ...m, blocks: [...m.blocks, newToolBlock] };
    }
    return {
      ...m,
      blocks: m.blocks.map((block, idx) => {
        if (idx !== toolBlockIndex || block.type !== "tool") return block;
        const merged: ToolBlock = { ...block, ...rest };
        if (parametersChunk) {
          merged.parameters = (block.parameters || "") + parametersChunk;
        }
        return merged;
      }),
    };
  });
}

export function enqueueAgentTool(state: ChatState, toolId: string): ChatState {
  if (
    !toolId ||
    state.agentToolSubagentIds[toolId] ||
    state.pendingAgentToolIds.includes(toolId)
  ) {
    return state;
  }
  return {
    ...state,
    pendingAgentToolIds: [...state.pendingAgentToolIds, toolId],
  };
}

export function enqueueSubagent(state: ChatState, subagentId: string): ChatState {
  if (
    Object.values(state.agentToolSubagentIds).includes(subagentId) ||
    state.unboundSubagentIds.includes(subagentId)
  ) {
    return state;
  }
  return {
    ...state,
    unboundSubagentIds: [...state.unboundSubagentIds, subagentId],
  };
}

export function bindAgentTools(state: ChatState): ChatState {
  const pending = [...state.pendingAgentToolIds];
  const unbound = [...state.unboundSubagentIds];
  const map = { ...state.agentToolSubagentIds };
  while (pending.length > 0 && unbound.length > 0) {
    const toolId = pending.shift()!;
    if (map[toolId]) continue;
    map[toolId] = unbound.shift()!;
  }
  const subagentMessages = { ...state.subagentMessages };
  for (const [toolId, subagentId] of Object.entries(map)) {
    if (subagentMessages[subagentId]) {
      subagentMessages[toolId] = subagentMessages[subagentId];
    }
  }
  return {
    ...state,
    pendingAgentToolIds: pending,
    unboundSubagentIds: unbound,
    agentToolSubagentIds: map,
    subagentMessages,
  };
}

export function nestedMessagesFromLoaded(messages: Message[]): Record<string, Message[]> {
  const out: Record<string, Message[]> = {};
  for (const message of messages) {
    for (const block of message.blocks ?? []) {
      if (block.type !== "tool" || !block.id) continue;
      const nested = (
        block as ToolBlock & { nestedMessages?: Message[] }
      ).nestedMessages;
      if (Array.isArray(nested) && nested.length > 0) {
        out[block.id] = nested;
      }
    }
  }
  return out;
}

