/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MermaidRenderer } from "../../src/components/message/MermaidRenderer";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({
      svg: '<svg width="400" height="200"><g /></svg>',
      bindFunctions: vi.fn(),
    }),
  },
}));

function rect(width: number, height: number): DOMRect {
  return {
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

// jsdom reports 0x0 for every box; give the modal viewport and the diagram a
// size so the fit math has something to work with. Restored by hand: a blanket
// `vi.restoreAllMocks()` would also reset the mermaid module mock.
let rectSpy: ReturnType<typeof vi.spyOn> | null = null;

function mockBoxes(): void {
  rectSpy = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      if (this.classList.contains("fullscreen-content")) return rect(1000, 800);
      if (this.tagName.toLowerCase() === "svg") return rect(400, 200);
      return rect(0, 0);
    });
}

afterEach(() => {
  rectSpy?.mockRestore();
  rectSpy = null;
});

describe("Mermaid fullscreen modal", () => {
  it("opens fitted to the viewport instead of at the message-column size", async () => {
    // The diagram is laid out for the transcript (400x200); the modal viewport
    // is 1000x800, so it should open around 234% (32px margin, fit by width).
    mockBoxes();

    render(<MermaidRenderer content={"graph TD\nA-->B"} />);
    fireEvent.click(await screen.findByTitle("全屏查看"));

    const modal = document.querySelector<HTMLElement>(".mermaid-fullscreen-modal");
    expect(modal).toBeTruthy();
    expect(modal?.querySelector(".zoom-info")?.textContent).toBe("234%");
    expect(
      modal?.querySelector(".fullscreen-diagram")?.getAttribute("style"),
    ).toContain("scale(2.34)");
  });

  it("portals the scrim out of the transcript so it covers the whole window", async () => {
    render(<MermaidRenderer content={"graph TD\nA-->B"} />);
    fireEvent.click(await screen.findByTitle("全屏查看"));

    const modal = document.querySelector<HTMLElement>(".mermaid-fullscreen-modal");
    expect(modal).toBeTruthy();
    // Mounted as a direct child of the overlay host (body when the theme tree
    // is absent), not inside .mermaid-renderer where a transformed virtual row
    // would clip `position: fixed`.
    expect(modal?.parentElement).toBe(document.body);
    expect(modal?.closest(".mermaid-renderer")).toBeNull();
  });

  it("re-fits on demand and returns to 1:1", async () => {
    mockBoxes();

    render(<MermaidRenderer content={"graph TD\nA-->B"} />);
    fireEvent.click(await screen.findByTitle("全屏查看"));

    const modal = document.querySelector<HTMLElement>(".mermaid-fullscreen-modal");
    const zoom = () => modal?.querySelector(".zoom-info")?.textContent;

    fireEvent.click(screen.getByTitle("原始尺寸"));
    expect(zoom()).toBe("100%");
    fireEvent.click(screen.getByTitle("适应屏幕"));
    expect(zoom()).toBe("234%");
  });
});
