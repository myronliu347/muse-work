import React, { useLayoutEffect, useRef, useState } from "react";
import "../../styles/OverflowText.css";

/**
 * One-line text that fades its clipped edge and, on hover, slides left until
 * the end is readable. Short text is left untouched.
 */
export function OverflowText({
  text,
  className,
  title,
}: {
  text: string;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shift, setShift] = useState(0);
  const [hover, setHover] = useState(false);

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
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <span
        className="overflow-text-inner"
        style={
          scrolling
            ? {
                transform: `translateX(-${shift}px)`,
                transitionDuration: `${Math.min(2600, Math.max(360, shift * 12))}ms`,
              }
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}
