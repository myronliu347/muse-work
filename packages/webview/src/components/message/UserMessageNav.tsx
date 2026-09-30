import React from "react";
import type { Message } from "@muse-work/agent";
import "../../styles/UserMessageNav.css";

export type UserMessageNavEntry = { id: string; text: string };

export function navEntriesFromMessages(
  messages: Message[],
): UserMessageNavEntry[] {
  const out: UserMessageNavEntry[] = [];
  for (const message of messages) {
    if (message.role !== "user" || message.isMeta) continue;
    const text = (message.blocks ?? [])
      .filter((b) => b.type === "text" || b.type === "compact")
      .map((b) => b.content || "")
      .join("")
      .trim();
    if (!text || !message.id) continue;
    out.push({ id: message.id, text });
  }
  return out;
}

/** Last user message whose top has entered the viewport (from the top). */
export function pickActiveUserMessageId(
  items: Array<{ id: string; top: number }>,
  viewport: { scrollTop: number; clientHeight: number },
): string | undefined {
  if (items.length === 0) return undefined;
  const threshold = viewport.scrollTop + viewport.clientHeight - 48;
  let active = items[0]?.id;
  for (const item of items) {
    if (item.top < threshold) active = item.id;
  }
  return active;
}

export const UserMessageNav: React.FC<{
  entries: UserMessageNavEntry[];
  activeId?: string;
  onSelect: (messageId: string) => void;
}> = ({ entries, activeId, onSelect }) => {
  if (entries.length === 0) return null;

  return (
    <nav className="user-message-nav" data-testid="user-message-nav">
      {entries.map((entry) => {
        const active = entry.id === activeId;
        return (
          <button
            key={entry.id}
            type="button"
            className={`user-message-nav-item${active ? " user-message-nav-item--active" : ""}`}
            data-testid={`user-message-nav-${entry.id}`}
            title={entry.text}
            onClick={() => onSelect(entry.id)}
          >
            <span className="user-message-nav-label">{entry.text}</span>
            <span className="user-message-nav-tick" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
};
