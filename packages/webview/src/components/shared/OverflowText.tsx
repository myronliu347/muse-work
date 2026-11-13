import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import "../../styles/OverflowText.css";

/**
 * One-line text that fades its clipped edge and, on hover, slides left until
 * the end is readable. Short text is left untouched.
 */
export function OverflowText({
  text,
  className,
  title,
  hoverDelay = 400,
}: {
  text: string;
  className?: string;
  title?: string;
  /** Wait before sliding so merely passing over a tab does not move it. */
  hoverDelay?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shift, setShift] = useState(0);
  const [hover, setHover] = useState(false);
  const timer = useRef<number | null>(null);
  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clearTimer, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setShift(Math.max(0, el.scrollWidth - el.clientWidth));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  const scrolling = hover && shift > 0;
  return (
    <span
      ref={ref}
      className={`overflow-text${className ? ` ${className}` : ""}${
        scrolling ? " is-scrolling" : ""
      }`}
      title={title ?? text}
      onPointerEnter={() => {
        clearTimer();
        if (shift <= 0) return;
        if (hoverDelay <= 0) {
          setHover(true);
          return;
        }
        timer.current = window.setTimeout(() => {
          timer.current = null;
          setHover(true);
        }, hoverDelay);
      }}
      onPointerLeave={() => {
        clearTimer();
        setHover(false);
      }}
    >
      <span
        className="overflow-text-inner"
        style={
          scrolling
            ? {
                transform: `translateX(-${shift}px)`,
                transitionDuration: `${Math.min(5200, Math.max(760, shift * 26))}ms`,
              }
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}
