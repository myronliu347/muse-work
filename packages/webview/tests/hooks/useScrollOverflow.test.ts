import { describe, expect, it } from "vitest";
import { scrollOverflowEdges } from "../../src/hooks/useScrollOverflow";

describe("scrollOverflowEdges", () => {
  it("stays clear when every tab fits", () => {
    expect(scrollOverflowEdges({ scrollLeft: 0, scrollWidth: 200, clientWidth: 200 })).toEqual({
      start: false,
      end: false,
    });
  });

  it("marks the end while the strip is scrolled to the start", () => {
    expect(scrollOverflowEdges({ scrollLeft: 0, scrollWidth: 400, clientWidth: 200 })).toEqual({
      start: false,
      end: true,
    });
  });

  it("marks the start once the strip has scrolled, and both sides in the middle", () => {
    expect(scrollOverflowEdges({ scrollLeft: 80, scrollWidth: 400, clientWidth: 200 })).toEqual({
      start: true,
      end: true,
    });
  });

  it("drops the end mark when scrolled to the end", () => {
    expect(scrollOverflowEdges({ scrollLeft: 200, scrollWidth: 400, clientWidth: 200 })).toEqual({
      start: true,
      end: false,
    });
  });
});
