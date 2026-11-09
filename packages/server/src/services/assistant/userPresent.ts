type Pending = { content: string; sentAt: number };

const pendingBySession = new Map<string, Pending[]>();

/** 用户正在这个 Issue 会话里发出的正文。回合结束时对上才打标记。 */
export function markIssueUserPresent(sessionId: string, content: string): void {
  const list = pendingBySession.get(sessionId) ?? [];
  list.push({ content, sentAt: Date.now() });
  pendingBySession.set(sessionId, list);
}

function isSystemInject(text: string): boolean {
  return text.startsWith("<system-inject>") && text.endsWith("</system-inject>");
}

function conversationText(message: object): string {
  if ((message as { isMeta?: boolean }).isMeta) return "";
  const blocks = (message as { blocks?: Array<{ type?: string; content?: string; source?: string }> }).blocks;
  if (!Array.isArray(blocks)) return "";
  if (blocks.some((block) => block.type === "bang" || block.type === "task_notification")) {
    return "";
  }
  return blocks
    .filter((block) => (block.type === "text" || block.type === "compact") && block.source !== "hook")
    .map((block) => block.content || "")
    .join("")
    .trim();
}

function turnMessages(messages: unknown[]): Array<{ text: string; at: number }> {
  const found: Array<{ text: string; at: number }> = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    const role = (message as { role?: string }).role;
    if (role === "assistant") {
      if (found.length > 0) break;
      continue;
    }
    if (role !== "user") continue;
    const text = conversationText(message);
    if (!text || isSystemInject(text)) continue;
    const raw = (message as { timestamp?: string }).timestamp;
    const at = raw ? Date.parse(raw) : Number.NaN;
    found.unshift({ text, at: Number.isFinite(at) ? at : 0 });
  }
  return found;
}

function sameSend(stored: string, sent: string): boolean {
  return stored === sent || stored.startsWith(`${sent}\n\n[Image source:`);
}

/** 这一轮的用户消息里有刚才他自己发出的，就记下并清掉对上的待处理项。 */
export function takeIssueUserPresent(sessionId: string, messages: unknown[]): boolean {
  const pending = pendingBySession.get(sessionId);
  if (!pending?.length) return false;
  const turns = turnMessages(messages);
  const used = new Set<number>();
  let hit = false;
  const rest: Pending[] = [];
  for (const item of pending) {
    const idx = turns.findIndex(
      (message, index) =>
        !used.has(index) &&
        message.at >= item.sentAt - 2000 &&
        sameSend(message.text, item.content),
    );
    if (idx >= 0) {
      used.add(idx);
      hit = true;
    } else {
      rest.push(item);
    }
  }
  if (rest.length > 0) pendingBySession.set(sessionId, rest);
  else pendingBySession.delete(sessionId);
  return hit;
}
