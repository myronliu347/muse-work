import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useCallback,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  useVirtualizer,
  elementScroll,
  observeElementRect,
} from "@tanstack/react-virtual";
import { Message } from "../message/Message";
import { FileHistoryCard } from "../message/FileHistoryCard";
import {
  AssistantWorkSummary,
  shouldCollapseAssistantGroup,
} from "../message/AssistantWorkSummary";
import { ToolActivityGroup } from "../message/ToolActivityGroup";
import {
  currentStatusLabel,
  segmentAssistantTurn,
  summarizeRefs,
} from "../message/toolActivity";
import type { EnrichedFileSnapshot, MessageListProps } from "../../types";
import type { Message as MessageType } from "@muse-work/agent";
import {
  UserMessageNav,
  navEntriesFromMessages,
  pickActiveUserMessageId,
} from "../message/UserMessageNav";
import { scrollTopAfterSizeChange } from "./followScroll";
import { HoldTranscriptScrollProvider } from "./holdTranscriptScroll";
import "../../styles/MessageList.css";

/** Matches --space-4 / --space-3 so virtual offsets line up with the column. */
const COLUMN_PAD = 16;
const ROW_GAP = 12;
const STICKY_SLACK = 24;

type FoldState = "plain" | "open" | "collapsed";

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
type ListRow = UserRow | AssistantRow;

const measuredHeights = new Map<string, MeasuredEntry>();
const MEASURED_HEIGHTS_LIMIT = 2000;
const HEIGHTS_STORAGE_KEY = "muse-webview:measured-heights:v1";
let measuredSum = 0;
let measuredCount = 0;
let avgMeasuredHeight = 200;
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

