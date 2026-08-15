/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { emptyPanelGroup } from "../../src/stores/panelGroupStore";

describe("emptyPanelGroup dock chrome fields", () => {
  it("defaults collapsedTabs null and dockFullscreen false", () => {
    const g = emptyPanelGroup();
    expect(g.collapsedTabs).toBeNull();
    expect(g.dockFullscreen).toBe(false);
  });
});
