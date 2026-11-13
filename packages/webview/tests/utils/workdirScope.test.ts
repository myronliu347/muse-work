import { describe, expect, it } from "vitest";
import {
  isPathInsideWorkdir,
  uniqueWorkdirs,
  workdirForFile,
} from "../../src/utils/workdirScope";

describe("workdirScope", () => {
  it("checks path boundaries, not string prefixes", () => {
    expect(isPathInsideWorkdir("/work/a/src/app.ts", "/work/a")).toBe(true);
    expect(isPathInsideWorkdir("/work/a", "/work/a")).toBe(true);
    expect(isPathInsideWorkdir("/work/ab/app.ts", "/work/a")).toBe(false);
  });

  it("picks the most specific known workdir for a file", () => {
    expect(
      workdirForFile("/work/radii/worktrees/x/a.ts", [
        "/work/radii",
        "/work/radii/worktrees/x/",
        "/work/other",
      ]),
    ).toBe("/work/radii/worktrees/x/");
  });

  it("returns undefined for a file outside every known dir", () => {
    expect(workdirForFile("/outside/a.ts", ["/work/radii"])).toBeUndefined();
    expect(workdirForFile(undefined, ["/work/radii"])).toBeUndefined();
  });

  it("dedupes by normalized path and keeps the first spelling", () => {
    expect(uniqueWorkdirs(["/work/a/", "/work/a", "/work/b"])).toEqual([
      "/work/a",
      "/work/b",
    ]);
  });
});
