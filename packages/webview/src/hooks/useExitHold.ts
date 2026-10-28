import { useEffect, useState } from "react";

/** Side column / dock motion. CSS durations below must match. */
export const PANEL_MOTION_MS = 280;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Keep an open surface mounted through its close animation.
 * `show` is true on the same render that `open` becomes true.
 */
export function useExitHold(
  open: boolean,
  ms = PANEL_MOTION_MS,
): { show: boolean; closing: boolean } {
  const [prevOpen, setPrevOpen] = useState(open);
  const [closing, setClosing] = useState(false);

  if (open !== prevOpen) {
    setPrevOpen(open);
    setClosing(!open && !prefersReducedMotion());
  }

  useEffect(() => {
    if (!closing) return;
    const delay = prefersReducedMotion() ? 0 : ms;
    const id = window.setTimeout(() => setClosing(false), delay);
    return () => window.clearTimeout(id);
  }, [closing, ms]);

  return { show: open || closing, closing: closing && !open };
}
