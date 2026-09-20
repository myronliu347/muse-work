import { describe, expect, it } from "vitest";
import {
  pendingIssueWorktreeRemovals,
  worktreeRemovalForSession,
} from "../../src/muse/worktreeCleanup";

describe("worktreeRemovalForSession", () => {
  it("returns null when worktree metadata is incomplete", () => {
    expect(
      worktreeRemovalForSession({
        workdir: "/repo/.wave/worktrees/a",
        worktreeName: "a",
      }),
    ).toBeNull();
  });

  it("returns path/branch/repoRoot for an isolated worktree session", () => {
    expect(
      worktreeRemovalForSession({
        workdir: "/repo/.wave/worktrees/a",
        worktreeName: "a",
        worktreeBranch: "worktree-a",
        worktreeRepoRoot: "/repo",
      }),
    ).toEqual({
      path: "/repo/.wave/worktrees/a",
      branch: "worktree-a",
      repoRoot: "/repo",
    });
  });
});

describe("pendingIssueWorktreeRemovals", () => {
  it("dedupes planning+execution sessions that share one worktree", () => {
    const session = {
      workdir: "/repo/.wave/worktrees/a",
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
        path: "/repo/.wave/worktrees/a",
        branch: "worktree-a",
        repoRoot: "/repo",
      },
    ]);
  });
});
