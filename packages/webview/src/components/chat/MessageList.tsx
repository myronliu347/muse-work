import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useCallback,
  useState,
} from "react";
import { Message } from "../message/Message";
import { FileHistoryCard } from "../message/FileHistoryCard";
import {
  AssistantWorkSummary,
  shouldCollapseAssistantGroup,
} from "../message/AssistantWorkSummary";
import type { EnrichedFileSnapshot, MessageListProps } from "../../types";
import type { Message as MessageType } from "wave-agent-sdk";
import {
  UserMessageNav,
  navEntriesFromMessages,
  pickActiveUserMessageId,
} from "../message/UserMessageNav";
import "../../styles/MessageList.css";

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

// Count the blocks in an assistant message that Message.tsx wraps in a `.timeline-row`
// (i.e. that carry a timeline dot): non-empty text/compact, tool, and reasoning blocks.
// Mirrors the `wrap` logic in Message.renderBlock so the group can decide whether it has
// a single lone dot (no connecting line) or multiple dots (draw the line).
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
    onOpenAgentTranscript,
    onRevertFileHistory,
    revertingFileHistory,
    onOpenFileHistoryFile,
  },
  ref,
) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const prevMessagesLengthRef = useRef(messages.length);
  const prevQueuedLengthRef = useRef(queuedMessages?.length || 0);
  // True until the first effect run after mount. MessageList only renders once
  // messages exist (empty state shows LoadingLogo/WelcomeView), so the first run
  // IS the initial session load and must force-scroll to the bottom.
  const isFirstEffectRef = useRef(true);
  // Detect session / history replacement so we jump instantly, not smoothly.
  const prevListHeadRef = useRef<string | undefined>(messages[0]?.id);
  // True when the user has scrolled up away from the bottom. While set,
  // auto-scroll-to-bottom is suspended so the user can read history undisturbed
  // during streaming. Set by ANY upward scroll (even a few px) — detected by
  // comparing scrollTop direction in the scroll handler — so a light upward
  // nudge is respected instead of being overridden because the user is still
  // "within the bottom threshold". Cleared only when the user scrolls back down
  // to the bottom region.
  const userScrolledUpRef = useRef(false);
  // Briefly true around our own scrollIntoView calls so the scroll handler can
  // ignore those as user intent. Streaming uses 'auto' (instant, single fire),
  // so a one-frame reset via requestAnimationFrame is sufficient.
  const isProgrammaticScrollRef = useRef(false);
  // Last seen scrollTop, used to detect scroll direction (up vs down).
  const prevScrollTopRef = useRef(0);
  // Last seen scrollHeight, used to tell a content-shrink clamp apart from a
  // genuine user scroll-up. When content above the viewport shrinks (reasoning
  // auto-collapse, streaming-end reflow, image load, etc.) the browser clamps
  // scrollTop downward to keep it within bounds, which otherwise looks identical
  // to an upward user gesture and would wrongly suspend auto-follow.
  const prevScrollHeightRef = useRef(0);
  // Last seen clientHeight, used the same way for a viewport-GROWTH clamp: when
  // the container gets taller (confirmation dialog closes, input area shrinks,
  // window/panel grows) while parked at the bottom, the browser clamps scrollTop
  // downward with scrollHeight UNCHANGED — which passes the contentShrank check
  // and would likewise suspend auto-follow without a user gesture.
  const prevClientHeightRef = useRef(0);

  // The most-recent user message that has scrolled above the viewport top; pinned
  // at the top of the list as a context hint (设计稿 2236-3792).
  const [stickyMessage, setStickyMessage] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const [activeNavId, setActiveNavId] = useState<string | undefined>();
  const navEntries = useMemo(
    () => navEntriesFromMessages(messages),
    [messages],
  );

  const computeSticky = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      setStickyMessage(null);
      return;
    }
    const scrollTop = container.scrollTop;
    const nodes = container.querySelectorAll<HTMLElement>(
      '[data-role="user"][data-message-id]',
    );
    let candidate: HTMLElement | null = null;
    // Find the last user message whose top edge has scrolled above the viewport top.
    for (const node of nodes) {
      if (node.offsetTop < scrollTop) {
        candidate = node;
      } else {
        break;
      }
    }
    if (!candidate) {
      setStickyMessage(null);
      return;
    }
    const id = candidate.getAttribute("data-message-id") || "";
    const text =
      candidate.querySelector(".user-content")?.textContent?.trim() || "";
    if (!id || !text) {
      setStickyMessage(null);
      return;
    }
    setStickyMessage((prev) =>
      prev && prev.id === id && prev.text === text ? prev : { id, text },
    );
  }, []);

  const computeActiveNav = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const nodes = container.querySelectorAll<HTMLElement>(
      '[data-role="user"][data-message-id]',
    );
    const items: Array<{ id: string; top: number }> = [];
    nodes.forEach((node) => {
      const id = node.getAttribute("data-message-id") || "";
      if (id) items.push({ id, top: node.offsetTop });
    });
    const next = pickActiveUserMessageId(items, {
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
    });
    setActiveNavId((prev) => (prev === next ? prev : next));
  }, []);

  const scrollToMessage = useCallback((id: string) => {
    const container = containerRef.current;
    const node = container?.querySelector<HTMLElement>(
      `[data-message-id="${id}"]`,
    );
    node?.scrollIntoView({ behavior: "auto", block: "center" });
  }, []);

  // Perform a programmatic scroll-to-bottom, guarding it with the
  // isProgrammaticScroll flag so the scroll handler treats the resulting
  // 'scroll' event as ours (not the user's) and leaves userScrolledUp alone.
  const doScrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const messagesEnd = messagesEndRef.current;
    if (!messagesEnd) return;
    isProgrammaticScrollRef.current = true;
    messagesEnd.scrollIntoView({ behavior });
    // 'auto' is instant (single 'scroll' fire); reset on the next frame.
    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth", force = false) => {
      const container = containerRef.current;
      const messagesEnd = messagesEndRef.current;
      if (!container || !messagesEnd) return;

      const isNearBottom =
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 300;

      const isUserMessage =
        messages.length > 0 && messages[messages.length - 1].role === "user";
      // Force scroll if it's a new message AND (it's from user OR user is already at bottom)
      const shouldForce =
        force && (isUserMessage || !userScrolledUpRef.current);

      // Always scroll if:
      // 1. It's a brand new message that should be forced
      // 2. We are currently streaming content AND user hasn't scrolled up
      // 3. The user is already near the bottom AND hasn't scrolled up
      if (
        shouldForce ||
        ((isStreaming || isNearBottom) && !userScrolledUpRef.current)
      ) {
        // A new user message means the user wants to follow the upcoming reply:
        // clear any prior opt-out so streaming auto-scrolls into view.
        if (shouldForce && isUserMessage) {
          userScrolledUpRef.current = false;
        }
        doScrollToBottom(behavior);
      }
    },
    [messages, isStreaming, doScrollToBottom],
  );

  // Expose scrollToBottom method to parent component
  useImperativeHandle(ref, () => ({
    scrollToBottom: (behavior: ScrollBehavior = "smooth") => {
      doScrollToBottom(behavior);
    },
  }));

  // Auto-scroll to bottom when messages change, streaming updates, or subagent messages update
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initial load / session switch scrolls instantly ('auto') — a smooth
    // animation would compute its target once and land short while async
    // content (images, webfonts, mermaid) is still loading.
    const listHead = messages[0]?.id;
    const isSessionSwap =
      Boolean(listHead) && listHead !== prevListHeadRef.current;
    prevListHeadRef.current = listHead;
    const isInitialLoad = isFirstEffectRef.current && messages.length > 0;
    isFirstEffectRef.current = false;
    if (isSessionSwap) {
      userScrolledUpRef.current = false;
    }
    const isNewMessage =
      messages.length > prevMessagesLengthRef.current ||
      (queuedMessages?.length || 0) > prevQueuedLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    prevQueuedLengthRef.current = queuedMessages?.length || 0;

    // The scroll event fires for user scrolling (wheel, trackpad, keyboard,
    // scrollbar drag) AND our own programmatic scrollIntoView. We distinguish
    // them with isProgrammaticScroll: ignore 'scroll' events we caused, so they
    // can't reset userScrolledUp and yank the user back to the bottom. For real
    // user scrolling, we use DIRECTION to decide intent — any upward scroll
    // (even a few px) suspends following, so a light nudge up is respected
    // instead of being overridden by the bottom-threshold check. Only scrolling
    // back down to the bottom region resumes following.
    const handleScroll = () => {
      if (!isProgrammaticScrollRef.current) {
        const isNearBottom =
          container.scrollTop + container.clientHeight >=
          container.scrollHeight - 300;
        const scrolledUp = container.scrollTop < prevScrollTopRef.current;
        // A clamp from a content-shrink reflow (scrollHeight decreased) moves
        // scrollTop downward but is NOT user intent — ignore it so auto-follow
        // survives reasoning collapse / streaming-end reflow / image load.
        const contentShrank =
          container.scrollHeight < prevScrollHeightRef.current;
        // Same for a viewport-growth clamp (clientHeight increased, scrollHeight
        // unchanged): the container got taller under the user's parked position,
        // e.g. when the confirmation dialog closes and the input area comes back
        // shorter than the dialog.
        const viewportGrew =
          container.clientHeight > prevClientHeightRef.current;
        // An upward gesture always opts out of following (covers the "slight
        // nudge up then stop" case that the distance threshold alone missed).
        // A downward gesture to the bottom region opts back in.
        if (scrolledUp && !contentShrank && !viewportGrew) {
          userScrolledUpRef.current = true;
        } else if (isNearBottom) {
          userScrolledUpRef.current = false;
        }
      }
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = container.clientHeight;
      computeSticky();
      computeActiveNav();
    };

    container.addEventListener("scroll", handleScroll);

    // Use ResizeObserver to recompute sticky state on content height changes
    // (images, diffs, etc.). Auto-scroll itself is driven by the messages
    // dependency below, not by the observer.
    const resizeObserver = new ResizeObserver(() => {
      // Re-baseline the geometry refs on container resizes. A resize that
      // produces no scroll event (user not at the bottom → no clamp) would
      // otherwise leave prevClientHeight stale, and the NEXT genuine scroll-up
      // would be misread as a viewport-growth clamp and fail to suspend
      // following. If a clamp's scroll event hasn't been dispatched yet,
      // re-baselining here also neutralizes it (scrollTop no longer "decreased").
      prevScrollTopRef.current = container.scrollTop;
      prevScrollHeightRef.current = container.scrollHeight;
      prevClientHeightRef.current = container.clientHeight;
      computeSticky();
      computeActiveNav();
    });

    resizeObserver.observe(container);

    // Follow new content: scroll on every messages change (incl. streaming text
    // chunks so streamed text stays visible), gated by userScrolledUp inside
    // scrollToBottom. A brand-new message forces the scroll.
    scrollToBottom(
      isStreaming || isInitialLoad || isSessionSwap ? "auto" : "smooth",
      isNewMessage || isInitialLoad || isSessionSwap,
    );
    computeSticky();
    computeActiveNav();

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("scroll", handleScroll);
    };
  }, [
    messages,
    queuedMessages,
    isStreaming,
    scrollToBottom,
    computeSticky,
    computeActiveNav,
  ]);

  // Re-pin to the true bottom after async content finishes loading (image
  // decode, webfont reflow, mermaid render). 'load' doesn't bubble, so listen in
  // capture phase; re-pin with 'auto' — a smooth re-pin would miss again.
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

  // Re-pin once the sticky user message renders. The sticky bar is a normal
  // in-flow child (position: sticky keeps its space), inserted as the first
  // element AFTER the initial load's scroll ran — so it grows scrollHeight by
  // its own height and pushes the true bottom ~30-70px below the parked
  // viewport. That happens after the main effect (stickyMessage isn't one of
  // its deps) and often before fonts.ready/load fire, leaving the viewport
  // short of the real bottom. Re-pin here, gated on being near the bottom
  // (the push is far smaller than the 300px threshold) and on the user not
  // having scrolled up, so a sticky change while reading history is ignored.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !stickyMessage) return;
    const isNearBottom =
      container.scrollTop + container.clientHeight >=
      container.scrollHeight - 300;
    if (isNearBottom && !userScrolledUpRef.current) {
      doScrollToBottom("auto");
    }
  }, [stickyMessage, doScrollToBottom]);

  return (
    <div className="messages-shell">
      <div
        ref={containerRef}
        id="messagesContainer"
        className={`messages-container${isStreaming ? " streaming" : ""}${isCompacting ? " compacting" : ""}`}
        data-testid="messages-container"
      >
        <div className="messages-column">
      {stickyMessage && (
        <div className="sticky-user-wrapper">
          <div
            className="sticky-user-message"
            data-testid="sticky-user-message"
            onClick={() => scrollToMessage(stickyMessage.id)}
          >
            <div className="sticky-user-content">{stickyMessage.text}</div>
          </div>
        </div>
      )}
      {/* Chat messages - filter out user meta messages */}
      {useMemo(() => {
        // Filter out user messages with isMeta (hidden from the list)
        const visibleMessages: MessageType[] = [];
        for (const msg of messages) {
          if (msg.role === "user" && msg.isMeta) continue;
          visibleMessages.push(msg);
        }

        const renderMessage = (
          message: MessageType,
          extras?: {
            blockRenderMode?: "all" | "omitFinalText" | "finalTextOnly";
            finalTextBlockIndex?: number;
            keySuffix?: string;
          },
        ) => {
          return (
            <Message
              key={`${message.id}${extras?.keySuffix ?? ""}`}
              message={message}
              vscode={vscode}
              onRewindToMessage={onRewindToMessage}
              workdir={workdir}
              onOpenPreview={onOpenPreview}
              onOpenFile={onOpenFile}
              onOpenAgentTranscript={onOpenAgentTranscript}
              blockRenderMode={extras?.blockRenderMode}
              finalTextBlockIndex={extras?.finalTextBlockIndex}
            />
          );
        };

        // Group consecutive assistant messages into a single .assistant-group wrapper so
        // the timeline vertical line runs continuously through all their dots. User
        // messages break the timeline (rendered as bare bubbles outside any group).
        const rendered: React.ReactNode[] = [];
        let group: { message: MessageType }[] = [];
        const lastVisibleId = visibleMessages[visibleMessages.length - 1]?.id;

        const flushGroup = () => {
          if (group.length === 0) return;
          const groupMessages = group.map((g) => g.message);
          const isLiveGroup =
            Boolean(isStreaming) &&
            groupMessages.some((m) => m.id === lastVisibleId);
          const finalText = findFinalTextBlock(groupMessages);
          const collapse =
            !isLiveGroup &&
            finalText &&
            shouldCollapseAssistantGroup(groupMessages);

          const dotCount = groupMessages.reduce(
            (sum, m) => sum + countTimelineBlocks(m),
            0,
          );
          const single = dotCount <= 1;

          if (collapse && finalText) {
            rendered.push(
              <div
                key={groupMessages[0].id}
                className={`assistant-group${single ? " assistant-group--single" : ""}`}
                data-testid="assistant-group-collapsed"
              >
                <AssistantWorkSummary messages={groupMessages}>
                  {groupMessages.map((m) =>
                    renderMessage(m, {
                      blockRenderMode:
                        m.id === finalText.messageId
                          ? "omitFinalText"
                          : "all",
                      finalTextBlockIndex:
                        m.id === finalText.messageId
                          ? finalText.blockIndex
                          : undefined,
                      keySuffix: "-work",
                    }),
                  )}
                </AssistantWorkSummary>
                {renderMessage(
                  groupMessages.find((m) => m.id === finalText.messageId)!,
                  {
                    blockRenderMode: "finalTextOnly",
                    finalTextBlockIndex: finalText.blockIndex,
                    keySuffix: "-final",
                  },
                )}
              </div>,
            );
          } else {
            rendered.push(
              <div
                key={groupMessages[0].id}
                className={`assistant-group${single ? " assistant-group--single" : ""}`}
              >
                {groupMessages.map((m) => renderMessage(m))}
              </div>,
            );
          }
          group = [];
        };

        visibleMessages.forEach((message) => {
          if (message.role === "assistant") {
            group.push({ message });
          } else {
            flushGroup();
            rendered.push(renderMessage(message));
          }
        });
        flushGroup();

        // "N 个文件已更改" card: render the NEWEST turn's file_history blocks
        // below the list once streaming has settled. A turn starts at a real
        // user message (role=user, not isMeta) and runs to the next one; a
        // plain question with no changes shows nothing (no fallback to earlier
        // turns).
        if (!isStreaming) {
          const mergedSnapshots: EnrichedFileSnapshot[] = [];
          const turnMessageIds: string[] = [];
          let inTurn = false;
          let foundFh = false;
          for (let i = visibleMessages.length - 1; i >= 0; i--) {
            const m = visibleMessages[i];
            if (m.role === "user" && !m.isMeta) {
              // The newest turn ends here; do not look further back.
              break;
            }
            if (m.role !== "assistant") continue;
            inTurn = true;
            turnMessageIds.push(m.id);
            const historyBlock = (m.blocks ?? []).find(
              (b) => b.type === "file_history",
            ) as
              | { type: "file_history"; snapshots: unknown[] }
              | undefined;
            if (
              historyBlock &&
              Array.isArray(historyBlock.snapshots) &&
              historyBlock.snapshots.length > 0
            ) {
              mergedSnapshots.push(
                ...(historyBlock.snapshots as unknown as EnrichedFileSnapshot[]).filter(
                  (s) => !workdir || (s.filePath ?? "").startsWith(workdir),
                ),
              );
              foundFh = true;
            }
          }
          if (inTurn && foundFh && turnMessageIds.length > 0) {
            const snapshots = mergedSnapshots;
            rendered.push(
              <FileHistoryCard
                key={`file-history-${turnMessageIds.join(",")}`}
                messageIds={turnMessageIds}
                snapshots={snapshots}
                workdir={workdir}
                onOpenFile={onOpenFileHistoryFile}
                onRevert={onRevertFileHistory}
                reverting={revertingFileHistory}
              />,
            );
          }
        }

        return rendered;
      }, [
        messages,
        isStreaming,
        vscode,
        onRewindToMessage,
        workdir,
        onOpenPreview,
        onOpenFile,
        onOpenAgentTranscript,
        onRevertFileHistory,
        revertingFileHistory,
        onOpenFileHistoryFile,
      ])}

      {isStreaming && !isCompacting && (
        <div
          className="thinking-hint text-shimmer"
          data-testid="thinking-hint"
        >
          思考中...
        </div>
      )}

      {/* Compaction hint: blinking cursor + label pinned to the end of the
          message list, independent of isStreaming (auto-compaction runs between
          turns, after the streaming cursor is gone). */}
      {isCompacting && (
        <div className="compaction-hint" data-testid="compaction-hint">
          <span className="compaction-hint-cursor">▋</span>正在压缩对话…
        </div>
      )}

        {/* Invisible div to scroll to */}
        <div ref={messagesEndRef} />
        </div>
      </div>
      <UserMessageNav
        entries={navEntries}
        activeId={activeNavId}
        onSelect={scrollToMessage}
      />
    </div>
  );
});
