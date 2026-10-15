/** @vitest-environment node */
import { describe, it, expect, beforeEach } from "vitest";
import {
  usePanelGroupStore,
  workdirTermId,
  prunePanelGroupCache,
  releasePanelContent,
  applyCloseFileTab,
  emptyPanelGroup,
  emptyContentSearchState,
} from "../../src/stores/panelGroupStore";

beforeEach(() => {
  usePanelGroupStore.getState().reset();
});

describe("workdirTermId", () => {
  it("encodes absolute paths", () => {
    expect(workdirTermId("/Users/a/proj")).toBe(
      "term-wd-" + encodeURIComponent("/Users/a/proj"),
    );
  });
});

describe("prunePanelGroupCache", () => {
  it("returns removed workdir keys", () => {
    const store = usePanelGroupStore.getState();
    store.ensureGroup("/work/a");
    store.ensureGroup("/work/b");
    const removed = prunePanelGroupCache(new Set(["/work/a"]));
    expect(removed).toEqual(["/work/b"]);
    expect(Object.keys(usePanelGroupStore.getState().groups)).toEqual([
      "/work/a",
    ]);
  });
});

describe("releasePanelContent", () => {
  const groupWithBigPayloads = () => ({
    ...emptyPanelGroup(),
    fileTabs: [
      {
        path: "/w/big.ts",
        host: "local",
        content: "export const x = 1;".repeat(1000),
      },
    ],
    activeFilePath: "/w/big.ts",
    diffView: { mode: "recent" as const, file: { path: "/w/a.ts", hunks: "diff --git ..." } },
    contentSearch: {
      ...emptyContentSearchState(),
      query: "foo",
      results: [{ filePath: "/w/a.ts", matches: [{ line: 1, startCol: 0, text: "foo" }] }],
      expandedFiles: ["/w/a.ts"],
    },
  });

  it("releases file tabs + search results when the file panel closes", () => {
    const patch = releasePanelContent(groupWithBigPayloads(), "file");
    expect(patch.fileTabs).toEqual([]);
    expect(patch.activeFilePath).toBeNull();
    expect(patch.contentSearch).toEqual(emptyContentSearchState());
  });

  it("releases the diff view when the diff panel closes", () => {
    const patch = releasePanelContent(groupWithBigPayloads(), "diff");
    expect(patch.diffView).toBeNull();
  });

  it("keeps file/diff contents when an unrelated panel closes", () => {
    const group = groupWithBigPayloads();
    const patch = releasePanelContent(group, "preview");
    expect(patch.fileTabs).toBeUndefined();
    expect(patch.activeFilePath).toBeUndefined();
    expect(patch.diffView).toBeUndefined();
    expect(patch.contentSearch).toBeUndefined();
  });
});

describe("applyCloseFileTab", () => {
  const tab = (path: string) => ({ path, host: "local" as const });

  it("closes one file and keeps the panel when another file stays open", () => {
    const patch = applyCloseFileTab(
      {
        ...emptyPanelGroup(),
        checked: ["file"],
        active: "file",
        fileTabs: [tab("/w/a.ts"), tab("/w/b.ts")],
        activeFilePath: "/w/b.ts",
      },
      "/w/b.ts",
    );
    expect(patch.fileTabs?.map((t) => t.path)).toEqual(["/w/a.ts"]);
    expect(patch.activeFilePath).toBe("/w/a.ts");
    expect(patch.checked).toBeUndefined();
  });

  it("closes the file panel together with the last file tab", () => {
    const patch = applyCloseFileTab(
      {
        ...emptyPanelGroup(),
        checked: ["diff", "file"],
        active: "file",
        fileTabs: [tab("/w/a.ts")],
        activeFilePath: "/w/a.ts",
      },
      "/w/a.ts",
    );
    expect(patch.fileTabs).toEqual([]);
    expect(patch.activeFilePath).toBeNull();
    expect(patch.checked).toEqual(["diff"]);
    expect(patch.active).toBe("diff");
  });

  it("collapses the dock when the last file was the only panel", () => {
    const patch = applyCloseFileTab(
      {
        ...emptyPanelGroup(),
        checked: ["file"],
        active: "file",
        fileTabs: [tab("/w/a.ts")],
        activeFilePath: "/w/a.ts",
      },
      "/w/a.ts",
    );
    expect(patch.checked).toEqual([]);
    expect(patch.active).toBeNull();
    expect(patch.fileTabs).toEqual([]);
  });
});
