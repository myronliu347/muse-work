import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { useScrollOverflow } from "../../hooks/useScrollOverflow";

/** Direction the pointer is pushing against: -1 start, 1 end, 0 inside. */
export function overflowEdgeDirection({
  clientX,
  rect,
  scrollLeft,
  scrollWidth,
  clientWidth,
  edgeZone,
}: {
  clientX: number;
  rect: { left: number; right: number };
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  edgeZone: number;
}): -1 | 0 | 1 {
  const max = Math.max(0, scrollWidth - clientWidth);
  if (max <= 1) return 0;
  const fromStart = clientX - rect.left;
  const fromEnd = rect.right - clientX;
  if (fromStart <= edgeZone && scrollLeft > 1) return -1;
  if (fromEnd <= edgeZone && max - scrollLeft > 1) return 1;
  return 0;
}

const EDGE_ZONE = 28;
const MIN_SPEED = 1.5;
const MAX_SPEED = 6;

export type OverflowScrollerProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Hovering the faded edge keeps scrolling until the pointer leaves. */
  edgeScroll?: boolean;
  edgeZone?: number;
};

/**
 * Horizontal strip that fades its overflowing edges and reveals hidden items
 * on hover: hovering a clipped item scrolls it into view, hovering the faded
 * edge keeps scrolling in that direction.
 */
export const OverflowScroller = forwardRef<HTMLDivElement, OverflowScrollerProps>(
  function OverflowScroller(
    {
      className,
      children,
      edgeScroll = true,
      edgeZone = EDGE_ZONE,
      onPointerMove,
      onPointerLeave,
      onPointerOver,
      onPointerDown,
      ...rest
    },
    forwardedRef,
  ) {
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const edges = useScrollOverflow(scrollerRef);
    useImperativeHandle(forwardedRef, () => scrollerRef.current as HTMLDivElement);

    const direction = useRef<-1 | 0 | 1>(0);
    const speed = useRef(MIN_SPEED);
    const frame = useRef<number | null>(null);

    const stop = useCallback(() => {
      direction.current = 0;
      if (frame.current !== null) {
        window.cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    }, []);

    const step = useCallback(() => {
      frame.current = null;
      const el = scrollerRef.current;
      const dir = direction.current;
      if (!el || dir === 0) return;
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      const next = Math.max(0, Math.min(max, el.scrollLeft + dir * speed.current));
      if (next === el.scrollLeft) {
        stop();
        return;
      }
      // The strip uses scroll-behavior: smooth; an rAF loop must not animate
      // every frame on top of that or it crawls.
      const previous = el.style.scrollBehavior;
      el.style.scrollBehavior = "auto";
      el.scrollLeft = next;
      el.style.scrollBehavior = previous;
      frame.current = window.requestAnimationFrame(step);
    }, [stop]);

    useEffect(() => stop, [stop]);

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      onPointerMove?.(event);
      if (!edgeScroll) return;
      const el = scrollerRef.current;
      if (!el) return;
      const dir = overflowEdgeDirection({
        clientX: event.clientX,
        rect: el.getBoundingClientRect(),
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        edgeZone,
      });
      if (dir === 0) {
        stop();
        return;
      }
      direction.current = dir;
      const distance =
        dir < 0
          ? event.clientX - el.getBoundingClientRect().left
          : el.getBoundingClientRect().right - event.clientX;
      const closeness = Math.max(0, 1 - Math.max(0, distance) / edgeZone);
      speed.current = MIN_SPEED + closeness * (MAX_SPEED - MIN_SPEED);
      if (frame.current === null) {
        frame.current = window.requestAnimationFrame(step);
      }
    };

    const handlePointerOver = (event: React.PointerEvent<HTMLDivElement>) => {
      onPointerOver?.(event);
      const el = scrollerRef.current;
      const target = event.target;
      if (!el || !(target instanceof Element)) return;
      const item = Array.from(el.children).find((child) =>
        child.contains(target),
      ) as HTMLElement | undefined;
      if (!item) return;
      const root = el.getBoundingClientRect();
      const box = item.getBoundingClientRect();
      if (box.left < root.left - 1) {
        el.scrollBy({ left: box.left - root.left, behavior: "smooth" });
      } else if (box.right > root.right + 1) {
        el.scrollBy({ left: box.right - root.right, behavior: "smooth" });
      }
    };

    const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
      onPointerLeave?.(event);
      stop();
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      onPointerDown?.(event);
      stop();
    };

    return (
      <div
        {...rest}
        ref={scrollerRef}
        className={`overflow-scroller${className ? ` ${className}` : ""}${
          edges.start ? " is-overflow-start" : ""
        }${edges.end ? " is-overflow-end" : ""}`}
        onPointerMove={handlePointerMove}
        onPointerOver={handlePointerOver}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      >
        {children}
      </div>
    );
  },
);
