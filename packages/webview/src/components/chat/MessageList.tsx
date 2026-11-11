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
import { AssistantWorkSummary } from "../message/AssistantWorkSummary";
import { ToolActivityGroup } from "../message/ToolActivityGroup";
import {
  activityGroupDefaultOpen,
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
import {
  COLUMN_PAD,
  ROW_GAP,
  STICKY_SLACK,
  avgMeasuredHeight,
  buildRows,
  defaultFoldState,
  detectFoldState,
  hasVisibleInProgressReasoning,
  latestTurnFileHistory,
  measuredHeights,
  recordMeasuredHeight,
  systemInjectBody,
  userRowText,
  type ListRow,
} from "./messageListModel";


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
    // Update stickyRef before setState so repeated observers in the same
    // frame (ResizeObserver / scroll) see the pending pin and do not each
    // schedule another nested update ("Maximum update depth exceeded").
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
      if (same) return;
      stickyRef.current = next;
      setStickyMessage(next);
    };
    if (!container) {
      setSticky(null);
      return;
    }
    const list = rowsRef.current;
    const at = virtualizer.getVirtualItemForOffset(container.scrollTop);
    let index = at ? at.index : -1;
    // Jumping to a message aligns its row with the top edge. That row is
    // already on screen, so pinning the previous one paints the wrong
    // question over it.
    if (
      at &&
      list[at.index]?.kind === "user" &&
      at.start <= container.scrollTop + 1 &&
      at.end > container.scrollTop + 1
    ) {
      const into = container.scrollTop - at.start;
      if (into <= 1) {
        setSticky(null);
        return;
      }
    }
    if (at && at.start > container.scrollTop) index = at.index - 1;
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

  const computeStickyRef = useRef(computeSticky);
  computeStickyRef.current = computeSticky;
  const computeActiveNavRef = useRef(computeActiveNav);
  computeActiveNavRef.current = computeActiveNav;
  const stickyNavRafRef = useRef<number | undefined>(undefined);
  const scheduleStickyNav = useCallback(() => {
    if (stickyNavRafRef.current !== undefined) return;
    stickyNavRafRef.current = requestAnimationFrame(() => {
      stickyNavRafRef.current = undefined;
      computeStickyRef.current();
      computeActiveNavRef.current();
    });
  }, []);

  const scrollToMessage = useCallback(
    (id: string) => {
      const index = rowsRef.current.findIndex(
        (row) => row.kind === "user" && row.message.id === id,
      );
      if (index < 0) return;
      userScrolledUpRef.current = true;
      setActiveNavId(id);
      virtualizer.scrollToIndex(index, { align: "start", behavior: "auto" });
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
      scheduleStickyNav();
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && event.deltaY < 0) userScrolledUpRef.current = true;
    };

    container.addEventListener("scroll", handleScroll);
    container.addEventListener("wheel", handleWheel, { passive: true });

    // Coalesce observer callbacks to one frame. Observe + measure + sticky
    // setState in the same turn nested past React's update depth limit.
    const resizeObserver = new ResizeObserver(() => {
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = container.clientHeight;
      scheduleStickyNav();
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
    scheduleStickyNav();

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", handleWheel);
      if (stickyNavRafRef.current !== undefined) {
        cancelAnimationFrame(stickyNavRafRef.current);
        stickyNavRafRef.current = undefined;
      }
    };
  }, [
    messages,
    queuedMessages,
    isStreaming,
    hasOlderMessages,
    scrollToBottom,
    scheduleStickyNav,
  ]);

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

  // Keep ref aligned after React commits (e.g. session swap clears nav/pin).
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
          defaultOpen={activityGroupDefaultOpen(turnMessages, segment.refs)}
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
