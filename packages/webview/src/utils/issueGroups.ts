import type { DesktopIssueGroup } from "../types";

export function findIssueGroupForSession(
  issueGroups: DesktopIssueGroup[] | undefined,
  sessionId: string | undefined,
): DesktopIssueGroup | undefined {
  if (!sessionId || !issueGroups?.length) return undefined;
  return issueGroups.find((g) =>
    g.sessions.some((s) => s.sessionId === sessionId),
  );
}

/** 规划 + 执行拆分模式（侧栏只展示 Issue，主区用 Tab 切换会话）。 */
export function isSplitIssueGroup(group: DesktopIssueGroup): boolean {
  if (group.agentMode === "single") return false;
  if (group.agentMode === "split") return true;
  return Boolean(group.executionSessionId);
}

export function issueGroupSessionWorkdir(
  group: DesktopIssueGroup,
  sessionId: string,
  fallbackWorkdir?: string,
): string {
  return (
    group.sessions.find((s) => s.sessionId === sessionId)?.workdir ??
    group.sessions[0]?.workdir ??
    fallbackWorkdir ??
    ""
  );
}

export function resolveIssuePlanningSessionId(
  group: DesktopIssueGroup,
): string | undefined {
  return group.planningSessionId ?? group.sessions[0]?.sessionId;
}
