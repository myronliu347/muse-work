import type { EnrichedFileSnapshot } from "../../types";
import type { Message as MessageType } from "@muse-work/agent";
import { shouldCollapseAssistantGroup } from "../message/AssistantWorkSummary";
import { segmentAssistantTurn } from "../message/toolActivity";

/** Matches --space-4 / --space-3 so virtual offsets line up with the column. */
export const COLUMN_PAD = 16;
export const ROW_GAP = 12;
export const STICKY_SLACK = 24;

export type FoldState = "plain" | "open" | "collapsed";

interface MeasuredEntry {
  height: number;
  fold: FoldState;
}

type UserRow = { kind: "user"; key: string; message: MessageType };
type AssistantRow = {
  kind: "assistant";
  key: string;
  messages: MessageType[];
  collapsed: boolean;
  single: boolean;
  finalText: { messageId: string; blockIndex: number } | null;
};
export type ListRow = UserRow | AssistantRow;

export const measuredHeights = new Map<string, MeasuredEntry>();
const MEASURED_HEIGHTS_LIMIT = 2000;
const HEIGHTS_STORAGE_KEY = "muse-webview:measured-heights:v1";
let measuredSum = 0;
let measuredCount = 0;
export let avgMeasuredHeight = 200;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function loadMeasuredHeights() {
  try {
    const raw = localStorage.getItem(HEIGHTS_STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as Array<[string, { h: number; f?: FoldState }]>;
    for (const [id, entry] of entries) {
      if (measuredHeights.size >= MEASURED_HEIGHTS_LIMIT) break;
      if (typeof id !== "string" || typeof entry?.h !== "number" || entry.h <= 0) {
        continue;
      }
      const fold =
        entry.f === "open" || entry.f === "collapsed" || entry.f === "plain"
          ? entry.f
          : "plain";
      measuredHeights.set(id, { height: entry.h, fold });
      measuredSum += entry.h;
      measuredCount++;
    }
    if (measuredCount > 0) avgMeasuredHeight = measuredSum / measuredCount;
  } catch {
    measuredHeights.clear();
    measuredSum = 0;
    measuredCount = 0;
    avgMeasuredHeight = 200;
  }
}

loadMeasuredHeights();

function scheduleSaveMeasuredHeights() {
  if (saveTimer !== undefined) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      const payload: Array<[string, { h: number; f: FoldState }]> = [];
      measuredHeights.forEach((entry, id) => {
        payload.push([id, { h: entry.height, f: entry.fold }]);
      });
      localStorage.setItem(HEIGHTS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota exceeded or storage unavailable — keep the in-memory cache.
    }
  }, 400);
}

export function recordMeasuredHeight(id: string, height: number, fold: FoldState) {
  if (height <= 0) return;
  const prev = measuredHeights.get(id);
  if (prev) {
    measuredSum += height - prev.height;
  } else {
    if (measuredHeights.size >= MEASURED_HEIGHTS_LIMIT) {
      const oldest = measuredHeights.keys().next().value;
      if (oldest !== undefined) {
        const evicted = measuredHeights.get(oldest);
        measuredHeights.delete(oldest);
        if (evicted) {
          measuredSum -= evicted.height;
          measuredCount = Math.max(0, measuredCount - 1);
        }
      }
    }
    measuredSum += height;
    measuredCount++;
  }
  if (measuredCount > 0) avgMeasuredHeight = measuredSum / measuredCount;
  measuredHeights.set(id, { height, fold });
  scheduleSaveMeasuredHeights();
}

/** Locate the last non-empty text block in an assistant group. */
function findFinalTextBlock(
  groupMessages: MessageType[],
): { messageId: string; blockIndex: number } | null {
  for (let mi = groupMessages.length - 1; mi >= 0; mi--) {
    const message = groupMessages[mi];
    const blocks = message.blocks ?? [];
    for (let bi = blocks.length - 1; bi >= 0; bi--) {
      const block = blocks[bi];
      if (block.type === "text" && block.content?.trim()) {
        return { messageId: message.id, blockIndex: bi };
      }
    }
  }
  return null;
}

