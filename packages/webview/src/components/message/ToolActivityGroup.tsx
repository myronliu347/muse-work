import React, { useEffect, useRef, useState } from "react";
import { QueueChevronIcon } from "../shared/HeaderIcons";
import { ToolError } from "./ToolError";
import { reasoningLineLabel } from "./toolActivity";
import type { ReasoningBlock } from "../../types";

export function ToolActivityGroup({
  label,
  additions,
  deletions,
  defaultOpen,
  live = false,
  children,
}: {
  label: string;
  additions: number;
  deletions: number;
  defaultOpen: boolean;
  live?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="activity-group" data-testid="activity-group">
      <button
        type="button"
        className={`activity-hit${open ? " open" : ""}`}
        data-testid="activity-summary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`txt${live ? " text-shimmer" : ""}`}>{label}</span>
        {additions > 0 && <span className="activity-add">+{additions}</span>}
        {deletions > 0 && <span className="activity-del">−{deletions}</span>}
        <QueueChevronIcon className="activity-chev" />
      </button>
      {open ? <div className="activity-kids">{children}</div> : null}
    </div>
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
}: {
  label: string;
  additions?: number;
  deletions?: number;
  shimmer?: boolean;
  detail?: React.ReactNode;
  error?: string;
  testId?: string;
  onActivate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = detail != null && detail !== false;
  const button = (
    <button
      type="button"
      className={`tool-line${hasDetail ? " can" : ""}${open ? " open" : ""}`}
      data-testid={testId}
      onClick={() => {
        if (hasDetail) {
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
        {label}
      </span>
      {additions > 0 && <span className="activity-add">+{additions}</span>}
      {deletions > 0 && <span className="activity-del">−{deletions}</span>}
      {hasDetail ? <QueueChevronIcon className="activity-chev" /> : null}
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
          if (hasBody) setOpen((value) => !value);
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
