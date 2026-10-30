import React, { useState, useRef, useEffect } from "react";
import { QueueChevronIcon } from "../shared/HeaderIcons";
import { useHoldTranscriptScroll } from "../chat/holdTranscriptScroll";
import { reasoningLineLabel } from "./toolActivity";
import type { ReasoningBlock } from "../../types";

interface ReasoningBlockViewProps {
  block: ReasoningBlock;
  renderContent: (content: string) => React.ReactNode;
}

export const ReasoningBlockView: React.FC<ReasoningBlockViewProps> = ({
  block,
  renderContent,
}) => {
  // Reasoning that is already finished on mount (e.g. loaded from history) starts
  // collapsed; an in-progress block starts expanded and auto-collapses on finish.
  const [collapsed, setCollapsed] = useState(block.stage === "end");
  const holdScroll = useHoldTranscriptScroll();
  const prevStageRef = useRef(block.stage);
  const contentRef = useRef<HTMLDivElement>(null);

  // While reasoning streams, the content area grows inside its own scrollable
  // container (max-height + overflow-y). The outer MessageList auto-scroll
  // can't see inside it, so pin this container to its bottom as content grows
  // so the latest thinking stays visible. Once finished, the block collapses.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || block.stage === "end") return;
    el.scrollTop = el.scrollHeight;
  }, [block.content, block.stage]);

  // Auto-collapse once when reasoning finishes (stage transitions from non-'end' to 'end').
  useEffect(() => {
    if (prevStageRef.current !== "end" && block.stage === "end") {
      setCollapsed(true);
    }
    prevStageRef.current = block.stage;
  }, [block.stage]);

  const inProgress =
    block.stage !== "end" && typeof block.startTime === "number";
  const [now, setNow] = useState(() => Date.now());

  // While reasoning is in progress, tick every second to grow the elapsed counter.
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [inProgress]);

  const title = reasoningLineLabel(block, now);

  return (
    <div className="reasoning-block">
      <div
        className="reasoning-header"
        onClick={() => {
          holdScroll();
          setCollapsed((c) => !c);
        }}
      >
        <span className="reasoning-dot" />
        <span className="reasoning-title">{title}</span>
        <QueueChevronIcon
          className={`reasoning-chevron${collapsed ? "" : " expanded"}`}
        />
      </div>
      {!collapsed && (
        <div className="reasoning-content" ref={contentRef}>
          {renderContent(block.content || "")}
        </div>
      )}
    </div>
  );
};
