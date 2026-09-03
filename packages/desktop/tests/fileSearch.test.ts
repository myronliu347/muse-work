import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findFilesByPathQuery,
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

  it("hides the .wave/worktrees dir even when not gitignored", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ls-wt-"));
    fs.mkdirSync(path.join(root, ".wave", "worktrees", "feature-x"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, ".wave", "worktrees", "feature-x", "dup.ts"),
      "",
    );
    fs.writeFileSync(path.join(root, ".wave", "settings.local.json"), "{}");
    fs.writeFileSync(path.join(root, "ok.ts"), "");

    const rootHits = listWorkspaceDir(root, "", { respectGitignore: true });
    expect(rootHits.map((h) => h.name)).toContain(".wave");
    expect(rootHits.map((h) => h.name)).toContain("ok.ts");

    const waveHits = listWorkspaceDir(root, ".wave", {
      respectGitignore: true,
    });
    expect(waveHits.map((h) => h.name)).toEqual(["settings.local.json"]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("hides linked worktree roots anywhere, keeps main repos and submodules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ls-arb-"));
    // Linked worktree anywhere (not under .wave): `.git` is a file pointing
    // into `<repo>/.git/worktrees/<name>`.
    const wt = path.join(root, "wt", "feature-x");
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(
      path.join(wt, ".git"),
      `gitdir: ${root}/repo/.git/worktrees/feature-x\n`,
    );
    fs.writeFileSync(path.join(wt, "dup.ts"), "");
    // Main repo: `.git` is a directory — must NOT be hidden.
    fs.mkdirSync(path.join(root, "repo", ".git"), { recursive: true });
    fs.writeFileSync(path.join(root, "repo", "main.ts"), "");
    // Submodule: `.git` file pointing at `.git/modules/…` — must NOT be hidden.
    const sub = path.join(root, "lib");
    fs.mkdirSync(sub);
    fs.writeFileSync(
      path.join(sub, ".git"),
      `gitdir: ${root}/repo/.git/modules/lib\n`,
    );
    fs.writeFileSync(path.join(sub, "lib.ts"), "");

    // At root only `wt` (parent of the worktree) shows; `repo` and `lib` stay.
    const rootHits = listWorkspaceDir(root, "", { respectGitignore: true });
    expect(rootHits.map((h) => h.name).sort()).toEqual(["lib", "repo", "wt"]);

    // Inside `wt`, the worktree root itself is hidden.
    const wtHits = listWorkspaceDir(root, "wt", { respectGitignore: true });
    expect(wtHits.map((h) => h.name)).toEqual([]);

    // `repo` and `lib` are ordinary dirs and list normally.
    expect(
      listWorkspaceDir(root, "repo", { respectGitignore: true }).map(
        (h) => h.name,
      ),
    ).toEqual(["main.ts"]);
    expect(
      listWorkspaceDir(root, "lib", { respectGitignore: true }).map(
        (h) => h.name,
      ),
    ).toEqual(["lib.ts"]);
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

  it("does not scan files under .wave/worktrees", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-wt-"));
    fs.mkdirSync(path.join(root, ".wave", "worktrees", "feature-x"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, ".wave", "worktrees", "feature-x", "dup.ts"),
      "needle\n",
    );
    fs.writeFileSync(path.join(root, "dup.ts"), "needle\n");
    const out = searchContentInWorkspace(root, { query: "needle" });
    expect(out.results.map((r) => r.relativePath)).toEqual(["dup.ts"]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("does not scan files under a worktree living outside .wave", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-arb-"));
    const wt = path.join(root, "wt", "feature-x");
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(
      path.join(wt, ".git"),
      `gitdir: ${root}/repo/.git/worktrees/feature-x\n`,
    );
    fs.writeFileSync(path.join(wt, "dup.ts"), "needle\n");
    fs.writeFileSync(path.join(root, "dup.ts"), "needle\n");
    const out = searchContentInWorkspace(root, { query: "needle" });
    expect(out.results.map((r) => r.relativePath)).toEqual(["dup.ts"]);
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

  it("does not return hits under .wave/worktrees", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sf-wt-"));
    fs.mkdirSync(path.join(root, ".wave", "worktrees", "feature-x"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, ".wave", "worktrees", "feature-x", "dup.ts"),
      "",
    );
    fs.writeFileSync(path.join(root, "dup.ts"), "");

    const hits = searchWorkspaceFiles(root, {
      query: "dup",
      respectGitignore: true,
    });
    expect(hits.map((h) => h.relativePath)).toEqual(["dup.ts"]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("does not return hits under a worktree living outside .wave", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sf-arb-"));
    const wt = path.join(root, "wt", "feature-x");
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(
      path.join(wt, ".git"),
      `gitdir: ${root}/repo/.git/worktrees/feature-x\n`,
    );
    fs.writeFileSync(path.join(wt, "dup.ts"), "");
    fs.writeFileSync(path.join(root, "dup.ts"), "");

    const hits = searchWorkspaceFiles(root, {
      query: "dup",
      respectGitignore: true,
    });
    expect(hits.map((h) => h.relativePath)).toEqual(["dup.ts"]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("findFilesByPathQuery", () => {
  it("matches a unique basename and a path substring", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-pq-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "src", "hello.ts"), "");
    fs.writeFileSync(path.join(root, "docs", "guide.md"), "");

    expect(
      findFilesByPathQuery(root, "hello.ts").map((h) => h.relativePath),
    ).toEqual(["src/hello.ts"]);
    expect(
      findFilesByPathQuery(root, "src/hello.ts").map((h) => h.relativePath),
    ).toEqual(["src/hello.ts"]);
    expect(findFilesByPathQuery(root, "docs/hello.ts")).toEqual([]);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns every basename hit when several files share a name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-pq-m-"));
    fs.mkdirSync(path.join(root, "a"));
    fs.mkdirSync(path.join(root, "b"));
    fs.writeFileSync(path.join(root, "a", "hello.ts"), "");
    fs.writeFileSync(path.join(root, "b", "hello.ts"), "");

    expect(
      findFilesByPathQuery(root, "hello.ts")
        .map((h) => h.relativePath)
        .sort(),
    ).toEqual(["a/hello.ts", "b/hello.ts"]);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
