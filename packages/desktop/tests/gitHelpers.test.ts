import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listGitBranches } from "../src/main/gitBranches.js";
import { getWorkspaceDiff } from "../src/main/gitDiff.js";

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