function recordMeasuredHeight(id: string, height: number, fold: FoldState) {
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
function hasVisibleInProgressReasoning(messages: MessageType[]): boolean {
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

function userRowText(message: MessageType): string {
  return (message.blocks ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.content || "")
    .join(" ")
    .trim();
}

function systemInjectBody(message: MessageType): string | null {
  for (const block of message.blocks ?? []) {
    if (block.type !== "text") continue;
    const match = (block.content ?? "").match(
      /^<system-inject>([\s\S]*)<\/system-inject>$/,
    );
    if (match) return match[1].trim();
  }
  return null;
}

function defaultFoldState(row: ListRow): FoldState {
  if (row.kind === "user") return "plain";
  return row.collapsed ? "collapsed" : "open";
}

function detectFoldState(node: HTMLElement): FoldState {
  if (node.querySelector('[data-testid="assistant-group-collapsed"]')) {
    return "collapsed";
  }
  if (node.querySelector(".assistant-group")) return "open";
  return "plain";
}

function buildRows(messages: MessageType[], isStreaming: boolean | undefined): ListRow[] {
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

function latestTurnFileHistory(
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

export const MessageList = forwardRef<
  { scrollToBottom: (behavior?: ScrollBehavior) => void },
  MessageListProps
>(function MessageList(
  {
    messages,
    queuedMessages,
    isStreaming,
    isCompacting,
    vscode,
    onRewindToMessage,
    workdir,
    onOpenPreview,
    onOpenFile,
    openHttpInBrowser,
    onOpenAgentTranscript,
    hasOlderMessages,
    onLoadOlder,
    onRevertFileHistory,
    revertingFileHistory,
    onOpenFileHistoryFile,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);

  const prevMessagesLengthRef = useRef(messages.length);
  const prevQueuedLengthRef = useRef(queuedMessages?.length || 0);
  const isFirstEffectRef = useRef(true);
  const isFirstLayoutRef = useRef(true);
  const prevListHeadRef = useRef<string | undefined>(messages[0]?.id);
  const requestedOlderRef = useRef<string | undefined>(undefined);
  const onLoadOlderRef = useRef(onLoadOlder);
  onLoadOlderRef.current = onLoadOlder;
  const stickyHeadRef = useRef<string | undefined>(messages[0]?.id);
  // Session-swap pin happens before paint. The follow effect must not scroll
  // again afterwards, or the list jumps a second time once the frame is visible.
  const skipFollowRef = useRef(false);
  const pinTokenRef = useRef(0);
  const aliveRef = useRef(true);
  const userScrolledUpRef = useRef(false);
  // True while a disclosure toggle is resizing a row the user is reading.
  const holdScrollRef = useRef(false);
  const pendingProgrammaticScrollsRef = useRef(0);
  const programmaticClearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const prevScrollTopRef = useRef(0);
  const prevScrollHeightRef = useRef(0);
  const prevClientHeightRef = useRef(0);

  const [stickyMessage, setStickyMessage] = useState<{
    id: string;
    text: string;
    system: boolean;
    message: MessageType;
  } | null>(null);
  const stickyRef = useRef<{
    id: string;
    text: string;
    system: boolean;
    message: MessageType;
  } | null>(null);
  const [activeNavId, setActiveNavId] = useState<string | undefined>();
  const listHead = messages[0]?.id;
  if (listHead !== stickyHeadRef.current) {
    stickyHeadRef.current = listHead;
    if (activeNavId !== undefined) setActiveNavId(undefined);
  }
  const navEntries = useMemo(() => navEntriesFromMessages(messages), [messages]);

  const rows = useMemo(() => buildRows(messages, isStreaming), [messages, isStreaming]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const fileHistory = useMemo(
    () => (isStreaming ? null : latestTurnFileHistory(messages, workdir)),
    [messages, isStreaming, workdir],
  );

  const markProgrammaticScroll = useCallback(() => {
    pendingProgrammaticScrollsRef.current++;
    if (programmaticClearTimerRef.current === undefined) {
      programmaticClearTimerRef.current = setTimeout(() => {
        programmaticClearTimerRef.current = undefined;
        pendingProgrammaticScrollsRef.current = 0;
      }, 100);
    }
  }, []);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (!row) return avgMeasuredHeight;
      const cached = measuredHeights.get(row.key);
      if (cached && cached.fold === defaultFoldState(row)) return cached.height;
      return avgMeasuredHeight;
    },
    measureElement: (node, entry) => {
      const element = node as HTMLElement;
      const box = entry?.borderBoxSize?.[0]?.blockSize;
      const measured = typeof box === "number" ? box : element.offsetHeight;
      const height = measured > 0 ? Math.round(measured) : 0;
      const id = element.getAttribute("data-measured-row-key");
      if (id && height > 0) recordMeasuredHeight(id, height, detectFoldState(element));
      if (height > 0) return height;
      const index = Number(element.getAttribute("data-index"));
      const row = rows[index];
      if (!row) return avgMeasuredHeight;
      const cached = measuredHeights.get(row.key);
      if (cached && cached.fold === defaultFoldState(row)) return cached.height;
      return avgMeasuredHeight;
    },
    overscan: 20,
    gap: ROW_GAP,
    paddingStart: COLUMN_PAD,
    paddingEnd: COLUMN_PAD,
    anchorTo: "end",
    // Appending starts scrollToEnd's per-frame reconcile, which fights the
    // end-anchor adjustment and shakes the scrollbar. New rows are pinned by
    // the message effect instead.
    followOnAppend: false,
    getItemKey: (index) => rows[index]?.key ?? index,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    useFlushSync: false,
    // Measure and correct scroll inside the resize observer, before paint.
    // Deferring to the next frame lets the user bubble jump, then snap back,
    // on every streaming growth.
    useAnimationFrameWithResizeObserver: false,
    // jsdom reports a 0×0 scrollport, which would mount zero rows. A real
    // layout replaces this on the first non-zero measurement.
    observeElementRect: (instance, cb) =>
      observeElementRect(instance, (rect) => {
        cb(
          rect.height > 0
            ? rect
            : { width: rect.width || 800, height: 100_000 },
        );
      }),
    scrollToFn: (offset, opts, instance) => {
      if (spacerRef.current) {
        spacerRef.current.style.height = `${instance.getTotalSize()}px`;
      }
      const adjustment = opts.adjustments ?? 0;
      const container = containerRef.current;
      const requestedTop = offset + adjustment;
      const currentTop = container?.scrollTop ?? requestedTop;
      const visualMax = container
        ? Math.max(0, container.scrollHeight - container.clientHeight)
        : requestedTop;
      const disclosure = holdScrollRef.current;
      const top = scrollTopAfterSizeChange(
        currentTop,
        requestedTop,
        visualMax,
        !userScrolledUpRef.current,
        adjustment,
        disclosure,
      );
      if (disclosure) {
        // applyScrollAdjustment adds this after scrollToFn returns. Zero it so
        // the virtualizer keeps the offset the user was reading.
        instance.scrollAdjustments = 0;
        return;
      }
      markProgrammaticScroll();
      if (top !== requestedTop) {
        container?.scrollTo?.({ top, behavior: opts.behavior });
        return;
      }
      elementScroll(offset, opts, instance);
    },
  });

  const measureRow = useCallback(
    (node: HTMLDivElement | null) => {
      virtualizer.measureElement(node);
    },
    [virtualizer],
  );

  const computeSticky = useCallback(() => {
    const container = containerRef.current;
    const setSticky = (
      next: { id: string; text: string; system: boolean; message: MessageType } | null,
    ) => {
      const prev = stickyRef.current;
      const same =
        prev === null
          ? next === null
          : next !== null &&
            prev.id === next.id &&
            prev.text === next.text &&
            prev.system === next.system;
      if (!same) setStickyMessage(next);
    };
    if (!container) {
      setSticky(null);
      return;
    }
    const at = virtualizer.getVirtualItemForOffset(container.scrollTop);
    let index = at ? at.index : -1;
    if (at && at.start >= container.scrollTop) index = at.index - 1;
    const list = rowsRef.current;
    let candidate: {
      id: string;
      text: string;
      system: boolean;
      message: MessageType;
    } | null = null;
    while (index >= 0) {
      const row = list[index];
      if (row?.kind === "user" && row.message.id) {
        const injected = systemInjectBody(row.message);
        const text = injected ?? userRowText(row.message);
        if (text) {
          candidate = {
            id: row.message.id,
            text,
            system: injected !== null,
            message: row.message,
          };
          break;
        }
      }
      index--;
    }
    // Streaming follow nudges scrollTop across the row boundary. Keep the
    // current pin only after that row has actually left the viewport. Holding
    // it while the row is back on screen mounts the bar over the visible copy.
    const prev = stickyRef.current;
    if (prev && (candidate === null || candidate.id !== prev.id)) {
      const prevIndex = list.findIndex(
        (row) => row.kind === "user" && row.message.id === prev.id,
      );
      const measure =
        prevIndex >= 0 ? virtualizer.measurementsCache[prevIndex] : undefined;
      const past =
        measure !== undefined ? container.scrollTop - measure.start : 0;
      if (measure && past > 0 && past <= STICKY_SLACK) {
        return;
      }
    }
    setSticky(candidate);
  }, [virtualizer]);

  const computeActiveNav = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const items: Array<{ id: string; top: number }> = [];
    const list = rowsRef.current;
    const measurements = virtualizer.measurementsCache;
    for (let index = 0; index < list.length; index++) {
      const row = list[index];
      if (row.kind !== "user" || !row.message.id) continue;
      const top = measurements[index]?.start;
      if (typeof top !== "number") continue;
      items.push({ id: row.message.id, top });
    }
    const next = pickActiveUserMessageId(items, {
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
    });
    setActiveNavId((prev) => (prev === next ? prev : next));
  }, [virtualizer]);

  const scrollToMessage = useCallback(
    (id: string) => {
      const index = rowsRef.current.findIndex(
        (row) => row.kind === "user" && row.message.id === id,
      );
      if (index >= 0) {
        virtualizer.scrollToIndex(index, { align: "center", behavior: "auto" });
      }
    },
    [virtualizer],
  );

  const doScrollToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      if (holdScrollRef.current) return;
      const container = containerRef.current;
      // scrollToEnd keeps a per-frame reconcile alive. During streaming that
      // reconcile and the virtualizer's end anchor take turns, so the pinned
      // user message shakes. One write to the visual bottom does not.
      if (!container) {
        virtualizer.scrollToEnd({ behavior });
        return;
      }
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      if (max - container.scrollTop <= 1) return;
      if (behavior === "auto") {
        markProgrammaticScroll();
        container.scrollTo({ top: max, behavior: "auto" });
        return;
      }
      virtualizer.scrollToEnd({ behavior });
    },
    [virtualizer, markProgrammaticScroll],
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth", force = false) => {
      const container = containerRef.current;
      if (!container) return;

      const isNearBottom =
        container.scrollTop + container.clientHeight >= container.scrollHeight - 300;
      const isUserMessage =
        messages.length > 0 && messages[messages.length - 1].role === "user";
      const shouldForce = force && (isUserMessage || !userScrolledUpRef.current);

      if (shouldForce || ((isStreaming || isNearBottom) && !userScrolledUpRef.current)) {
        if (shouldForce && isUserMessage) {
          userScrolledUpRef.current = false;
        }
        doScrollToBottom(behavior);
      }
    },
    [messages, isStreaming, doScrollToBottom],
  );

  useImperativeHandle(ref, () => ({
    scrollToBottom: (behavior: ScrollBehavior = "smooth") => {
      doScrollToBottom(behavior);
    },
  }));

  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Pin before paint. The previous session's scroll offset otherwise stays
  // on the new transcript for a frame, then the follow effect jumps to the end.
  // flushSync cannot run inside this layout effect: React warns and drops the
  // flush. The microtask still runs before paint, after this commit's effects.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || messages.length === 0) return;
    const head = messages[0]?.id;
    const previousHead = prevListHeadRef.current;
    const isPrepend =
      Boolean(head) &&
      Boolean(previousHead) &&
      head !== previousHead &&
      messages.findIndex((message) => message.id === previousHead) > 0;
    if (isPrepend) {
      const delta = container.scrollHeight - prevScrollHeightRef.current;
      if (delta > 0) container.scrollTop += delta;
      prevListHeadRef.current = head;
      prevScrollHeightRef.current = container.scrollHeight;
      isFirstLayoutRef.current = false;
      return;
    }
    const isSessionSwap = Boolean(head) && head !== previousHead;
    const isInitialLoad = isFirstLayoutRef.current;
    isFirstLayoutRef.current = false;
    if (!isSessionSwap && !isInitialLoad) return;
    prevListHeadRef.current = head;
    userScrolledUpRef.current = false;
    skipFollowRef.current = true;
    const token = ++pinTokenRef.current;
    queueMicrotask(() => {
      if (!aliveRef.current || token !== pinTokenRef.current) return;
      const el = containerRef.current;
      if (!el) return;
      flushSync(() => {
        virtualizer.scrollToEnd({ behavior: "auto" });
      });
      el.scrollTop = el.scrollHeight;
      // Decide the pinned user row before paint. Setting it from the passive
      // effect mounts the bar a frame late and the tail jumps.
      flushSync(() => {
        computeSticky();
      });
    });
  }, [messages, virtualizer, computeSticky]);

  // Same-head reload (the open tab's snapshot replaced by the live transcript)
  // must reach the tail before paint. A later smooth scroll replays the move.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || skipFollowRef.current || userScrolledUpRef.current) return;
    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    if (max - container.scrollTop <= 1) return;
    markProgrammaticScroll();
    container.scrollTo({ top: max, behavior: "auto" });
  }, [messages, isStreaming, markProgrammaticScroll]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const listHead = messages[0]?.id;
    if (
      requestedOlderRef.current &&
      requestedOlderRef.current !== listHead
    ) {
      requestedOlderRef.current = undefined;
    }
    const previousHead = prevListHeadRef.current;
    const isPrepend =
      Boolean(listHead) &&
      Boolean(previousHead) &&
      listHead !== previousHead &&
      messages.findIndex((message) => message.id === previousHead) > 0;
    const isSessionSwap =
      !isPrepend && Boolean(listHead) && listHead !== previousHead;
    prevListHeadRef.current = listHead;
    const isInitialLoad = isFirstEffectRef.current && messages.length > 0;
    isFirstEffectRef.current = false;
    if (isSessionSwap) userScrolledUpRef.current = false;
    const isNewMessage =
      messages.length > prevMessagesLengthRef.current ||
      (queuedMessages?.length || 0) > prevQueuedLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    prevQueuedLengthRef.current = queuedMessages?.length || 0;

    const handleScroll = () => {
      if (pendingProgrammaticScrollsRef.current > 0) {
        pendingProgrammaticScrollsRef.current--;
      } else {
        const isNearBottom =
          container.scrollTop + container.clientHeight >= container.scrollHeight - 300;
        const scrolledUp = container.scrollTop < prevScrollTopRef.current;
        const contentShrank = container.scrollHeight < prevScrollHeightRef.current;
        const viewportGrew = container.clientHeight > prevClientHeightRef.current;
        // The pinned bar is in-flow, so mounting it shrinks the scrollport and
        // the browser may clamp scrollTop. That is not the user leaving the tail.
        const viewportShrunk = container.clientHeight < prevClientHeightRef.current;
        if (scrolledUp && !contentShrank && !viewportGrew && !viewportShrunk) {
          userScrolledUpRef.current = true;
        } else if (isNearBottom) {
          userScrolledUpRef.current = false;
        }
        const oldestId = messages[0]?.id;
        if (
          hasOlderMessages &&
          onLoadOlder &&
          oldestId &&
          container.scrollTop < 48 &&
          requestedOlderRef.current !== oldestId
        ) {
          requestedOlderRef.current = oldestId;
          window.setTimeout(() => {
            if (requestedOlderRef.current === oldestId) {
              requestedOlderRef.current = undefined;
            }
          }, 3000);
          onLoadOlderRef.current?.();
        }
      }
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = container.clientHeight;
      computeSticky();
      computeActiveNav();
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && event.deltaY < 0) userScrolledUpRef.current = true;
    };

    container.addEventListener("scroll", handleScroll);
    container.addEventListener("wheel", handleWheel, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = container.clientHeight;
      computeSticky();
      computeActiveNav();
    });
    resizeObserver.observe(container);

    const skipFollow = skipFollowRef.current;
    if (skipFollow) skipFollowRef.current = false;
    // A same-head reload (tab switch replaces the snapshot) is pinned before
    // paint. Smooth scroll here replays that move and the tail shakes.
    if (!skipFollow && !isPrepend && isNewMessage && !isSessionSwap && !isInitialLoad) {
      scrollToBottom(isStreaming ? "auto" : "smooth", true);
    }
    const oldestId = messages[0]?.id;
    if (
      hasOlderMessages &&
      oldestId &&
      container.scrollHeight <= container.clientHeight + 48 &&
      requestedOlderRef.current !== oldestId
    ) {
      requestedOlderRef.current = oldestId;
      window.setTimeout(() => {
        if (requestedOlderRef.current === oldestId) {
          requestedOlderRef.current = undefined;
        }
      }, 3000);
      onLoadOlderRef.current?.();
    }
    computeSticky();
    computeActiveNav();

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", handleWheel);
    };
  }, [messages, queuedMessages, isStreaming, hasOlderMessages, scrollToBottom, computeSticky, computeActiveNav]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const repin = () => {
      if (!userScrolledUpRef.current) doScrollToBottom("auto");
    };
    container.addEventListener("load", repin, true);
    document.fonts?.ready.then(repin);
    return () => container.removeEventListener("load", repin, true);
  }, [doScrollToBottom]);

  useEffect(() => {
    const spacer = spacerRef.current;
    if (!spacer) return;
    const observer = new ResizeObserver(() => {
      if (!userScrolledUpRef.current) doScrollToBottom("auto");
    });
    observer.observe(spacer);
    return () => observer.disconnect();
  }, [doScrollToBottom]);

  useEffect(
    () => () => {
      if (programmaticClearTimerRef.current !== undefined) {
        clearTimeout(programmaticClearTimerRef.current);
        programmaticClearTimerRef.current = undefined;
      }
    },
    [],
  );

  const statusLabel = currentStatusLabel(messages);
  const showThinkingHint =
    isStreaming &&
    !isCompacting &&
    !hasVisibleInProgressReasoning(messages) &&
    statusLabel !== null;

  // Hints and the file card sit in the scroller, so they change the tail.
  // The pinned bar floats and must not move the list when it appears.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || userScrolledUpRef.current) return;
    if (!showThinkingHint && !isCompacting && !fileHistory) return;
    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    if (max - container.scrollTop <= 1) return;
    markProgrammaticScroll();
    container.scrollTo({ top: max, behavior: "auto" });
  }, [showThinkingHint, isCompacting, fileHistory, markProgrammaticScroll]);

  stickyRef.current = stickyMessage;

  const holdTranscriptScroll = useCallback(() => {
    userScrolledUpRef.current = true;
    holdScrollRef.current = true;
    // The row is measured in a resize observer before the next frame.
    // Release after that so later streaming can follow the tail again.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        holdScrollRef.current = false;
      });
    });
  }, []);

  const renderMessage = (
    message: MessageType,
    extras?: {
      blockRenderMode?: "all" | "omitFinalText" | "finalTextOnly";
      finalTextBlockIndex?: number;
      keySuffix?: string;
      onlyBlockIndex?: number;
      activityItem?: boolean;
    },
  ) => (
    <Message
      key={`${message.id}${extras?.keySuffix ?? ""}`}
      message={message}
      vscode={vscode}
      onRewindToMessage={onRewindToMessage}
      workdir={workdir}
      onOpenPreview={onOpenPreview}
      onOpenFile={onOpenFile}
      openHttpInBrowser={openHttpInBrowser}
      onOpenAgentTranscript={onOpenAgentTranscript}
      blockRenderMode={extras?.blockRenderMode}
      finalTextBlockIndex={extras?.finalTextBlockIndex}
      onlyBlockIndex={extras?.onlyBlockIndex}
      activityItem={extras?.activityItem}
    />
  );

  const renderAssistantTurn = (
    turnMessages: MessageType[],
    omit?: { messageId: string; blockIndex: number },
  ) => {
    const segments = segmentAssistantTurn(turnMessages, omit);
    return segments.map((segment) => {
      if (segment.type === "single") {
        const message = turnMessages[segment.ref.messageIndex];
        return renderMessage(message, {
          onlyBlockIndex: segment.ref.blockIndex,
          keySuffix: `-b${segment.ref.blockIndex}`,
        });
      }
      const summary = summarizeRefs(turnMessages, segment.refs);
      const head = segment.refs[0];
      return (
        <ToolActivityGroup
          key={`activity-${head?.messageIndex}-${head?.blockIndex}`}
          label={summary.label}
          additions={summary.additions}
          deletions={summary.deletions}
          defaultOpen={false}
        >
          {segment.refs.map((ref) =>
            renderMessage(turnMessages[ref.messageIndex], {
              onlyBlockIndex: ref.blockIndex,
              activityItem: true,
              keySuffix: `-a${ref.blockIndex}`,
            }),
          )}
        </ToolActivityGroup>
      );
    });
  };

  const renderRow = (row: ListRow) => {
    if (row.kind === "user") return renderMessage(row.message);
    const singleClass = row.single ? " assistant-group--single" : "";
    if (row.collapsed && row.finalText) {
      const finalText = row.finalText;
      return (
        <div
          className={`assistant-group${singleClass}`}
          data-testid="assistant-group-collapsed"
        >
          <AssistantWorkSummary messages={row.messages}>
            {renderAssistantTurn(row.messages, {
              messageId: finalText.messageId,
              blockIndex: finalText.blockIndex,
            })}
          </AssistantWorkSummary>
          {renderMessage(
            row.messages.find((message) => message.id === finalText.messageId)!,
            {
              blockRenderMode: "finalTextOnly",
              finalTextBlockIndex: finalText.blockIndex,
              keySuffix: "-final",
            },
          )}
        </div>
      );
    }
    return (
      <div className={`assistant-group${singleClass}`}>
        {renderAssistantTurn(row.messages)}
      </div>
    );
  };

  return (
    <HoldTranscriptScrollProvider value={holdTranscriptScroll}>
    <div className="messages-shell">
      {stickyMessage && (
        <div className="sticky-user-wrapper">
          <div className="sticky-user-dock">
            <div
              className={`sticky-user-message${stickyMessage.system ? " sticky-user-message--system" : ""}`}
              data-testid="sticky-user-message"
              onClick={() => scrollToMessage(stickyMessage.id)}
            >
              {stickyMessage.system ? (
                <Message
                  message={stickyMessage.message}
                  vscode={vscode}
                  workdir={workdir}
                  onOpenFile={onOpenFile}
                  onOpenPreview={onOpenPreview}
                  openHttpInBrowser={openHttpInBrowser}
                />
              ) : (
                <div className="sticky-user-content">{stickyMessage.text}</div>
              )}
            </div>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        id="messagesContainer"
        className={`messages-container messages-container--virtual${isStreaming ? " streaming" : ""}${isCompacting ? " compacting" : ""}`}
        data-testid="messages-container"
      >
        <div className="messages-column">
          <div
            ref={(node) => {
              virtualizer.containerRef(node);
              spacerRef.current = node;
            }}
            className="virtual-spacer"
          />
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                data-measured-row-key={row.key}
                ref={measureRow}
                className="virtual-row"
              >
                {renderRow(row)}
              </div>
            );
          })}
          {fileHistory && (
            <FileHistoryCard
              key={`file-history-${fileHistory.messageIds.join(",")}`}
              messageIds={fileHistory.messageIds}
              snapshots={fileHistory.snapshots}
              workdir={workdir}
              onOpenFile={onOpenFileHistoryFile}
              onRevert={onRevertFileHistory}
              reverting={revertingFileHistory}
            />
          )}
          {showThinkingHint && statusLabel && (
            <div className="message-list-status-hint" data-testid="thinking-hint">
              <span className="message-list-status-dot" aria-hidden="true" />
              <span className="message-list-status-label text-shimmer">{statusLabel}</span>
            </div>
          )}
          {isCompacting && (
            <div className="message-list-status-hint" data-testid="compaction-hint">
              <span className="message-list-status-dot" aria-hidden="true" />
              <span className="message-list-status-label">正在压缩对话…</span>
            </div>
          )}
        </div>
      </div>
      <UserMessageNav entries={navEntries} activeId={activeNavId} onSelect={scrollToMessage} />
    </div>
    </HoldTranscriptScrollProvider>
  );
});
