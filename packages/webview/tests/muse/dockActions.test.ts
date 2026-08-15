import { describe, expect, it } from "vitest";
import { collapseDockState, expandDockState } from "../../src/muse/dockActions";

describe("collapseDockState / expandDockState", () => {
  it("collapses open dock into collapsedTabs and clears fullscreen", () => {
    expect(
      collapseDockState({ checked: ["preview", "diff"], active: "diff" }),
    ).toEqual({
      collapsedTabs: { checked: ["preview", "diff"], active: "diff" },
      checked: [],
      active: null,
      dockFullscreen: false,
    });
  });

  it("expands from history and defaults to diff", () => {
    expect(expandDockState(null)).toEqual({
      checked: ["diff"],
      active: "diff",
      collapsedTabs: null,
      dockFullscreen: false,
    });
  });
});
