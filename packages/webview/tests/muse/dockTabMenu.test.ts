import { describe, expect, it } from "vitest";
import { dockTabsToClose } from "../../src/muse/dockTabMenu";

const order = ["detail", "file:/a.ts", "kind:terminal", "kind:diff"];

describe("dockTabsToClose", () => {
  it("leaves 详情 in place", () => {
    expect(dockTabsToClose(order, "detail", "one")).toEqual([]);
    expect(dockTabsToClose(order, "detail", "all")).toEqual([
      "file:/a.ts",
      "kind:terminal",
      "kind:diff",
    ]);
  });

  it("closes the other tabs, the ones to the right, or every closeable tab", () => {
    expect(dockTabsToClose(order, "kind:terminal", "one")).toEqual(["kind:terminal"]);
    expect(dockTabsToClose(order, "kind:terminal", "others")).toEqual([
      "file:/a.ts",
      "kind:diff",
    ]);
    expect(dockTabsToClose(order, "kind:terminal", "right")).toEqual(["kind:diff"]);
    expect(dockTabsToClose(order, "kind:diff", "right")).toEqual([]);
  });
});
