import type { Message, MessageBlock, ToolBlock } from "@muse-work/agent";

/**
 * Live updates for a session the app is only watching (the assistant's own
 * agent session, shown by 轨迹). The events arrive over the socket exactly as
 * they do for the current session; this applies the same block semantics the
 * chat reducer uses, against a plain message array.
 */
export type WatchedTranscriptEvent =
  | { type: "assistant:message"; messageId: string }
  | { type: "messages:append"; messages: unknown[] }
  | {
      type: "message:delta";
      messageId?: string;
      text: string;
      stage?: "streaming" | "end";
    }
  | {
      type: "reasoning:delta";
      messageId: string;
      text: string;
      stage: "streaming" | "end";
    }
  | { type: "tool:update"; params: Record<string, unknown> };

function replaceMessage(
  messages: Message[],
  index: number,
  blocks: MessageBlock[],
): Message[] {
  return messages.map((message, i) =>
    i === index ? { ...message, blocks } : message,
  );
}

function emptyAssistant(messageId: string): Message {
  return {
    id: messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
    blocks: [],
  } as Message;
}

function applyTextDelta(
  messages: Message[],
  messageId: string | undefined,
  text: string,
  stage: "streaming" | "end" | undefined,
): Message[] {
  if (!messageId || !text) return messages;
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) return messages;
  const message = messages[index];
  const blockIndex = message.blocks.findIndex((block) => block.type === "text");
  const blocks =
    blockIndex === -1
      ? [...message.blocks, { type: "text", content: text, stage } as MessageBlock]
      : message.blocks.map((block, i) =>
          i === blockIndex && block.type === "text"
            ? { ...block, content: block.content + text, stage }
            : block,
        );
  return replaceMessage(messages, index, blocks);
}

function applyReasoningDelta(
  messages: Message[],
  messageId: string,
  text: string,
  stage: "streaming" | "end",
): Message[] {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) return messages;
  const message = messages[index];
  const blockIndex = message.blocks.findIndex(
    (block) => block.type === "reasoning",
  );
  const blocks =
    blockIndex === -1
      ? [
          ...message.blocks,
          {
            type: "reasoning",
            content: text,
            stage,
            startTime: Date.now(),
            ...(stage === "end" ? { endTime: Date.now() } : {}),
          } as MessageBlock,
        ]
      : message.blocks.map((block, i) =>
          i === blockIndex && block.type === "reasoning"
            ? {
                ...block,
                content: block.content + text,
                stage,
                ...(stage === "end" ? { endTime: Date.now() } : {}),
              }
            : block,
        );
  return replaceMessage(messages, index, blocks);
}

function applyToolUpdate(
  messages: Message[],
  params: Record<string, unknown>,
): Message[] {
  const messageId =
    typeof params.messageId === "string" ? params.messageId : "";
  const toolBlockId = typeof params.id === "string" ? params.id : "";
  if (!messageId || !toolBlockId) return messages;
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) return messages;
  const message = messages[index];
  const blockIndex = message.blocks.findIndex(
    (block) => block.type === "tool" && block.id === toolBlockId,
  );
  const parametersChunk =
    typeof params.parametersChunk === "string" ? params.parametersChunk : "";
  const { messageId: _messageId, parametersChunk: _chunk, ...rest } = params;

  const blocks =
    blockIndex === -1
      ? [
          ...message.blocks,
          {
            type: "tool",
            id: toolBlockId,
            name: typeof rest.name === "string" ? rest.name : "",
            stage: (rest.stage as ToolBlock["stage"]) ?? "start",
            result: typeof rest.result === "string" ? rest.result : "",
            success: rest.success === true,
            parameters:
              (typeof rest.parameters === "string" ? rest.parameters : "") +
              parametersChunk,
            ...rest,
          } as ToolBlock,
        ]
      : message.blocks.map((block, i) => {
          if (i !== blockIndex || block.type !== "tool") return block;
          const merged = { ...block, ...rest } as ToolBlock;
          if (parametersChunk) {
            merged.parameters = `${block.parameters ?? ""}${parametersChunk}`;
          }
          return merged;
        });
  return replaceMessage(messages, index, blocks);
}

/** Fold one watched-session event into the transcript. Unknown events pass through. */
export function applyWatchedTranscriptEvent(
  messages: Message[],
  event: WatchedTranscriptEvent,
): Message[] {
  switch (event.type) {
    case "messages:append": {
      const incoming = (Array.isArray(event.messages) ? event.messages : [])
        .filter((item): item is Message => Boolean(item) && typeof item === "object");
      if (incoming.length === 0) return messages;
      const known = new Set(messages.map((message) => message.id));
      const fresh = incoming.filter((message) => !known.has(message.id));
      return fresh.length === 0 ? messages : [...messages, ...fresh];
    }
    case "assistant:message": {
      if (messages.some((message) => message.id === event.messageId)) {
        return messages;
      }
      return [...messages, emptyAssistant(event.messageId)];
    }
    case "message:delta":
      return applyTextDelta(
        messages,
        event.messageId,
        event.text,
        event.stage,
      );
    case "reasoning:delta":
      return applyReasoningDelta(
        messages,
        event.messageId,
        event.text,
        event.stage,
      );
    case "tool:update":
      return applyToolUpdate(messages, event.params);
    default:
      return messages;
  }
}
