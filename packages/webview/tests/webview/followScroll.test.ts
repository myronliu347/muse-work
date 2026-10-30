import { describe, expect, it } from "vitest";
import {
  resolveFollowScrollTop,
  scrollTopAfterSizeChange,
} from "../../src/components/chat/followScroll";

describe("resolveFollowScrollTop", () => {
  it("lands a follow adjustment on the visual bottom, not the spacer offset", () => {
    expect(resolveFollowScrollTop(1620, 1900, true, 20)).toBe(1900);
  });

  it("keeps the virtualizer offset when the user has scrolled up", () => {
    expect(resolveFollowScrollTop(1620, 1900, false, 20)).toBe(1620);
  });

  it("keeps an explicit scroll target while following", () => {
    expect(resolveFollowScrollTop(800, 1900, true, 0)).toBe(800);
  });

  it("keeps the current offset when a disclosure toggle resizes a row", () => {
    expect(scrollTopAfterSizeChange(640, 2100, 2400, true, 480, true)).toBe(640);
  });
});
