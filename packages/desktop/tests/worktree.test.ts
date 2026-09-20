import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorktree, removeWorktree } from "../src/main/worktree.js";

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wt-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("createWorktree / removeWorktree", () => {
  const repos: string[] = [];
  afterEach(() => {
    for (const dir of repos.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates a worktree under .wave/worktrees and a worktree-* branch", async () => {
    const repo = initRepo();
    repos.push(repo);
    const session = await createWorktree("gentle-pike-147", repo, {
      baseBranch: "main",
    });
    expect(session.isNew).toBe(true);
    expect(fs.realpathSync(session.path)).toBe(
      fs.realpathSync(
        path.join(repo, ".wave", "worktrees", "gentle-pike-147"),
      ),
    );
    expect(session.branch).toBe("worktree-gentle-pike-147");
    expect(fs.existsSync(session.path)).toBe(true);
    expect(
      execFileSync("git", ["-C", session.path, "rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    ).toBe("worktree-gentle-pike-147");

    await removeWorktree(session);
    expect(fs.existsSync(session.path)).toBe(false);
  });

  it("starts the new worktree from the selected base branch, not HEAD", async () => {
    const repo = initRepo();
    repos.push(repo);
    fs.writeFileSync(path.join(repo, "README.md"), "on-main\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "main-tip"], { cwd: repo });
    const mainSha = execFileSync("git", ["rev-parse", "main"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();

    execFileSync("git", ["checkout", "-b", "test"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "README.md"), "on-test\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "test-tip"], { cwd: repo });
    const testSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    expect(testSha).not.toBe(mainSha);

    const session = await createWorktree("from-main", repo, {
      baseBranch: "main",
    });
    expect(session.baseBranch).toBe("main");
    const worktreeSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: session.path,
      encoding: "utf8",
    }).trim();
    expect(worktreeSha).toBe(mainSha);
    expect(fs.readFileSync(path.join(session.path, "README.md"), "utf8")).toBe(
      "on-main\n",
    );
  });

  it("does not silently start from HEAD when the selected base branch is missing", async () => {
    const repo = initRepo();
    repos.push(repo);
    execFileSync("git", ["checkout", "-b", "test"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "README.md"), "on-test\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "test-tip"], { cwd: repo });

    await expect(
      createWorktree("from-missing", repo, { baseBranch: "does-not-exist" }),
    ).rejects.toThrow(/does-not-exist|not a valid object|unknown revision/i);
  });
});
