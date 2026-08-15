import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listWorkspaceDir,
  searchContentInWorkspace,
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

  it("does not inherit gitignore from outside the git repo", () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ls-outer-"));
    const root = path.join(outer, "proj");
    fs.mkdirSync(root);
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(outer, ".gitignore"), "*\n");
    fs.writeFileSync(path.join(root, "ok.ts"), "x");
    const hits = listWorkspaceDir(root, "", { respectGitignore: true });
    expect(hits.map((h) => h.name)).toContain("ok.ts");
    fs.rmSync(outer, { recursive: true, force: true });
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

describe("searchContentInWorkspace", () => {
  it("finds case-sensitive and insensitive matches", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-"));
    fs.writeFileSync(path.join(root, "a.ts"), "Foo\nfoo\n");
    const insensitive = searchContentInWorkspace(root, {
      query: "Foo",
      caseSensitive: false,
    });
    expect(insensitive.totalMatches).toBe(2);
    const sensitive = searchContentInWorkspace(root, {
      query: "Foo",
      caseSensitive: true,
    });
    expect(sensitive.totalMatches).toBe(1);
    expect(sensitive.results[0].matches[0].line).toBe(1);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("supports wholeWord and regex", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-"));
    fs.writeFileSync(path.join(root, "a.ts"), "foo foobar\n");
    const whole = searchContentInWorkspace(root, {
      query: "foo",
      wholeWord: true,
    });
    expect(whole.totalMatches).toBe(1);
    expect(whole.results[0].matches[0].startCol).toBe(0);
    const re = searchContentInWorkspace(root, {
      query: "foo+",
      regex: true,
    });
    expect(re.totalMatches).toBeGreaterThanOrEqual(1);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns error for invalid regex without throwing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-"));
    fs.writeFileSync(path.join(root, "a.ts"), "x\n");
    const out = searchContentInWorkspace(root, {
      query: "(",
      regex: true,
    });
    expect(out.error).toBeTruthy();
    expect(out.results).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("respects gitignore and skips binary / oversize", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-"));
    fs.writeFileSync(path.join(root, ".gitignore"), "secret.ts\n");
    fs.writeFileSync(path.join(root, "secret.ts"), "needle\n");
    fs.writeFileSync(path.join(root, "ok.ts"), "needle\n");
    fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([0, 1, 2, 3]));
    const out = searchContentInWorkspace(root, { query: "needle" });
    expect(out.results.map((r) => r.relativePath)).toEqual(["ok.ts"]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sets truncated when maxMatches exceeded", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-"));
    fs.writeFileSync(path.join(root, "a.ts"), "x\nx\nx\n");
    const out = searchContentInWorkspace(root, {
      query: "x",
      maxMatches: 2,
    });
    expect(out.truncated).toBe(true);
    expect(out.totalMatches).toBe(2);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("searchWorkspaceFiles gitignore + filesOnly", () => {
  it("hides gitignored files when respectGitignore is true", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sf-"));
    fs.writeFileSync(path.join(root, ".gitignore"), "hidden.ts\n");
    fs.writeFileSync(path.join(root, "hidden.ts"), "");
    fs.writeFileSync(path.join(root, "visible.ts"), "");
    const hits = searchWorkspaceFiles(root, {
      query: "ts",
      respectGitignore: true,
      filesOnly: true,
    });
    expect(hits.map((h) => h.name).sort()).toEqual(["visible.ts"]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
