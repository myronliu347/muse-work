/** Git worktree fields needed to ask Electron to delete the dir + branch. */
export type WorktreeRemoval = {
  path: string;
  branch: string;
  repoRoot: string;
};

type WorktreeSessionLike = {
  workdir?: string;
  worktreeName?: string;
  worktreeBranch?: string;
  worktreeRepoRoot?: string;
};

type IssueGroupLike = {
  issueId: string;
  sessions?: WorktreeSessionLike[];
};

export function worktreeRemovalForSession(
  session: WorktreeSessionLike,
): WorktreeRemoval | null {
  const path = session.workdir?.trim() ?? "";
  const branch = session.worktreeBranch?.trim() ?? "";
  const repoRoot = session.worktreeRepoRoot?.trim() ?? "";
  if (!session.worktreeName || !path || !branch || !repoRoot) return null;
  return { path, branch, repoRoot };
}

/** Deduped worktree dirs on still-active issue groups, keyed for close detection. */
export function pendingIssueWorktreeRemovals(
  groups: IssueGroupLike[],
): Array<WorktreeRemoval & { issueId: string }> {
  const seen = new Set<string>();
  const out: Array<WorktreeRemoval & { issueId: string }> = [];
  for (const group of groups) {
    for (const session of group.sessions ?? []) {
      const removal = worktreeRemovalForSession(session);
      if (!removal) continue;
      const key = `${group.issueId}\0${removal.path}\0${removal.branch}\0${removal.repoRoot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ issueId: group.issueId, ...removal });
    }
  }
  return out;
}
