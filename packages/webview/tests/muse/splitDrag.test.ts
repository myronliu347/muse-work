/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";
import {
  beginSplitDrag,
  isSplitDragging,
  onSplitDragEnd,
} from "../../src/muse/splitDrag";

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function handle(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function pointerDown(
  target: HTMLElement,
  init: { clientX?: number; clientY?: number; button?: number; pointerId?: number } = {},
): React.PointerEvent<HTMLElement> {
  return {
    preventDefault: () => {},
    currentTarget: target,
    pointerId: init.pointerId ?? 1,
    button: init.button ?? 0,
    pointerType: "mouse",
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  } as unknown as React.PointerEvent<HTMLElement>;
}

function move(init: { clientX?: number; clientY?: number }): void {
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
    }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  document.body.className = "";
});

describe("beginSplitDrag", () => {
  it("paints at most once per frame and commits once on release", async () => {
    const el = handle();
    const preview = vi.fn();
    const commit = vi.fn();

    beginSplitDrag(pointerDown(el), {
      startValue: 10,
      value: (ev) => ev.clientX,
      preview,
      commit,
    });
    expect(isSplitDragging()).toBe(true);
    expect(document.body.classList.contains("is-panel-resizing")).toBe(true);
    // The handle stays lit for the whole gesture, not just on :hover.
    expect(el.style.background).not.toBe("");

    move({ clientX: 100 });
    move({ clientX: 120 });
    expect(preview).not.toHaveBeenCalled();
    await frame();
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenLastCalledWith(120);
    expect(commit).not.toHaveBeenCalled();

    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 120 }));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(120);
    expect(isSplitDragging()).toBe(false);
    expect(document.body.classList.contains("is-panel-resizing")).toBe(false);
    expect(el.style.background).toBe("");
  });

  it("restores the starting width on Escape without committing", async () => {
    const el = handle();
    const preview = vi.fn();
    const commit = vi.fn();
    const done = vi.fn();

    beginSplitDrag(pointerDown(el), {
      startValue: 320,
      value: (ev) => ev.clientX,
      preview,
      commit,
      onDone: done,
    });
    move({ clientX: 480 });
    await frame();
    expect(preview).toHaveBeenLastCalledWith(480);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(commit).not.toHaveBeenCalled();
    expect(preview).toHaveBeenLastCalledWith(320);
    expect(done).toHaveBeenCalledWith(false);
    expect(isSplitDragging()).toBe(false);
  });

  it("drops the gesture when the pointer is cancelled", async () => {
    const el = handle();
    const commit = vi.fn();
    beginSplitDrag(pointerDown(el), {
      startValue: 240,
      value: (ev) => ev.clientX,
      preview: () => {},
      commit,
    });
    move({ clientX: 300 });
    await frame();
    window.dispatchEvent(new PointerEvent("pointercancel"));
    expect(commit).not.toHaveBeenCalled();
    expect(isSplitDragging()).toBe(false);
  });

  it("locks the row cursor for a vertical split", () => {
    const el = handle();
    beginSplitDrag(pointerDown(el), {
      startValue: 0,
      axis: "y",
      value: (ev) => ev.clientY,
      preview: () => {},
      commit: () => {},
    });
    expect(document.body.classList.contains("is-panel-resizing-row")).toBe(true);
    expect(document.body.classList.contains("is-panel-resizing")).toBe(false);
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

  it("ignores a right-button press and reports the end of a gesture", () => {
    const el = handle();
    const commit = vi.fn();
    const listener = vi.fn();
    const unsubscribe = onSplitDragEnd(listener);

    beginSplitDrag(pointerDown(el, { button: 2 }), {
      startValue: 100,
      value: (ev) => ev.clientX,
      preview: () => {},
      commit,
    });
    expect(isSplitDragging()).toBe(false);
    expect(document.body.classList.contains("is-panel-resizing")).toBe(false);

    beginSplitDrag(pointerDown(el), {
      startValue: 100,
      value: (ev) => ev.clientX,
      preview: () => {},
      commit,
    });
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
