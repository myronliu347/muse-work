/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY,
  getDesktopSidebarCollapsed,
  resetDesktopSidebarCollapsed,
  setDesktopSidebarCollapsed,
  subscribeDesktopSidebarCollapsed,
  toggleDesktopSidebarCollapsed,
} from "../../src/muse/sidebarCollapsed";

afterEach(() => {
  resetDesktopSidebarCollapsed();
});

describe("desktop sidebar collapsed store", () => {
  it("starts expanded", () => {
    expect(getDesktopSidebarCollapsed()).toBe(false);
  });

  it("persists, toggles, and notifies subscribers", () => {
    const seen: boolean[] = [];
    const unsub = subscribeDesktopSidebarCollapsed(() => {
      seen.push(getDesktopSidebarCollapsed());
    });
    setDesktopSidebarCollapsed(true);
    expect(getDesktopSidebarCollapsed()).toBe(true);
    expect(localStorage.getItem(DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "1",
    );
    toggleDesktopSidebarCollapsed();
    expect(getDesktopSidebarCollapsed()).toBe(false);
    unsub();
    expect(seen).toEqual([true, false]);
  });
});
