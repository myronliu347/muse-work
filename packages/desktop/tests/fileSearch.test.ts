import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listWorkspaceDir,
  searchWorkspaceFiles,
} from "../src/main/fileSearch.js";

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

describe("listWorkspaceDir", () => {
  it("returns only direct children, dirs first, and skips node_modules/.git", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ls-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(path.join(root, "src", "nested"));
    fs.writeFileSync(path.join(root, "README.md"), "");
    fs.writeFileSync(path.join(root, "src", "hello.ts"), "");
    fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(root, ".git"));

    const rootHits = listWorkspaceDir(root, "");
    expect(rootHits.map((h) => h.name)).toEqual(["src", "README.md"]);
    expect(rootHits[0]).toMatchObject({
      name: "src",
      relativePath: "src/",
      isDirectory: true,
      icon: "codicon-folder",
    });
    expect(rootHits[1]).toMatchObject({
      name: "README.md",
      relativePath: "README.md",
      isDirectory: false,
    });

    const srcHits = listWorkspaceDir(root, "src/");
    expect(srcHits.map((h) => h.relativePath)).toEqual(["src/nested/", "src/hello.ts"]);
    expect(srcHits.some((h) => h.name === "README.md")).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns empty for missing workdir, missing dir, or path traversal", () => {
    expect(listWorkspaceDir("/tmp/muse-does-not-exist-xyz", "")).toEqual([]);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ls-miss-"));
    fs.mkdirSync(path.join(root, "src"));
    expect(listWorkspaceDir(root, "nope")).toEqual([]);
    expect(listWorkspaceDir(root, "../outside")).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("hides gitignored files when respectGitignore is true", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ls-"));
    fs.writeFileSync(path.join(root, ".gitignore"), "secret.txt\n");
    fs.writeFileSync(path.join(root, "secret.txt"), "x");
    fs.writeFileSync(path.join(root, "ok.ts"), "x");
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "node_modules", "x"), "x");
    const hits = listWorkspaceDir(root, "", { respectGitignore: true });
    const names = hits.map((h) => h.name);
    expect(names).toContain("ok.ts");
    expect(names).not.toContain("secret.txt");
    expect(names).not.toContain("node_modules");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("searchWorkspaceFiles directories", () => {
  it("includes matching directories in results", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-fs-dir-"));
    fs.mkdirSync(path.join(root, "components"));
    fs.writeFileSync(path.join(root, "components", "a.ts"), "");

    const hits = searchWorkspaceFiles(root, { query: "comp" });
    expect(hits.some((h) => h.relativePath === "components/" && h.isDirectory)).toBe(
      true,
    );

    fs.rmSync(root, { recursive: true, force: true });
  });
});