/** Hide the bottom hint only when a standalone thought is already the live status. */
export function hasVisibleInProgressReasoning(messages: MessageType[]): boolean {
  const turn: MessageType[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") {
      if (message.isMeta) continue;
      break;
    }
    if (message.role === "assistant") turn.unshift(message);
  }
  if (turn.length === 0) return false;
  const segments = segmentAssistantTurn(turn);
  const last = segments[segments.length - 1];
  if (!last || last.type !== "single") return false;
  const block = turn[last.ref.messageIndex]?.blocks?.[last.ref.blockIndex];
  return block?.type === "reasoning" && block.stage !== "end";
}

function countTimelineBlocks(message: MessageType): number {
  if (!message.blocks) return 0;
  let count = 0;
  for (const block of message.blocks) {
    switch (block.type) {
      case "text":
      case "compact":
        if (block.content && block.content.trim()) count++;
        break;
      case "tool":
      case "reasoning":
        count++;
        break;
    }
  }
  return count;
}

export function userRowText(message: MessageType): string {
  return (message.blocks ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.content || "")
    .join(" ")
    .trim();
}

export function systemInjectBody(message: MessageType): string | null {
  for (const block of message.blocks ?? []) {
    if (block.type !== "text") continue;
    const match = (block.content ?? "").match(
      /^<system-inject>([\s\S]*)<\/system-inject>$/,
    );
    if (match) return match[1].trim();
  }
  return null;
}

export function defaultFoldState(row: ListRow): FoldState {
  if (row.kind === "user") return "plain";
  return row.collapsed ? "collapsed" : "open";
}

export function detectFoldState(node: HTMLElement): FoldState {
  if (node.querySelector('[data-testid="assistant-group-collapsed"]')) {
    return "collapsed";
  }
  if (node.querySelector(".assistant-group")) return "open";
  return "plain";
}

export function buildRows(messages: MessageType[], isStreaming: boolean | undefined): ListRow[] {
  const visible: MessageType[] = [];
  for (const message of messages) {
    if (message.role === "user" && message.isMeta) continue;
    visible.push(message);
  }
  const rows: ListRow[] = [];
  let group: MessageType[] = [];
  const lastVisibleId = visible[visible.length - 1]?.id;
  const flushGroup = () => {
    if (group.length === 0) return;
    const groupMessages = group;
    const isLiveGroup =
      Boolean(isStreaming) && groupMessages.some((message) => message.id === lastVisibleId);
    const finalText = findFinalTextBlock(groupMessages);
    const collapsed = !isLiveGroup && Boolean(finalText) && shouldCollapseAssistantGroup(groupMessages);
    const dotCount = groupMessages.reduce((sum, message) => sum + countTimelineBlocks(message), 0);
    rows.push({
      kind: "assistant",
      key: `g:${groupMessages[0].id}`,
      messages: groupMessages,
      collapsed,
      single: dotCount <= 1,
      finalText,
    });
    group = [];
  };
  for (const message of visible) {
    if (message.role === "assistant") {
      group.push(message);
    } else {
      flushGroup();
      rows.push({ kind: "user", key: message.id, message });
    }
  }
  flushGroup();
  return rows;
}

export function latestTurnFileHistory(
  messages: MessageType[],
  workdir: string | undefined,
): { messageIds: string[]; snapshots: EnrichedFileSnapshot[] } | null {
  const visible: MessageType[] = [];
  for (const message of messages) {
    if (message.role === "user" && message.isMeta) continue;
    visible.push(message);
  }
  const mergedSnapshots: EnrichedFileSnapshot[] = [];
  const turnMessageIds: string[] = [];
  let inTurn = false;
  for (let i = visible.length - 1; i >= 0; i--) {
    const message = visible[i];
    if (message.role === "user" && !message.isMeta) break;
    if (message.role !== "assistant") continue;
    inTurn = true;
    turnMessageIds.push(message.id);
    const historyBlock = (message.blocks ?? []).find((block) => block.type === "file_history") as
      | { type: "file_history"; snapshots: unknown[] }
      | undefined;
    if (historyBlock && Array.isArray(historyBlock.snapshots) && historyBlock.snapshots.length > 0) {
      mergedSnapshots.push(
        ...(historyBlock.snapshots as unknown as EnrichedFileSnapshot[]).filter(
          (snapshot) => !workdir || (snapshot.filePath ?? "").startsWith(workdir),
        ),
      );
    }
  }
  if (!inTurn || mergedSnapshots.length === 0 || turnMessageIds.length === 0) return null;
  return { messageIds: turnMessageIds, snapshots: mergedSnapshots };
}
