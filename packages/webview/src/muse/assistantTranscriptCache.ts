import type { AssistantLine } from "../components/assistant/AssistantPage";

export type AssistantTranscriptSnapshot = {
  lines: AssistantLine[];
  hasMore: boolean;
};

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
  return snapshots.get(owner) ?? null;
}

export function writeAssistantTranscriptCache(
  owner: object,
  next: AssistantTranscriptSnapshot,
): void {
  snapshots.set(owner, next);
}

export function resetAssistantTranscriptCache(): void {
  snapshots = new WeakMap();
}
