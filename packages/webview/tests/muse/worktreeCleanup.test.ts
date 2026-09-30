import { describe, expect, it } from "vitest";
import {
  pendingIssueWorktreeRemovals,
  worktreeRemovalForSession,
} from "../../src/muse/worktreeCleanup";

describe("worktreeRemovalForSession", () => {
  it("returns null when worktree metadata is incomplete", () => {
    expect(
      worktreeRemovalForSession({
        workdir: "/Users/me/.muse-work/worktrees/a",
        worktreeName: "a",
      }),
    ).toBeNull();
  });

  it("returns path/branch/repoRoot for an isolated worktree session", () => {
    expect(
      worktreeRemovalForSession({
        workdir: "/Users/me/.muse-work/worktrees/a",
        worktreeName: "a",
        worktreeBranch: "worktree-a",
        worktreeRepoRoot: "/repo",
      }),
    ).toEqual({
      path: "/Users/me/.muse-work/worktrees/a",
      branch: "worktree-a",
      repoRoot: "/repo",
    });
  });
});

describe("pendingIssueWorktreeRemovals", () => {
  it("dedupes planning+execution sessions that share one worktree", () => {
    const session = {
      workdir: "/Users/me/.muse-work/worktrees/a",
      worktreeName: "a",
      worktreeBranch: "worktree-a",
      worktreeRepoRoot: "/repo",
    };
    expect(
      pendingIssueWorktreeRemovals([
        {
          issueId: "issue-1",
          sessions: [session, { ...session }],
        },
      ]),
    ).toEqual([
      {
        issueId: "issue-1",
        path: "/Users/me/.muse-work/worktrees/a",
        branch: "worktree-a",
        repoRoot: "/repo",
      },
    ]);
  });
});
