import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getMuseHomeDir } from "@muse-work/provider";
import { createServerWorktree } from "../src/services/gitWorktree.js";

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-server-wt-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("createServerWorktree", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates the worktree on this machine without a desktop client", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-server-home-"));
    const repo = initRepo();
    dirs.push(home, repo);
    const created = await createServerWorktree({
      home,
      workdir: repo,
      baseBranch: "main",
      name: "gentle-pike-147",
    });
    expect(fs.realpathSync(created.path)).toBe(
      fs.realpathSync(path.join(getMuseHomeDir(home), "worktrees", "gentle-pike-147")),
    );
    expect(created.branch).toBe("worktree-gentle-pike-147");
    expect(fs.realpathSync(created.repoRoot)).toBe(fs.realpathSync(repo));
    expect(fs.existsSync(path.join(created.path, "README.md"))).toBe(true);
    expect(
      execFileSync("git", ["-C", created.path, "rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    ).toBe("worktree-gentle-pike-147");
  });
});
