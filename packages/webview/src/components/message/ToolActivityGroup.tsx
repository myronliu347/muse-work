import React, { useEffect, useRef, useState } from "react";
import { QueueChevronIcon } from "../shared/HeaderIcons";
import { useHoldTranscriptScroll } from "../chat/holdTranscriptScroll";
import { ToolError } from "./ToolError";
import { reasoningLineLabel } from "./toolActivity";
import type { ReasoningBlock } from "../../types";

export function ToolActivityGroup({
  label,
  additions,
  deletions,
  defaultOpen,
  children,
}: {
  label: string;
  additions: number;
  deletions: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const wasDefaultOpen = useRef(defaultOpen);
  const holdScroll = useHoldTranscriptScroll();

  // A live run starts open. Once a later text block arrives, fold it.
  useEffect(() => {
    if (wasDefaultOpen.current && !defaultOpen) setOpen(false);
    wasDefaultOpen.current = defaultOpen;
  }, [defaultOpen]);

  return (
    <div className="activity-group" data-testid="activity-group">
      <button
        type="button"
        className={`activity-hit${open ? " open" : ""}`}
        data-testid="activity-summary"
        aria-expanded={open}
        onClick={() => {
          holdScroll();
          setOpen((value) => !value);
        }}
      >
        <span className="txt">{label}</span>
        {additions > 0 && <span className="activity-add">+{additions}</span>}
        {deletions > 0 && <span className="activity-del">−{deletions}</span>}
        <QueueChevronIcon className="activity-chev" />
      </button>
      {open ? <div className="activity-kids">{children}</div> : null}
    </div>
  );
}

function labelWithFile(
  label: string,
  fileName: string | undefined,
  onOpenFile: (() => void) | undefined,
) {
  if (!fileName || !onOpenFile) return label;
  const at = label.indexOf(fileName);
  if (at < 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <span
        className="tool-file-link"
        data-testid="tool-file-link"
        onClick={(event) => {
          event.stopPropagation();
          onOpenFile();
        }}
      >
        {fileName}
      </span>
      {label.slice(at + fileName.length)}
    </>
  );
}

export function ToolLine({
  label,
  additions = 0,
  deletions = 0,
  shimmer,
  detail,
  error,
  testId = "tool-line",
  onActivate,
  fileName,
  onOpenFile,
}: {
  label: string;
  additions?: number;
  deletions?: number;
  shimmer?: boolean;
  detail?: React.ReactNode;
  error?: string;
  testId?: string;
  onActivate?: () => void;
  fileName?: string;
  onOpenFile?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const holdScroll = useHoldTranscriptScroll();
  const hasDetail = detail != null && detail !== false;
  const button = (
    <button
      type="button"
      className={`tool-line${hasDetail || onActivate ? " can" : ""}${open ? " open" : ""}`}
      data-testid={testId}
      onClick={() => {
        if (hasDetail) {
          holdScroll();
          setOpen((value) => !value);
          return;
        }
        onActivate?.();
      }}
    >
      <span
        className={`txt${shimmer ? " text-shimmer" : ""}`}
        data-testid="tool-name"
      >
        {labelWithFile(label, fileName, onOpenFile)}
      </span>
      {additions > 0 && <span className="activity-add">+{additions}</span>}
      {deletions > 0 && <span className="activity-del">−{deletions}</span>}
      {hasDetail ? (
        <span
          className="activity-chev-hit"
          data-testid="tool-detail-toggle"
          onClick={(event) => {
            event.stopPropagation();
            holdScroll();
            setOpen((value) => !value);
          }}
        >
          <QueueChevronIcon className="activity-chev" />
        </span>
      ) : null}
    </button>
  );

  return (
    <div className="tool-line-wrap">
      {error ? <ToolError message={error}>{button}</ToolError> : button}
      {open ? detail : null}
    </div>
  );
}

export function ThoughtLine({
  block,
  children,
}: {
  block: ReasoningBlock;
  children?: React.ReactNode;
}) {
  const inProgress =
    block.stage !== "end" && typeof block.startTime === "number";
  const hasBody = Boolean((block.content || "").trim());
  const [open, setOpen] = useState(block.stage !== "end");
  const holdScroll = useHoldTranscriptScroll();
  const [now, setNow] = useState(() => Date.now());
  const prevStageRef = useRef(block.stage);

  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [inProgress]);

  useEffect(() => {
    if (prevStageRef.current !== "end" && block.stage === "end") {
      setOpen(false);
    }
    prevStageRef.current = block.stage;
  }, [block.stage]);

  return (
    <div className="tool-line-wrap">
      <button
        type="button"
        className={`tool-line thought${hasBody ? " can" : ""}${open ? " open" : ""}`}
        data-testid="thought-line"
        aria-expanded={hasBody ? open : undefined}
        onClick={() => {
          if (!hasBody) return;
          holdScroll();
          setOpen((value) => !value);
        }}
      >
        <span className={`txt${inProgress ? " text-shimmer" : ""}`}>
          {reasoningLineLabel(block, now)}
        </span>
        {hasBody ? <QueueChevronIcon className="activity-chev" /> : null}
      </button>
      {open && hasBody ? (
        <div className="tool-detail thought-detail" data-testid="thought-detail">
          {children}
        </div>
      ) : null}
    </div>
  );
}
