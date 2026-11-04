/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { installScrollingScrollbars } from "../../src/ui/scrollingScrollbar";

describe("installScrollingScrollbars", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-scrolling");
  });

  it("marks the scrolled element and clears it after it settles", () => {
    vi.useFakeTimers();
    const stop = installScrollingScrollbars();
    const el = document.createElement("div");
    document.body.appendChild(el);

    el.dispatchEvent(new Event("scroll"));

    expect(el.hasAttribute("data-scrolling")).toBe(true);
    vi.advanceTimersByTime(699);
    expect(el.hasAttribute("data-scrolling")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.hasAttribute("data-scrolling")).toBe(false);

    stop();
    el.remove();
  });
});
