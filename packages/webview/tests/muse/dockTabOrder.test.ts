import { describe, expect, it } from "vitest";
import {
  defaultDockTabKeys,
  fileTabKey,
  insertTabAfterCurrent,
  kindTabKey,
  moveDockTab,
  reconcileTabOrder,
  toolTabKey,
} from "../../src/muse/dockTabOrder";

describe("dock tab order", () => {
  const present = [
    "detail",
    kindTabKey("file"),
    toolTabKey("t1"),
    kindTabKey("diff"),
  ];

  it("keeps the default kind order until the user rearranges tabs", () => {
    expect(
      defaultDockTabKeys({
        detail: true,
        checked: ["diff", "file"],
        filePaths: [],
        tools: [{ id: "t1", kind: "terminal" }],
      }),
    ).toEqual(present);
    expect(reconcileTabOrder(undefined, present)).toEqual(present);
  });

  it("inserts a new tab after the one that is current", () => {
    expect(
      insertTabAfterCurrent(undefined, ["detail", kindTabKey("diff")], kindTabKey("diff"), toolTabKey("t1")),
    ).toEqual(["detail", kindTabKey("diff"), toolTabKey("t1")]);
    expect(
      insertTabAfterCurrent(undefined, ["detail", kindTabKey("diff")], "detail", toolTabKey("t1")),
    ).toEqual(["detail", toolTabKey("t1"), kindTabKey("diff")]);
  });

  it("moves a dragged tab to the dropped side", () => {
    expect(moveDockTab(present, kindTabKey("diff"), "detail", true)).toEqual([
      "detail",
      kindTabKey("diff"),
      kindTabKey("file"),
      toolTabKey("t1"),
    ]);
  });

  it("keeps a new issue's files where the previous file tabs were", () => {
    const stored = ["detail", fileTabKey("/work/old/App.tsx"), kindTabKey("diff")];
    const next = ["detail", fileTabKey("/work/radii/App.tsx"), kindTabKey("diff")];
    expect(reconcileTabOrder(stored, next)).toEqual(next);
  });
});
