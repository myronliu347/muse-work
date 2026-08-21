/** @vitest-environment node */
import { describe, it, expect, beforeEach } from "vitest";
import {
  usePanelGroupStore,
  workdirTermId,
  prunePanelGroupCache,
  releasePanelContent,
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
    fileView: {
      path: "/w/big.ts",
      host: "local",
      content: "export const x = 1;".repeat(1000),
    },
    diffView: { mode: "recent" as const, file: { path: "/w/a.ts", hunks: "diff --git ..." } },
    contentSearch: {
      ...emptyContentSearchState(),
      query: "foo",
      results: [{ filePath: "/w/a.ts", matches: [{ line: 1, startCol: 0, text: "foo" }] }],
      expandedFiles: ["/w/a.ts"],
    },
  });

  it("releases file view + search results when the file panel closes", () => {
    const patch = releasePanelContent(groupWithBigPayloads(), "file");
    expect(patch.fileView).toBeNull();
    expect(patch.contentSearch).toEqual(emptyContentSearchState());
  });

  it("releases the diff view when the diff panel closes", () => {
    const patch = releasePanelContent(groupWithBigPayloads(), "diff");
    expect(patch.diffView).toBeNull();
  });

  it("keeps file/diff contents when an unrelated panel closes", () => {
    const group = groupWithBigPayloads();
    const patch = releasePanelContent(group, "preview");
    expect(patch.fileView).toBeUndefined();
    expect(patch.diffView).toBeUndefined();
    expect(patch.contentSearch).toBeUndefined();
  });
});
