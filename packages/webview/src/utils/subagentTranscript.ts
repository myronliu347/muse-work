import type { Message } from "../types";

export function transcriptScore(messages: Message[] | undefined): number {
  if (!messages?.length) return 0;
  let score = messages.length;
  for (const message of messages) {
    if (message.role === "user") score += 100;
    for (const block of message.blocks ?? []) {
      if (block.type === "tool") score += 10;
      if (block.type === "text" && (block.content || "").trim()) score += 1;
    }
  }
  return score;
}

export function parseAgentPrompt(parameters?: string): string | undefined {
  if (!parameters?.trim()) return undefined;
  try {
    const parsed = JSON.parse(parameters) as { prompt?: unknown };
    return typeof parsed.prompt === "string" && parsed.prompt.trim()
      ? parsed.prompt.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function transcriptIdentity(messages: Message[]): string {
  return messages
    .map((message) => {
      const blocks = (message.blocks ?? [])
        .map((block) =>
          block.type === "tool" ? `tool:${block.id ?? block.name}` : block.type,
        )
        .join(",");
      return `${message.id}:${message.role}:${blocks}`;
    })
    .join("|");
}

function uniqueTranscripts(lists: Array<Message[] | undefined>): Message[][] {
  const seen = new Set<Message[] | string>();
  const out: Message[][] = [];
  for (const list of lists) {
    if (!list?.length) continue;
    if (seen.has(list)) continue;
    const key = transcriptIdentity(list);
    if (seen.has(key)) continue;
    seen.add(list);
    seen.add(key);
    out.push(list);
  }
  return out;
}

function pickRichest(lists: Message[][]): Message[] {
  return lists.reduce((best, current) =>
    transcriptScore(current) >= transcriptScore(best) ? current : best,
  );
}

function userText(message: Message): string {
  return (message.blocks ?? [])
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.content : ""))
    .join("\n")
    .trim();
}

function withLeadingPrompt(messages: Message[], prompt?: string): Message[] {
  const trimmed = prompt?.trim();
  if (!trimmed) return messages;
  const leadingUser = messages.find(
    (message) => message.role === "user" && !message.isMeta,
  );
  if (leadingUser) {
    const text = userText(leadingUser);
    if (
      !text ||
      text === trimmed ||
      text.includes(trimmed) ||
      trimmed.includes(text)
    ) {
      return messages;
    }
  }
  return [
    {
      id: "agent-prompt",
      role: "user",
      timestamp: messages[0]?.timestamp ?? new Date().toISOString(),
      blocks: [{ type: "text", content: trimmed }],
    },
    ...messages,
  ];
}

export function resolveSubagentMessages(
  subagentMessages: Record<string, Message[]>,
  agentToolSubagentIds: Record<string, string>,
  toolId: string,
  options?: {
    nestedMessages?: Message[];
    fallbackText?: string;
    prompt?: string;
  },
): Message[] {
  const mappedId = (toolId && agentToolSubagentIds[toolId]) || toolId;
  const candidates = uniqueTranscripts([
    mappedId ? subagentMessages[mappedId] : undefined,
    toolId && toolId !== mappedId ? subagentMessages[toolId] : undefined,
    options?.nestedMessages,
  ]);
  let resolved: Message[] = [];
  if (candidates.length > 0) {
    resolved = pickRichest(candidates);
  } else {
    const unique = uniqueTranscripts(Object.values(subagentMessages));
    if (unique.length === 1) {
      resolved = unique[0];
    } else {
      const trimmed = options?.fallbackText?.trim();
      if (trimmed) {
        resolved = [
          {
            id: "agent-fallback",
            role: "assistant",
            timestamp: new Date().toISOString(),
            blocks: [{ type: "text", content: trimmed }],
          },
        ];
      }
    }
  }
  return withLeadingPrompt(resolved, options?.prompt);
}
