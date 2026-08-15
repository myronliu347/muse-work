/** @vitest-environment node */
import { describe, it, expect, beforeEach } from "vitest";
import {
  usePanelGroupStore,
  workdirTermId,
  prunePanelGroupCache,
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
