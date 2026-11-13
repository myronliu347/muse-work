import React, { useState } from "react";
import type { Message } from "@muse-work/agent";
import { bodyPortal } from "../../utils/bodyPortal";
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
  // Only a message that has reached the top edge counts. One still below the
  // edge must not steal the highlight from the question being read.
  const line = viewport.scrollTop + 1;
  let active = items[0]?.id;
  for (const item of items) {
    if (item.top <= line) active = item.id;
  }
  return active;
}

type Popover = {
  id: string;
  top: number;
  right: number;
};

export const UserMessageNav: React.FC<{
  entries: UserMessageNavEntry[];
  activeId?: string;
  onSelect: (messageId: string) => void;
}> = ({ entries, activeId, onSelect }) => {
  const [popover, setPopover] = useState<Popover | null>(null);
  if (entries.length === 0) return null;

  const showFor = (entryId: string, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setPopover({
      id: entryId,
      top: Math.min(
        Math.max(rect.top + rect.height / 2, 80),
        Math.max(80, window.innerHeight - 80),
      ),
      right: Math.max(8, window.innerWidth - rect.left + 8),
    });
  };

  const hovered = popover
    ? entries.find((entry) => entry.id === popover.id)
    : undefined;

  return (
    <>
      <nav
        className="user-message-nav"
        data-testid="user-message-nav"
        onScroll={() => setPopover(null)}
      >
        {entries.map((entry) => {
          const active = entry.id === activeId;
          return (
            <button
              key={entry.id}
              type="button"
              className={`user-message-nav-item${active ? " user-message-nav-item--active" : ""}${
                popover?.id === entry.id ? " user-message-nav-item--hover" : ""
              }`}
              data-testid={`user-message-nav-${entry.id}`}
              onClick={() => {
                setPopover(null);
                onSelect(entry.id);
              }}
              onPointerEnter={(event) => showFor(entry.id, event.currentTarget)}
              onPointerLeave={() => setPopover(null)}
              onFocus={(event) => showFor(entry.id, event.currentTarget)}
              onBlur={() => setPopover(null)}
            >
              <span className="user-message-nav-tick" aria-hidden="true" />
            </button>
          );
        })}
      </nav>
      {popover && hovered
        ? bodyPortal(
            <div
              className="user-message-nav-popover"
              data-testid="user-message-nav-popover"
              role="tooltip"
              style={{ top: popover.top, right: popover.right }}
            >
              <div className="user-message-nav-popover-user">{hovered.text}</div>
              {hovered.reply ? (
                <div className="user-message-nav-popover-reply">
                  {hovered.reply}
                </div>
              ) : null}
            </div>,
          )
        : null}
    </>
  );
};
