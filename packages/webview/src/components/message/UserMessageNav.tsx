import React, { useState } from "react";
import type { Message } from "@muse-work/agent";
import "../../styles/UserMessageNav.css";

export type UserMessageNavEntry = {
  id: string;
  text: string;
  /** Last assistant text block in the turn, shown alongside the question. */
  reply?: string;
};

export function navEntriesFromMessages(
  messages: Message[],
): UserMessageNavEntry[] {
  const out: UserMessageNavEntry[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "user" || message.isMeta) continue;
    const text = (message.blocks ?? [])
      .filter((b) => b.type === "text" || b.type === "compact")
      .map((b) => b.content || "")
      .join("")
      .trim();
    if (!text || !message.id) continue;

    let reply = "";
    for (let next = index + 1; next < messages.length; next += 1) {
      const candidate = messages[next];
      if (candidate.role === "user") break;
      if (candidate.role !== "assistant") continue;
      const texts = (candidate.blocks ?? []).filter(
        (b) => b.type === "text" && (b.content || "").trim(),
      );
      if (texts.length > 0) {
        reply = (
          (texts[texts.length - 1] as { content?: string }).content ?? ""
        ).trim();
      }
    }
    out.push(reply ? { id: message.id, text, reply } : { id: message.id, text });
  }
  return out;
}

/** User message sitting at the top of the viewport. Later messages that are
 * merely still visible do not take the highlight. */
export function pickActiveUserMessageId(
  items: Array<{ id: string; top: number }>,
  viewport: { scrollTop: number; clientHeight: number },
): string | undefined {
  if (items.length === 0) return undefined;
  // Only a message that has reached the top edge counts. One still below
  // the edge must not steal the highlight from the question being read.
  const line = viewport.scrollTop + 1;
  let active = items[0]?.id;
  for (const item of items) {
    if (item.top <= line) active = item.id;
  }
  return active;
}

export const UserMessageNav: React.FC<{
  entries: UserMessageNavEntry[];
  activeId?: string;
  onSelect: (messageId: string) => void;
}> = ({ entries, activeId, onSelect }) => {
  const [hovered, setHovered] = useState(false);
  if (entries.length === 0) return null;

  return (
    <nav
      className="user-message-nav"
      data-testid="user-message-nav"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {entries.map((entry) => {
        const active = entry.id === activeId;
        return (
          <button
            key={entry.id}
            type="button"
            className={`user-message-nav-item${active ? " user-message-nav-item--active" : ""}`}
            data-testid={`user-message-nav-${entry.id}`}
            title={entry.reply ? `${entry.text}\n\n${entry.reply}` : entry.text}
            onClick={() => onSelect(entry.id)}
          >
            {hovered ? (
              <span className="user-message-nav-label">
                <span className="user-message-nav-label-user">{entry.text}</span>
                {entry.reply ? (
                  <span className="user-message-nav-label-reply">{entry.reply}</span>
                ) : null}
              </span>
            ) : null}
            <span className="user-message-nav-tick" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
};
