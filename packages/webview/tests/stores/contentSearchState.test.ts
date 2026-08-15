import { describe, expect, it } from "vitest";
import {
  emptyPanelGroup,
  emptyContentSearchState,
  resolvePanelGroup,
} from "../../src/stores/panelGroupStore";

describe("content search panel state", () => {
  it("emptyPanelGroup defaults to tree mode and empty search", () => {
    const g = emptyPanelGroup();
    expect(g.fileSidebarMode).toBe("tree");
    expect(g.contentSearch).toEqual(emptyContentSearchState());
  });

  it("resolvePanelGroup backfills missing fields", () => {
    const partial = {
      ...emptyPanelGroup(),
    } as ReturnType<typeof emptyPanelGroup>;
    delete (partial as { fileSidebarMode?: unknown }).fileSidebarMode;
    delete (partial as { contentSearch?: unknown }).contentSearch;
    const resolved = resolvePanelGroup({ sess: partial }, "sess");
    expect(resolved.fileSidebarMode).toBe("tree");
    expect(resolved.contentSearch).toEqual(emptyContentSearchState());
  });
});
