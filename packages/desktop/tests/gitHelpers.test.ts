import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listGitBranches } from "../src/main/gitBranches.js";
import {
  getBranchDiff,
  getWorkspaceDiff,
  revertWorkspaceDiff,
} from "../src/main/gitDiff.js";

function initRepo(dir: string): void {
  execFileSync("git", ["-c", "init.templateDir=", "init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
  execFileSync("git", ["add", "a.txt"], { cwd: dir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "init"], {
    cwd: dir,
  });
}

describe("listGitBranches", () => {
  it("returns branches for a git repo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-br-"));
    initRepo(dir);
    const result = await listGitBranches(dir);
    expect(result).not.toBeNull();
    expect(result!.branches.length).toBeGreaterThan(0);
    expect(result!.current).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for non-repo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-nbr-"));
    expect(await listGitBranches(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("getWorkspaceDiff", () => {
  it("reports modified files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-diff-"));
    initRepo(dir);
    fs.writeFileSync(path.join(dir, "a.txt"), "hello\nworld\n");
    const result = await getWorkspaceDiff(dir);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.files.some((f) => f.path === "a.txt")).toBe(true);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("getBranchDiff", () => {
  it("includes commits on the branch plus uncommitted and untracked files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-brdiff-"));
    initRepo(dir);
    execFileSync("git", ["branch", "-M", "main"], { cwd: dir });
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "a.txt"), "hello\nworld\n");
    execFileSync("git", ["add", "a.txt"], { cwd: dir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "second"], {
      cwd: dir,
    });
    fs.writeFileSync(path.join(dir, "a.txt"), "hello\nworld\nextra\n");
    fs.writeFileSync(path.join(dir, "b.txt"), "new\n");

    const result = await getBranchDiff(dir);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      const byPath = Object.fromEntries(result.files.map((f) => [f.path, f]));
      expect(byPath["a.txt"]?.hunks).toContain("+world");
      expect(byPath["a.txt"]?.hunks).toContain("+extra");
      expect(byPath["b.txt"]?.status).toBe("untracked");
      expect(byPath["b.txt"]?.hunks).toContain("+new");
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns not-a-repo outside a work tree", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-brdiff-nr-"));
    expect(await getBranchDiff(dir)).toEqual({ kind: "not-a-repo" });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("revertWorkspaceDiff", () => {
  it("restores a modified tracked file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-"));
    initRepo(dir);
    fs.writeFileSync(path.join(dir, "a.txt"), "hello\nworld\n");
    const result = await revertWorkspaceDiff(dir, ["a.txt"]);
    expect(result).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("hello\n");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deletes an untracked file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-u-"));
    initRepo(dir);
    fs.writeFileSync(path.join(dir, "new.txt"), "x\n");
    const result = await revertWorkspaceDiff(dir, ["new.txt"]);
    expect(result).toEqual({ ok: true });
    expect(fs.existsSync(path.join(dir, "new.txt"))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reverts only the requested path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-1-"));
    initRepo(dir);
    fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
    fs.writeFileSync(path.join(dir, "b.txt"), "only-b\n");
    await revertWorkspaceDiff(dir, ["a.txt"]);
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("hello\n");
    expect(fs.existsSync(path.join(dir, "b.txt"))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects path traversal", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-x-"));
    initRepo(dir);
    const result = await revertWorkspaceDiff(dir, ["../outside.txt"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns error for non-repo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-nr-"));
    const result = await revertWorkspaceDiff(dir);
    expect(result).toEqual({ ok: false, error: "非 git 仓库" });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("no-ops ok when path set intersects nothing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-empty-"));
    initRepo(dir);
    const result = await revertWorkspaceDiff(dir, ["missing.txt"]);
    expect(result).toEqual({ ok: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("empty paths array is a no-op and does not revert all", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-empty-arr-"));
    initRepo(dir);
    fs.writeFileSync(path.join(dir, "a.txt"), "dirty\n");
    const result = await revertWorkspaceDiff(dir, []);
    expect(result).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("dirty\n");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns error when git status fails", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-status-"));
    initRepo(dir);
    const indexPath = path.join(dir, ".git", "index");
    fs.chmodSync(indexPath, 0o000);
    try {
      const result = await revertWorkspaceDiff(dir, ["a.txt"]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    } finally {
      fs.chmodSync(indexPath, 0o644);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
