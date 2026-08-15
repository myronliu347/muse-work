import { describe, it, expect } from "vitest";
import {
  toPierrePatch,
  resolveDiffLineText,
} from "../../src/utils/toPierrePatch";

const base = {
  path: "src/a.ts",
  status: "modified" as const,
  hunks: "@@ -1 +1 @@\n-old\n+new",
  binary: false,
};

describe("toPierrePatch", () => {
  it("returns null for binary or empty hunks", () => {
    expect(toPierrePatch({ ...base, binary: true })).toBeNull();
    expect(toPierrePatch({ ...base, hunks: "" })).toBeNull();
  });

  it("wraps tracked hunks with ---/+++ headers", () => {
    expect(toPierrePatch(base)).toBe(
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new",
    );
  });

  it("uses /dev/null for added and deleted", () => {
    expect(toPierrePatch({ ...base, status: "added" })).toContain(
      "--- /dev/null\n+++ b/src/a.ts\n",
    );
    expect(toPierrePatch({ ...base, status: "deleted" })).toContain(
      "--- a/src/a.ts\n+++ /dev/null\n",
    );
  });

  it("uses oldPath for renamed", () => {
    expect(
      toPierrePatch({
        ...base,
        status: "renamed",
        oldPath: "src/old.ts",
        path: "src/new.ts",
      }),
    ).toContain("--- a/src/old.ts\n+++ b/src/new.ts\n");
  });

  it("synthesizes hunk header for untracked +only lines", () => {
    const patch = toPierrePatch({
      path: "new.txt",
      status: "untracked",
      hunks: "+a\n+b",
      binary: false,
    });
    expect(patch).toBe(
      "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+a\n+b",
    );
  });
});

describe("resolveDiffLineText", () => {
  it("resolves addition/deletion line text by 1-based file line number", () => {
    const patch =
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new";
    expect(resolveDiffLineText(patch, "deletions", 1)).toBe("old");
    expect(resolveDiffLineText(patch, "additions", 1)).toBe("new");
  });
});
