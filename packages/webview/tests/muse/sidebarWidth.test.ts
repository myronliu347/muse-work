/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_SIDEBAR_MAX_WIDTH,
  DESKTOP_SIDEBAR_MIN_WIDTH,
  DESKTOP_SIDEBAR_WIDTH,
} from "../../src/muse/layout";
import {
  DESKTOP_SIDEBAR_WIDTH_STORAGE_KEY,
  getDesktopSidebarWidth,
  resetDesktopSidebarWidth,
  setDesktopSidebarWidth,
  subscribeDesktopSidebarWidth,
} from "../../src/muse/sidebarWidth";

afterEach(() => {
  resetDesktopSidebarWidth();
});

describe("desktop sidebar width store", () => {
  it("starts at the default overlay width", () => {
    expect(getDesktopSidebarWidth()).toBe(DESKTOP_SIDEBAR_WIDTH);
  });

  it("clamps, persists, and notifies subscribers", () => {
    const seen: number[] = [];
    const unsub = subscribeDesktopSidebarWidth(() => {
      seen.push(getDesktopSidebarWidth());
    });
    setDesktopSidebarWidth(320);
    expect(getDesktopSidebarWidth()).toBe(320);
    expect(localStorage.getItem(DESKTOP_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      "320",
    );
    setDesktopSidebarWidth(80);
    expect(getDesktopSidebarWidth()).toBe(DESKTOP_SIDEBAR_MIN_WIDTH);
    setDesktopSidebarWidth(900);
    expect(getDesktopSidebarWidth()).toBe(DESKTOP_SIDEBAR_MAX_WIDTH);
    unsub();
    expect(seen).toEqual([
      320,
      DESKTOP_SIDEBAR_MIN_WIDTH,
      DESKTOP_SIDEBAR_MAX_WIDTH,
    ]);
  });
});
