import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { searchWorkspaceFiles } from "../src/main/fileSearch.js";

describe("searchWorkspaceFiles", () => {
  it("finds files by name substring and skips node_modules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-fs-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "sessionRunner.ts"), "");
    fs.writeFileSync(path.join(root, "README.md"), "");
    fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", "pkg", "sessionRunner.ts"), "");

    const hits = searchWorkspaceFiles(root, { query: "session" });
    expect(hits.some((h) => h.relativePath.includes("sessionRunner.ts"))).toBe(
      true,
    );
    expect(hits.every((h) => !h.relativePath.includes("node_modules"))).toBe(
      true,
    );

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns empty when workdir missing", () => {
    expect(
      searchWorkspaceFiles("/tmp/muse-does-not-exist-xyz", { query: "a" }),
    ).toEqual([]);
  });
});
