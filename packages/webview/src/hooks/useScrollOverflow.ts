import { useEffect, useState, type RefObject } from "react";

export interface ScrollEdges {
  start: boolean;
  end: boolean;
}

/** Which ends of a horizontal scroller still have content outside the viewport. */
export function scrollOverflowEdges(metrics: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): ScrollEdges {
  const max = metrics.scrollWidth - metrics.clientWidth;
  return {
    start: metrics.scrollLeft > 1,
    end: max - metrics.scrollLeft > 1,
  };
}

export function useScrollOverflow(ref: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const next = scrollOverflowEdges(el);
      setEdges((prev) =>
        prev.start === next.start && prev.end === next.end ? prev : next,
      );
    };

    update();
    el.addEventListener("scroll", update, { passive: true });

    const sizes = new ResizeObserver(update);
    const observe = () => {
      sizes.disconnect();
      sizes.observe(el);
      for (const child of el.children) sizes.observe(child);
    };
    observe();

    const mutations = new MutationObserver(() => {
      observe();
      update();
    });
    mutations.observe(el, { childList: true });

    return () => {
      el.removeEventListener("scroll", update);
      sizes.disconnect();
      mutations.disconnect();
    };
  }, [ref]);

  return edges;
}
