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
  /** Per center-tab chrome: Muse Bot and each issue remember their own dock. */
  docks: Record<string, DockChrome>;
  lastIssueId: string | null;
}

function withDockForTab(
  state: BotWorkspaceState,
  nextActive: string,
): Pick<BotWorkspaceState, "dock" | "docks"> {
  const docks = { ...state.docks, [state.active]: state.dock };
  const dock = docks[nextActive] ?? "detail";
  docks[nextActive] = dock;
  return { docks, dock };
}

export function initialBotWorkspace(firstIssueId: string | null): BotWorkspaceState {
  return {
    active: "bot",
    openIssueIds: [],
    panel: firstIssueId ? { kind: "issue", issueId: firstIssueId } : { kind: "none" },
    dock: "detail",
    docks: {},
    lastIssueId: firstIssueId,
  };
}

export function selectPanel(
  state: BotWorkspaceState,
  panel: Exclude<PanelSelection, { kind: "none" }>,
  opts?: { followTab?: boolean },
): BotWorkspaceState {
  // 已经在某条 Issue 会话里时，点开着的卡片要切到对应标签。
  // 在 Muse Bot 主页上只改右侧详情，不把主页换成会话。
  // 已结束的 Issue 只读详情，不切中心会话。
  const followTab =
    opts?.followTab !== false &&
    state.active !== "bot" &&
    panel.kind === "issue" &&
    state.openIssueIds.includes(panel.issueId);
  const active = followTab ? panel.issueId : state.active;
  const lastIssueId = panel.kind === "issue" ? panel.issueId : state.lastIssueId;
  const samePanel =
    state.panel.kind === panel.kind &&
    ((state.panel.kind === "issue" &&
      panel.kind === "issue" &&
      state.panel.issueId === panel.issueId) ||
      (state.panel.kind === "queue" &&
        panel.kind === "queue" &&
        state.panel.id === panel.id));
  if (samePanel && state.active === active && state.lastIssueId === lastIssueId) {
    return state;
  }
  // 选中哪条 Issue 只决定右侧看什么，不决定右侧停在哪个标签。详情、变更、
  // 文件都跟着新事项换内容；用户正在看的那个标签保持不变。切到另一条已
  // 打开的 Issue 标签时，这条标签也记住当前标签，之后点标签回来不会再被
  // 拉回详情。待处理条目没有对应的变更 / 文件，仍把详情带到前面。
  const dock = panel.kind === "issue" ? state.dock : "detail";
  const docks = { ...state.docks, [state.active]: state.dock };
  docks[active] = dock;
  return {
    ...state,
    active,
    panel,
    dock,
    lastIssueId,
    docks,
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
  if (tab === "bot") {
    if (state.active === "bot") return state;
    return { ...state, active: tab, ...withDockForTab(state, tab) };
  }
  if (
    state.active === tab &&
    state.panel.kind === "issue" &&
    state.panel.issueId === tab &&
    state.lastIssueId === tab
  ) {
    return state;
  }
  return {
    ...state,
    active: tab,
    panel: { kind: "issue", issueId: tab },
    lastIssueId: tab,
    ...withDockForTab(state, tab),
  };
}

export function closeIssueTab(state: BotWorkspaceState, issueId: string): BotWorkspaceState {
  const hadTab = state.openIssueIds.includes(issueId);
  const panelWasThis =
    state.panel.kind === "issue" && state.panel.issueId === issueId;
  const lastWasThis = state.lastIssueId === issueId;
  const activeWasThis = state.active === issueId;
  if (!hadTab && !panelWasThis && !lastWasThis && !activeWasThis) return state;
  // 关标签只回收中间栏和详情绑定。右侧停在哪个标签是用户的阅读状态，
  // 不因为少了一条 Issue 就跳回详情；文件、终端、浏览器、详情都可以留着。
  // 只有 变更 在关掉后连一个可看的事项都没有时才退回详情。
  const docks = { ...state.docks };
  delete docks[issueId];
  const active = activeWasThis ? "bot" : state.active;
  const keptPanelIssue =
    !panelWasThis && state.panel.kind === "issue" ? state.panel.issueId : undefined;
  const keptLastIssue = lastWasThis ? undefined : state.lastIssueId ?? undefined;
  const issueLeft = Boolean(keptPanelIssue || keptLastIssue);
  const dock = state.dock === "diff" && !issueLeft ? "detail" : state.dock;
  docks[active] = dock;
  return {
    ...state,
    openIssueIds: hadTab
      ? state.openIssueIds.filter((id) => id !== issueId)
      : state.openIssueIds,
    active,
    panel: panelWasThis ? { kind: "none" } : state.panel,
    lastIssueId: lastWasThis ? null : state.lastIssueId,
    dock,
    docks,
  };
}

export function selectDock(state: BotWorkspaceState, dock: DockChrome): BotWorkspaceState {
  if (state.dock === dock && state.docks[state.active] === dock) return state;
  return {
    ...state,
    dock,
    docks: { ...state.docks, [state.active]: dock },
  };
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
