import type { Message, SessionMetadata } from "@muse-work/agent";

const DEFAULT_SESSION_TITLE = "新对话";

/** Muse persists an explicit title (auto or user-renamed) on the session. */
type SessionWithTitle = SessionMetadata & { title?: string };

const customSessionTitle = (session: SessionMetadata): string | undefined => {
  const title = (session as SessionWithTitle).title;
  if (typeof title !== "string") return undefined;
  const trimmed = title.trim();
  if (!trimmed || trimmed === DEFAULT_SESSION_TITLE) return undefined;
  return trimmed;
};

const truncate = (content: string): string => {
  const trimmed = content.trim();
  return trimmed.length > 30 ? trimmed.substring(0, 30) + "..." : trimmed;
};

/** Extract the first real user message text, used as a session title fallback. */
export const firstUserMessageText = (
  messages?: Message[],
): string | undefined => {
  if (!messages) return undefined;
  for (const message of messages) {
    if (message.role !== "user" || message.isMeta) continue;
    const text = message.blocks
      ?.filter((b) => b.type === "text" || b.type === "compact")
      .map((b) => b.content || "")
      .join("")
      .trim();
    if (text) return text;
  }
  return undefined;
};

export const formatSessionLabel = (session: SessionMetadata): string => {
  // Use firstMessage content if available, limited to 30 characters
  if (session.firstMessage && session.firstMessage.trim()) {
    return truncate(session.firstMessage);
  }

  // No first message yet (e.g. a freshly created session): show a friendly
  // default rather than a bare timestamp.
  return DEFAULT_SESSION_TITLE;
};

/**
 * Pin the session title from the first user message while it is still in the
 * message list. Compaction later truncates the list to [compact, ...tail
 * rounds] (assistant-only), so deriving after the fact comes up empty and the
 * header would fall back to the default title. An already-set firstMessage
 * always wins.
 */
export const pinSessionTitle = (
  currentSession: SessionMetadata | undefined,
  messages?: Message[],
): SessionMetadata | undefined => {
  if (!currentSession || currentSession.firstMessage) return currentSession;
  const derived = firstUserMessageText(messages);
  return derived
    ? { ...currentSession, firstMessage: derived }
    : currentSession;
};

/**
 * Resolve the header title for the active session.
 *
 * Preference: explicit session.title (sidebar rename / auto-title) → pinned
 * firstMessage → first user message in the list → default. Title "新对话" is
 * treated as unset so a just-created session still picks up the first message
 * before the host finishes patching the stored title.
 */
export const getSessionTitle = (
  currentSession: SessionMetadata | undefined,
  messages?: Message[],
): string => {
  if (!currentSession) return DEFAULT_SESSION_TITLE;
  const renamed = customSessionTitle(currentSession);
  if (renamed) return renamed;
  if (currentSession.firstMessage && currentSession.firstMessage.trim()) {
    return truncate(currentSession.firstMessage);
  }
  const derived = firstUserMessageText(messages);
  if (derived) return truncate(derived);
  return DEFAULT_SESSION_TITLE;
};
