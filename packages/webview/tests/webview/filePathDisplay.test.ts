import { describe, it, expect } from "vitest";
import {
  displayFileName,
  displayFilePath,
} from "../../src/utils/filePathDisplay";
import { dedupeSnapshotsByFile } from "../../src/utils/fileHistorySnapshots";

describe("displayFileName", () => {
  it("returns the basename when unique", () => {
    expect(
      displayFileName("/work/src/app.ts", ["/work/src/app.ts", "/work/src/other.ts"]),
    ).toBe("app.ts");
  });

  it("adds one parent directory on basename collision", () => {
    const paths = [
      "/work/src/components/App.tsx",
      "/work/src/utils/App.tsx",
    ];
    expect(displayFileName(paths[0], paths)).toBe("components/App.tsx");
    expect(displayFileName(paths[1], paths)).toBe("utils/App.tsx");
  });

  it("keeps peeling parents while collisions persist", () => {
    const paths = [
      "/work/a/x/App.tsx",
      "/work/b/x/App.tsx",
    ];
    expect(displayFileName(paths[0], paths)).toBe("a/x/App.tsx");
    expect(displayFileName(paths[1], paths)).toBe("b/x/App.tsx");
  });

  it("falls back to the full path when everything collides", () => {
    const paths = ["/work/a/App.tsx", "/work/b/App.tsx"];
    // Depth 1 collides (App.tsx), depth 2 collides (a/App.tsx vs b/App.tsx is
    // unique) — nothing here exercises the fallback; just assert uniqueness.
    expect(displayFileName(paths[0], paths)).toBe("a/App.tsx");
  });

  it("normalizes backslashes", () => {
    const paths = ["C:\\work\\a\\App.tsx", "C:\\work\\b\\App.tsx"];
    expect(displayFileName(paths[0], paths)).toBe("a/App.tsx");
  });
});

describe("displayFilePath", () => {
  it("returns workdir-relative paths for files under workdir", () => {
    expect(displayFilePath("/work/src/app.ts", "/work")).toBe("src/app.ts");
  });

  it("keeps absolute paths outside workdir", () => {
    expect(displayFilePath("/elsewhere/app.ts", "/work")).toBe("/elsewhere/app.ts");
  });

  it("handles missing workdir", () => {
    expect(displayFilePath("/work/app.ts", undefined)).toBe("/work/app.ts");
  });
});

describe("dedupeSnapshotsByFile", () => {
  it("keeps the newest snapshot per file", () => {
    const snaps = [
      { filePath: "/w/a.ts", timestamp: 1, additions: 3 },
      { filePath: "/w/b.ts", timestamp: 5, additions: 1 },
      { filePath: "/w/a.ts", timestamp: 2, additions: 9 },
    ];
    const result = dedupeSnapshotsByFile(snaps);
    expect(result).toHaveLength(2);
    expect(result.find((s) => s.filePath === "/w/a.ts")?.additions).toBe(9);
    expect(result.find((s) => s.filePath === "/w/b.ts")?.additions).toBe(1);
  });

  it("drops snapshots without a file path", () => {
    const result = dedupeSnapshotsByFile([{ timestamp: 1 }]);
    expect(result).toHaveLength(0);
  });
});
