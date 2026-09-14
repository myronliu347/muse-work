import React, {
  useState,
  useId,
  ReactElement,
  ReactNode,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import "../../styles/Tooltip.css";
import { bodyPortal } from "../../utils/bodyPortal";

const INTERACTIVE_HIDE_MS = 160;

interface TooltipProps {
  text: string;
  /** Optional rich content; when provided it replaces `text` inside the box. */
  content?: ReactNode;
  children: ReactElement;
  position?:
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "bottom-left"
    | "bottom-right"
    | "top-left"
    | "top-right";
  offset?: number;
  disabled?: boolean;
  className?: string;
  /**
   * When true (default) the trigger is wrapped in a `.tooltip-container`
   * span. Set false to bind events/ref directly onto `children` and render
   * the box as a sibling — required when the child must stay a direct flex
   * child of its parent (e.g. sidebar session rows).
   */
  wrap?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
  text,
  content,
  children,
  position = "top",
  offset = 8,
  disabled = false,
  className = "",
  wrap = true,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({
    left: -9999,
    top: 0,
  });
  const id = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Card tooltips are hoverable (scroll/select). Plain text tips stay
  // pointer-events: none and hide immediately on leave.
  const interactive = Boolean(content);

  const calculatePosition = useCallback(() => {
    if (!containerRef.current || !tooltipRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    let left = 0;
    let top = 0;

    switch (position) {
      case "top":
        left =
          containerRect.left + containerRect.width / 2 - tooltipRect.width / 2;
        top = containerRect.top - tooltipRect.height - offset;
        break;
      case "bottom":
        left =
          containerRect.left + containerRect.width / 2 - tooltipRect.width / 2;
        top = containerRect.bottom + offset;
        break;
      case "left":
        left = containerRect.left - tooltipRect.width - offset;
        top =
          containerRect.top + containerRect.height / 2 - tooltipRect.height / 2;
        break;
      case "right":
        left = containerRect.right + offset;
        top =
          containerRect.top + containerRect.height / 2 - tooltipRect.height / 2;
        break;
      case "top-left":
        left = containerRect.right - tooltipRect.width;
        top = containerRect.top - tooltipRect.height - offset;
        break;
      case "top-right":
        left = containerRect.left;
        top = containerRect.top - tooltipRect.height - offset;
        break;
      case "bottom-left":
        left = containerRect.right - tooltipRect.width;
        top = containerRect.bottom + offset;
        break;
      case "bottom-right":
        left = containerRect.left;
        top = containerRect.bottom + offset;
        break;
    }

    // Keep the tooltip inside the viewport (webview bounds); if it would
    // overflow an edge, shift it inward so it never gets clipped.
    const margin = 4;
    const maxLeft = Math.max(
      window.innerWidth - tooltipRect.width - margin,
      margin,
    );
    const maxTop = Math.max(
      window.innerHeight - tooltipRect.height - margin,
      margin,
    );
    left = Math.min(Math.max(left, margin), maxLeft);
    top = Math.min(Math.max(top, margin), maxTop);

    setTooltipStyle({ left, top });
  }, [position, offset]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const handleShow = useCallback(() => {
    clearHideTimer();
    setIsVisible(true);
  }, [clearHideTimer]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  useLayoutEffect(() => {
    if (!isVisible) return;
    calculatePosition();
    const frame = requestAnimationFrame(calculatePosition);
    return () => cancelAnimationFrame(frame);
  }, [isVisible, calculatePosition, content]);

  const handleHide = useCallback(() => {
    if (!interactive) {
      setIsVisible(false);
      return;
    }
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setIsVisible(false);
    }, INTERACTIVE_HIDE_MS);
  }, [clearHideTimer, interactive]);

  // When disabled, render children without tooltip wrapper
  if (disabled) {
    return children;
  }

  const box = (
    <div
      id={id}
      role="tooltip"
      ref={tooltipRef}
      className={`tooltip-box tooltip-${position}${content ? " tooltip-box--card" : ""}${interactive ? " tooltip-box--interactive" : ""}${isVisible ? " visible" : ""}`}
      style={tooltipStyle}
      onMouseEnter={interactive ? handleShow : undefined}
      onMouseLeave={interactive ? handleHide : undefined}
    >
      {content ?? text}
    </div>
  );

  if (!wrap) {
    // Bind hover handlers + ref directly onto the child so it stays a direct
    // flex child of its parent (e.g. sidebar session rows). The box is
    // portaled onto `#muse-overlay-root` so overflow/backdrop-filter
    // ancestors cannot clip it while theme tokens still apply.
    return (
      <>
        {React.cloneElement(children, {
          onMouseEnter: handleShow,
          onMouseLeave: handleHide,
          onFocus: handleShow,
          onBlur: handleHide,
          ref: containerRef as React.Ref<HTMLElement>,
          "aria-describedby": id,
        })}
        {bodyPortal(box)}
      </>
    );
  }

  return (
    <span
      className={`tooltip-container ${className}`}
      onMouseEnter={handleShow}
      onMouseLeave={handleHide}
      onFocus={handleShow}
      onBlur={handleHide}
      ref={containerRef}
    >
      {React.cloneElement(children, {
        "aria-describedby": id,
      })}
      {bodyPortal(box)}
    </span>
  );
};
