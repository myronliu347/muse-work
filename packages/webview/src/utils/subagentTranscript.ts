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

export function resolveSubagentMessages(
  subagentMessages: Record<string, Message[]>,
  agentToolSubagentIds: Record<string, string>,
  toolId: string,
  options?: {
    nestedMessages?: Message[];
    fallbackText?: string;
  },
): Message[] {
  const mappedId = (toolId && agentToolSubagentIds[toolId]) || toolId;
  const candidates = uniqueTranscripts([
    mappedId ? subagentMessages[mappedId] : undefined,
    toolId && toolId !== mappedId ? subagentMessages[toolId] : undefined,
    options?.nestedMessages,
  ]);
  if (candidates.length > 0) {
    return pickRichest(candidates);
  }

  const unique = uniqueTranscripts(Object.values(subagentMessages));
  if (unique.length === 1) {
    return unique[0];
  }

  const trimmed = options?.fallbackText?.trim();
  if (trimmed) {
    return [
      {
        id: "agent-fallback",
        role: "assistant",
        timestamp: new Date().toISOString(),
        blocks: [{ type: "text", content: trimmed }],
      },
    ];
  }
  return [];
}
