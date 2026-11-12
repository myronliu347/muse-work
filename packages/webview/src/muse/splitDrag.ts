/**
 * One split-drag gesture for every resizable column in the app.
 *
 * Every splitter used to commit its width to React state (and, for the panel
 * tree, to the localStorage snapshot) on every mousemove. A 120 Hz pointer
 * stream then re-rendered the whole conversation and rewrote the snapshot per
 * event, which is what made the assistant dock and the three-column split
 * stutter. Here the gesture is one place:
 *
 * - the pointer is captured on the handle, so the drag survives crossing the
 *   dock's <webview>/xterm instead of dying there;
 * - moves are coalesced to one animation frame;
 * - the live width is written straight to the DOM (`preview`), and React
 *   state is updated once, on release (`commit`);
 * - Escape / pointercancel restores the starting width without committing;
 * - the cursor lock and the handle highlight are shared, not copy-pasted.
 */
import type * as React from "react";

export type SplitDragSpec = {
  /** Width the drag starts from. Restored when the gesture is cancelled. */
  startValue: number;
  /** Cursor lock: columns drag horizontally, the shell's rows vertically. */
  axis?: "x" | "y";
  /** Pointer position → width. Called at most once per frame. */
  value: (event: PointerEvent) => number;
  /** Live width. DOM writes only — never setState or a store write. */
  preview: (value: number) => void;
  /** Final width, called exactly once when the pointer is released. */
  commit: (value: number) => void;
  /** Gesture over, committed or cancelled. Lets callers drop drag chrome. */
  onDone?: (committed: boolean) => void;
};

const DRAGGING_CLASS = "is-panel-resizing";
const DRAGGING_ROW_CLASS = "is-panel-resizing-row";

let activeDrags = 0;
const endListeners = new Set<() => void>();

/** True while any splitter is being dragged. Layout measurements wait for it. */
export function isSplitDragging(): boolean {
  return activeDrags > 0;
}

/**
 * Fires once when the last gesture ends, so measurement observers can re-read
 * the layout a single time instead of per frame during the drag.
 */
export function onSplitDragEnd(listener: () => void): () => void {
  endListeners.add(listener);
  return () => {
    endListeners.delete(listener);
  };
}

function dragEnded(): void {
  activeDrags = Math.max(0, activeDrags - 1);
  if (activeDrags > 0) return;
  for (const listener of endListeners) listener();
}

function canAnimate(): boolean {
  return typeof requestAnimationFrame === "function";
}

function schedule(callback: () => void): number {
  return canAnimate()
    ? requestAnimationFrame(callback)
    : (setTimeout(callback, 16) as unknown as number);
}

function unschedule(handle: number): void {
  if (canAnimate()) cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

/**
 * Start a split drag from a `pointerdown` on the handle. Returns nothing: the
 * gesture owns the window listeners until the pointer is released.
 */
export function beginSplitDrag(
  event: React.PointerEvent<HTMLElement>,
  spec: SplitDragSpec,
): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();

  const handle = event.currentTarget;
  const pointerId = event.pointerId;
  const previousBackground = handle.style.background;
  handle.style.background = "var(--accent-9)";
  const draggingClass = spec.axis === "y" ? DRAGGING_ROW_CLASS : DRAGGING_CLASS;
  document.body.classList.add(draggingClass);
  activeDrags += 1;
  try {
    handle.setPointerCapture?.(pointerId);
  } catch {
    /* the handle can be gone already (tab switched mid-gesture) */
  }

  let frame: number | null = null;
  let lastEvent: PointerEvent | null = null;
  let live = spec.startValue;
  let finished = false;

  const measure = (): void => {
    if (!lastEvent) return;
    live = spec.value(lastEvent);
    spec.preview(live);
  };

  const onPointerMove = (moveEvent: PointerEvent): void => {
    if (finished) return;
    lastEvent = moveEvent;
    if (frame != null) return;
    frame = schedule(() => {
      frame = null;
      if (finished) return;
      measure();
    });
  };

  const cleanup = (): void => {
    finished = true;
    if (frame != null) unschedule(frame);
    frame = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("keydown", onKeyDown, true);
    try {
      handle.releasePointerCapture?.(pointerId);
    } catch {
      /* already released */
    }
    handle.style.background = previousBackground;
    document.body.classList.remove(draggingClass);
    dragEnded();
  };

  const settle = (): void => {
    if (finished) return;
    if (frame != null) {
      unschedule(frame);
      frame = null;
    }
    measure();
    cleanup();
    spec.onDone?.(true);
    spec.commit(live);
  };

  const abort = (): void => {
    if (finished) return;
    cleanup();
    spec.onDone?.(false);
    spec.preview(spec.startValue);
  };

  const onPointerUp = (): void => settle();
  const onPointerCancel = (): void => abort();
  const onWindowBlur = (): void => abort();
  const onKeyDown = (keyEvent: KeyboardEvent): void => {
    if (keyEvent.key !== "Escape") return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    abort();
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("blur", onWindowBlur);
  // Capture so Escape reaches the gesture before a dialog / editor eats it.
  window.addEventListener("keydown", onKeyDown, true);
}

/**
 * Width of a column whose left edge is dragged: the right edge is the anchor,
 * so the width is whatever the pointer leaves. Shared by the dock and by every
 * panel that sits against the right side of the window.
 */
export function widthFromRightEdge(
  right: number,
  event: PointerEvent,
  clamp: (width: number) => number,
): number {
  return clamp(right - event.clientX);
}

/** Width of a column whose right edge is dragged (tree/nav columns). */
export function widthFromLeftEdge(
  startX: number,
  startWidth: number,
  event: PointerEvent,
  clamp: (width: number) => number,
): number {
  return clamp(startWidth + (startX - event.clientX));
}
