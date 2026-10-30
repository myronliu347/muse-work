import React, { useState } from "react";
import { QueueChevronIcon } from "../shared/HeaderIcons";
import { useHoldTranscriptScroll } from "../chat/holdTranscriptScroll";
import type { Message as MessageType } from "@muse-work/agent";

export function formatWorkedDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    const parts = [`${h}h`];
    if (m > 0) parts.push(`${m}m`);
    if (s > 0) parts.push(`${s}s`);
    return parts.join(" ");
  }
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Estimate turn duration from reasoning timestamps and message time. */
export function estimateAssistantWorkMs(messages: MessageType[]): number | null {
  // Reasoning start/end are often relative or session-local clocks — never mix
  // them with absolute message.timestamp values via min/max.
  let reasoningStart: number | undefined;
  let reasoningEnd: number | undefined;
  let msgStart: number | undefined;
  let msgEnd: number | undefined;
  for (const message of messages) {
    const ts = Date.parse(message.timestamp);
    if (!Number.isNaN(ts)) {
      msgStart = msgStart === undefined ? ts : Math.min(msgStart, ts);
      msgEnd = msgEnd === undefined ? ts : Math.max(msgEnd, ts);
    }
    for (const block of message.blocks ?? []) {
      if (block.type !== "reasoning") continue;
      if (typeof block.startTime === "number") {
        reasoningStart =
          reasoningStart === undefined
            ? block.startTime
            : Math.min(reasoningStart, block.startTime);
      }
      if (typeof block.endTime === "number") {
        reasoningEnd =
          reasoningEnd === undefined
            ? block.endTime
            : Math.max(reasoningEnd, block.endTime);
      }
    }
  }
  if (
    reasoningStart !== undefined &&
    reasoningEnd !== undefined &&
    reasoningEnd > reasoningStart
  ) {
    return reasoningEnd - reasoningStart;
  }
  if (msgStart === undefined || msgEnd === undefined || msgEnd <= msgStart) {
    return null;
  }
  return msgEnd - msgStart;
}

/** True when the group has work to hide above a final text block. */
export function shouldCollapseAssistantGroup(messages: MessageType[]): boolean {
  let lastTextIndex = -1;
  let blockCount = 0;
  for (const message of messages) {
    for (const block of message.blocks ?? []) {
      if (block.type === "text" && block.content?.trim()) {
        lastTextIndex = blockCount;
      }
      if (
        block.type === "text" ||
        block.type === "tool" ||
        block.type === "reasoning" ||
        block.type === "compact" ||
        block.type === "bang" ||
        block.type === "task_notification"
      ) {
        if (block.type === "text" && !block.content?.trim()) continue;
        blockCount++;
      }
    }
  }
  return lastTextIndex > 0;
}

export interface AssistantWorkSummaryProps {
  messages: MessageType[];
  children: React.ReactNode;
}

/**
 * Collapsed header for a finished assistant turn: hides tools/reasoning/earlier
 * text behind "工作了 Xm Ys", keeping the last text block (passed as sibling
 * via children layout from MessageList) always visible outside.
 */
export const AssistantWorkSummary: React.FC<AssistantWorkSummaryProps> = ({
  messages,
  children,
}) => {
  const [collapsed, setCollapsed] = useState(true);
  const holdScroll = useHoldTranscriptScroll();
  // Freeze duration on first paint so the label does not keep ticking.
  const [ms] = useState(() => {
    const estimated = estimateAssistantWorkMs(messages);
    if (estimated != null && estimated > 0) return estimated;
    const start = Date.parse(messages[0]?.timestamp ?? "");
    if (!Number.isNaN(start)) {
      const elapsed = Date.now() - start;
      // Only use wall-clock for recent turns (live completion).
      if (elapsed > 0 && elapsed < 30 * 60 * 1000) return elapsed;
    }
    return null;
  });
  const title =
    ms != null && ms > 0 ? `工作了 ${formatWorkedDuration(ms)}` : "工作详情";

  return (
    <div className="assistant-work-summary" data-testid="assistant-work-summary">
      <div
        className="assistant-work-summary-header"
        onClick={() => {
          holdScroll();
          setCollapsed((c) => !c);
        }}
        role="button"
        aria-expanded={!collapsed}
      >
        <span className="assistant-work-summary-title">{title}</span>
        <QueueChevronIcon
          className={`reasoning-chevron${collapsed ? "" : " expanded"}`}
        />
      </div>
      {!collapsed && (
        <div className="assistant-work-summary-body">{children}</div>
      )}
    </div>
  );
};

export default AssistantWorkSummary;
