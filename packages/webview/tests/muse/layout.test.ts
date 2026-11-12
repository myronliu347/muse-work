import { describe, expect, it } from "vitest";
import {
  CHAT_CONTENT_MIN_WIDTH,
  DESKTOP_SIDEBAR_MAX_WIDTH,
  DESKTOP_SIDEBAR_MIN_WIDTH,
  DESKTOP_SIDEBAR_WIDTH,
  MIN_PANE_WIDTH,
  PANEL_MIN_WIDTH,
  chatMainMinWidth,
  clampDockWidth,
  clampSidebarWidth,
  dockFlexGridColumns,
  minPaneWidth,
  paneHasSidebarInset,
} from "../../src/muse/layout";

describe("clampSidebarWidth", () => {
  it("clamps into the sidebar min/max", () => {
    expect(DESKTOP_SIDEBAR_MIN_WIDTH).toBe(180);
    expect(DESKTOP_SIDEBAR_MAX_WIDTH).toBe(400);
    expect(clampSidebarWidth(240)).toBe(240);
    expect(clampSidebarWidth(100)).toBe(DESKTOP_SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(800)).toBe(DESKTOP_SIDEBAR_MAX_WIDTH);
    // The icon rail is a fixed 52px. That constant is not this clamp's identity.
    expect(DESKTOP_SIDEBAR_WIDTH).toBe(52);
    expect(clampSidebarWidth(DESKTOP_SIDEBAR_WIDTH)).toBe(
      DESKTOP_SIDEBAR_MIN_WIDTH,
    );
  });
});

describe("chatMainMinWidth", () => {
  it("adds overlay sidebar padding on the inset pane", () => {
    expect(chatMainMinWidth(true)).toBe(
      CHAT_CONTENT_MIN_WIDTH + DESKTOP_SIDEBAR_WIDTH,
    );
    expect(chatMainMinWidth(false)).toBe(CHAT_CONTENT_MIN_WIDTH);
    expect(chatMainMinWidth(true, 320)).toBe(CHAT_CONTENT_MIN_WIDTH + 320);
  });
});

describe("minPaneWidth", () => {
  it("reserves sidebar width on the first pane in a row", () => {
    expect(minPaneWidth(true)).toBe(MIN_PANE_WIDTH + DESKTOP_SIDEBAR_WIDTH);
    expect(minPaneWidth(false)).toBe(MIN_PANE_WIDTH);
    expect(minPaneWidth(true, 320)).toBe(MIN_PANE_WIDTH + 320);
  });
});

describe("clampDockWidth", () => {
  it("keeps the preferred panel minimum when leftover is large", () => {
    expect(clampDockWidth(420, 800)).toBe(420);
    expect(clampDockWidth(200, 800)).toBe(PANEL_MIN_WIDTH);
  });

  it("never uses a min larger than leftover, so the dock shrinks instead of clipping", () => {
    expect(clampDockWidth(420, 200)).toBe(200);
    expect(clampDockWidth(100, 200)).toBe(200);
  });

  it("returns 0 when leftover is not positive", () => {
    expect(clampDockWidth(420, 0)).toBe(0);
    expect(clampDockWidth(420, -40)).toBe(0);
  });
});

describe("dockFlexGridColumns", () => {
  it("keeps the chat at its pinned width and gives the leftover to the dock", () => {
    expect(dockFlexGridColumns(800, 572)).toBe(
      "minmax(572px, 800px) minmax(320px, 1fr)",
    );
    expect(dockFlexGridColumns(480, 572, PANEL_MIN_WIDTH)).toBe(
      "minmax(480px, 480px) minmax(320px, 1fr)",
    );
  });
});

describe("paneHasSidebarInset", () => {
  it("treats a single-pane host as inset", () => {
    expect(paneHasSidebarInset(undefined, undefined)).toBe(true);
    expect(paneHasSidebarInset([], "a")).toBe(true);
  });

  it("is true only for the first pane of each row", () => {
    const panes = [
      { paneId: "top-left", row: 0 },
      { paneId: "top-right", row: 0 },
      { paneId: "bottom-left", row: 1 },
    ];
    expect(paneHasSidebarInset(panes, "top-left")).toBe(true);
    expect(paneHasSidebarInset(panes, "top-right")).toBe(false);
    expect(paneHasSidebarInset(panes, "bottom-left")).toBe(true);
  });
});
