import React, { useLayoutEffect, useRef, useState } from "react";
import { middleEllipsis } from "../../utils/filePathDisplay";

type MiddleEllipsisTextProps = {
  text: string;
  className?: string;
  /** Defaults to full `text`. */
  title?: string;
};

/**
 * Fits `text` inside the available width with middle ellipsis (filename kept when possible).
 */
export function MiddleEllipsisText({
  text,
  className,
  title,
}: MiddleEllipsisTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(() => middleEllipsis(text, 48));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      if (!text) {
        setDisplay("");
        return;
      }

      const width = el.clientWidth;
      if (width <= 0) {
        setDisplay(middleEllipsis(text, 48));
        return;
      }

      el.textContent = text;
      if (el.scrollWidth <= width) {
        setDisplay(text);
        return;
      }

      let lo = 8;
      let hi = text.length;
      let best = middleEllipsis(text, lo);
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const candidate = middleEllipsis(text, mid);
        el.textContent = candidate;
        if (el.scrollWidth <= width) {
          best = candidate;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      setDisplay(best);
    };

    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span
      ref={ref}
      className={className}
      title={title ?? text}
    >
      {display}
    </span>
  );
}

export default MiddleEllipsisText;
