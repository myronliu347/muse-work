/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  OverflowScroller,
  overflowEdgeDirection,
} from "../../src/components/shared/OverflowScroller";

describe("overflowEdgeDirection", () => {
  const base = {
    rect: { left: 0, right: 100 },
    scrollLeft: 0,
    scrollWidth: 300,
    clientWidth: 100,
    edgeZone: 20,
  };

  it("ignores a strip that fits", () => {
    expect(
      overflowEdgeDirection({ ...base, scrollWidth: 100, clientX: 99 }),
    ).toBe(0);
  });

  it("pushes left only when the start is scrolled away", () => {
    expect(overflowEdgeDirection({ ...base, clientX: 5 })).toBe(0);
    expect(
      overflowEdgeDirection({ ...base, clientX: 5, scrollLeft: 50 }),
    ).toBe(-1);
  });

  it("pushes right only when the end is hidden", () => {
    expect(overflowEdgeDirection({ ...base, clientX: 98 })).toBe(1);
    expect(
      overflowEdgeDirection({ ...base, clientX: 98, scrollLeft: 200 }),
    ).toBe(0);
  });
});

describe("OverflowScroller", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks faded edges after the strip overflows", async () => {
    const { rerender } = render(
      <OverflowScroller data-testid="strip">
        <span>one</span>
      </OverflowScroller>,
    );
    const strip = screen.getByTestId("strip");
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 320 });
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: 120 });
    Object.defineProperty(strip, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    act(() => {
      strip.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => {
      expect(strip.className).toContain("is-overflow-end");
    });
    expect(strip.className).not.toContain("is-overflow-start");

    act(() => {
      strip.scrollLeft = 200;
      strip.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => {
      expect(strip.className).toContain("is-overflow-start");
      expect(strip.className).not.toContain("is-overflow-end");
    });
    rerender(
      <OverflowScroller data-testid="strip">
        <span>one</span>
        <span>two</span>
      </OverflowScroller>,
    );
  });

  it("keeps scrolling while the pointer rests on the faded end", () => {
    let frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      frameId += 1;
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    render(
      <OverflowScroller data-testid="strip">
        <span>one</span>
      </OverflowScroller>,
    );
    const strip = screen.getByTestId("strip");
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 300 });
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: 100 });
    Object.defineProperty(strip, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0,
    });
    vi.spyOn(strip, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 100,
      top: 0,
      bottom: 24,
      width: 100,
      height: 24,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerMove(strip, { clientX: 96 });
    expect(strip.scrollLeft).toBeGreaterThan(0);
    fireEvent.pointerLeave(strip);
  });
});
