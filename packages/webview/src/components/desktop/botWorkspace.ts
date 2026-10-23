import type { DesktopIssueGroup } from "../../types";
import { resolveIssuePlanningSessionId } from "../../utils/issueGroups";

export type PanelSelection =
  | { kind: "issue"; issueId: string }
  | { kind: "queue"; id: string }
  | { kind: "none" };

export type DockChrome = "detail" | "file" | "terminal" | "preview" | "diff";

export interface BotWorkspaceState {
  active: "bot" | string;
  openIssueIds: string[];
  panel: PanelSelection;
  dock: DockChrome;
  lastIssueId: string | null;
}

export function initialBotWorkspace(firstIssueId: string | null): BotWorkspaceState {
  return {
    active: "bot",
    openIssueIds: [],
    panel: firstIssueId ? { kind: "issue", issueId: firstIssueId } : { kind: "none" },
    dock: "detail",
    lastIssueId: firstIssueId,
  };
}

export function selectPanel(
  state: BotWorkspaceState,
  panel: Exclude<PanelSelection, { kind: "none" }>,
): BotWorkspaceState {
  // 已经在某条 Issue 会话里时，点开着的卡片要切到对应标签。
  // 在 Muse Bot 主页上只改右侧详情，不把主页换成会话。
  const followTab =
    state.active !== "bot" &&
    panel.kind === "issue" &&
    state.openIssueIds.includes(panel.issueId);
  return {
    ...state,
    active: followTab ? panel.issueId : state.active,
    panel,
    dock: "detail",
    lastIssueId: panel.kind === "issue" ? panel.issueId : state.lastIssueId,
  };
}

export function openIssueSession(state: BotWorkspaceState, issueId: string): BotWorkspaceState {
  return {
    ...state,
    active: issueId,
    openIssueIds: state.openIssueIds.includes(issueId)
      ? state.openIssueIds
      : [...state.openIssueIds, issueId],
  };
}

export function focusTab(state: BotWorkspaceState, tab: "bot" | string): BotWorkspaceState {
  if (tab !== "bot" && !state.openIssueIds.includes(tab)) return state;
  if (tab === "bot") return { ...state, active: tab };
  return {
    ...state,
    active: tab,
    panel: { kind: "issue", issueId: tab },
    lastIssueId: tab,
  };
}

export function closeIssueTab(state: BotWorkspaceState, issueId: string): BotWorkspaceState {
  const openIssueIds = state.openIssueIds.filter((id) => id !== issueId);
  return {
    ...state,
    openIssueIds,
    active: state.active === issueId ? "bot" : state.active,
  };
}

export function selectDock(state: BotWorkspaceState, dock: DockChrome): BotWorkspaceState {
  return { ...state, dock };
}

/** 执行会话优先；否则用规划会话。两个都没有时打不开这条 Issue。 */
export function issueTabSessionId(group: DesktopIssueGroup): string | undefined {
  if (group.executionSessionId) return group.executionSessionId;
  return resolveIssuePlanningSessionId(group);
}

export function sessionActionLabel(
  state: BotWorkspaceState,
  issueId: string,
): "打开会话" | "切到会话" | null {
  if (!state.openIssueIds.includes(issueId)) return "打开会话";
  if (state.active === issueId) return null;
  return "切到会话";
}
