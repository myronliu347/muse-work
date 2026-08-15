/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  clampFileTreeWidth,
  ensureExpandedForFile,
  emptyFileTreeState,
  FILE_TREE_WIDTH_MIN,
  FILE_TREE_WIDTH_MAX,
} from "../../src/stores/panelGroupStore";

describe("emptyFileTreeState", () => {
  it("defaults the tree column to collapsed", () => {
    expect(emptyFileTreeState().collapsed).toBe(true);
  });
});

describe("clampFileTreeWidth", () => {
  it("clamps to min/max", () => {
    expect(clampFileTreeWidth(100)).toBe(FILE_TREE_WIDTH_MIN);
    expect(clampFileTreeWidth(999)).toBe(FILE_TREE_WIDTH_MAX);
    expect(clampFileTreeWidth(240)).toBe(240);
  });
});

describe("ensureExpandedForFile", () => {
  it("expands ancestor dirs under workdir", () => {
    const next = ensureExpandedForFile(
      emptyFileTreeState(),
      "/work/proj",
      "/work/proj/src/a/b.ts",
    );
    expect(next.expanded).toEqual(expect.arrayContaining(["src", "src/a"]));
    expect(next.selected).toBe("/work/proj/src/a/b.ts");
  });

  it("no-ops expand when file is outside workdir", () => {
    const base = emptyFileTreeState();
    const next = ensureExpandedForFile(base, "/work/proj", "/other/x.ts");
    expect(next.expanded).toEqual(base.expanded);
    expect(next.selected).toBe("/other/x.ts");
  });
});
