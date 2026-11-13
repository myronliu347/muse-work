/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { OverflowText } from "../../src/components/shared/OverflowText";

function stubTextWidths(scrollWidth: number, clientWidth: number) {
  const proto = HTMLElement.prototype;
  const previousScroll = Object.getOwnPropertyDescriptor(proto, "scrollWidth");
  const previousClient = Object.getOwnPropertyDescriptor(proto, "clientWidth");
  Object.defineProperty(proto, "scrollWidth", {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
  return () => {
    if (previousScroll) Object.defineProperty(proto, "scrollWidth", previousScroll);
    else delete (proto as { scrollWidth?: number }).scrollWidth;
    if (previousClient) Object.defineProperty(proto, "clientWidth", previousClient);
    else delete (proto as { clientWidth?: number }).clientWidth;
  };
}

describe("OverflowText", () => {
  afterEach(() => {
    // Each test restores its own stubs.
  });

  it("does not move text that fits", () => {
    render(<OverflowText text="App.tsx" />);
    const outer = screen.getByText("App.tsx").parentElement as HTMLElement;
    fireEvent.pointerEnter(outer);
    expect(outer.className).not.toContain("is-scrolling");
    expect(
      outer.querySelector<HTMLElement>(".overflow-text-inner")?.style.transform,
    ).toBe("");
  });

  it("slides the full label into view on hover", () => {
    const restore = stubTextWidths(220, 100);
    try {
      render(
        <OverflowText
          text="prototype-html.ts"
          title="src/prototype-html.ts"
          hoverDelay={0}
        />,
      );
      const outer = screen.getByText("prototype-html.ts").parentElement as HTMLElement;
      expect(outer).toHaveAttribute("title", "src/prototype-html.ts");

      fireEvent.pointerEnter(outer);
      expect(outer.className).toContain("is-scrolling");
      expect(
        outer.querySelector<HTMLElement>(".overflow-text-inner")?.style.transform,
      ).toBe("translateX(-120px)");

      fireEvent.pointerLeave(outer);
      expect(outer.className).not.toContain("is-scrolling");
    } finally {
      restore();
    }
  });

  it("waits 400ms before starting the slide", () => {
    vi.useFakeTimers();
    const restore = stubTextWidths(220, 100);
    try {
      render(<OverflowText text="prototype-html.ts" />);
      const outer = screen.getByText("prototype-html.ts").parentElement as HTMLElement;

      fireEvent.pointerEnter(outer);
      expect(outer.className).not.toContain("is-scrolling");
      act(() => {
        vi.advanceTimersByTime(399);
      });
      expect(outer.className).not.toContain("is-scrolling");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(outer.className).toContain("is-scrolling");

      fireEvent.pointerLeave(outer);
      expect(outer.className).not.toContain("is-scrolling");
    } finally {
      restore();
      vi.useRealTimers();
    }
  });
});
