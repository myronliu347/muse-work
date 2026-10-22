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
  return {
    ...state,
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
  return { ...state, active: tab };
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

export function sessionActionLabel(
  state: BotWorkspaceState,
  issueId: string,
): "打开会话" | "切到会话" | null {
  if (!state.openIssueIds.includes(issueId)) return "打开会话";
  if (state.active === issueId) return null;
  return "切到会话";
}
