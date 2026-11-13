import type { AssistantLine } from "../components/assistant/AssistantPage";

export type AssistantTranscriptSnapshot = {
  lines: AssistantLine[];
  hasMore: boolean;
  savedAt: number;
};

/** A snapshot older than this is not worth a stale first paint. */
const MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Last loaded 灵光 transcript. The assistant page unmounts when the user moves
 * to 会话 / 设置, so without this every return remounts with an empty list and
 * refetches `/assistant/messages` — the column paints empty (or the welcome)
 * for a beat before the conversation comes back.
 *
 * The page still refetches on mount; this snapshot only seeds the first paint
 * (stale-while-revalidate). It is keyed by the API client so a new ChatApp
 * (tests, another pane) starts clean; `resetWebviewStores` clears it too.
 */
let snapshots = new WeakMap<object, AssistantTranscriptSnapshot>();

export function readAssistantTranscriptCache(
  owner: object,
): AssistantTranscriptSnapshot | null {
  const snapshot = snapshots.get(owner);
  if (!snapshot) return null;
  if (Date.now() - snapshot.savedAt > MAX_AGE_MS) {
    snapshots.delete(owner);
    return null;
  }
  return snapshot;
}

export function writeAssistantTranscriptCache(
  owner: object,
  next: Omit<AssistantTranscriptSnapshot, "savedAt">,
): void {
  // Replace, never append: the snapshot is one page of lines, so the cache
  // stays bounded by the transcript page the page just fetched.
  snapshots.set(owner, { ...next, savedAt: Date.now() });
}

export function resetAssistantTranscriptCache(): void {
  snapshots = new WeakMap();
}
