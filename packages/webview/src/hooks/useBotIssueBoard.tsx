import { useCallback, useEffect, useRef, useState } from "react";
import { readBotQueue, type BotListQueueItem } from "../components/desktop/BotLists";
import type { BotWorkspaceContextValue } from "../components/desktop/BotTabs";
import {
  issueTabSessionId,
  sessionActionLabel,
  type PanelSelection,
} from "../components/desktop/botWorkspace";
import { issueGroupActivity } from "../components/session/SessionStatusGlyph";
import type { MuseApiClient } from "../muse/apiClient";
import type { ChatState, DesktopHostProps } from "../types";

/** Muse Bot queue, issue rows, and which issue column is on screen. */
export function useBotIssueBoard({
  assistantVisible,
  museApi,
  host,
  workspace,
  state,
}: {
  assistantVisible: boolean;
  museApi: MuseApiClient;
  host: DesktopHostProps | undefined;
  workspace: BotWorkspaceContextValue;
  state: ChatState;
}) {
  const [botSwitchHost, setBotSwitchHost] = useState<HTMLDivElement | null>(null);
  const [botMenu, setBotMenu] = useState<"queue" | "todo" | null>(null);
  const [botQueue, setBotQueue] = useState<BotListQueueItem[]>([]);
  useEffect(() => {
    if (!assistantVisible) return;
    let cancelled = false;
    let sawPush = false;
    const apply = (items: unknown) => {
      if (!cancelled && Array.isArray(items)) setBotQueue(readBotQueue(items));
    };
    void museApi
      .listAssistantQueue()
      .then((page) => {
        if (sawPush) return;
        apply(page.items);
      })
      .catch(() => undefined);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { command?: string; items?: unknown };
      if (data?.command !== "assistant:queue") return;
      sawPush = true;
      apply(data.items);
    };
    window.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
    };
  }, [assistantVisible, museApi]);
  const issueActivityById = new Map(
    (host?.issueGroups ?? []).map((group) => [
      group.issueId,
      issueGroupActivity(group, {
        currentSessionId: state.currentSession?.id,
        isStreaming: state.isStreaming,
      }),
    ]),
  );
  const botIssues = (host?.issueGroups ?? []).map((group) => {
    const activity = issueActivityById.get(group.issueId);
    const presence = activity?.presence ?? null;
    return {
      issueId: group.issueId,
      title: group.title,
      priority: group.priority,
      type: group.type,
      presence:
        presence === "unread" && !workspace.openIssueIds.includes(group.issueId)
          ? null
          : presence,
      statusLabel: activity?.label,
      openLabel: issueTabSessionId(group)
        ? sessionActionLabel(workspace, group.issueId)
        : null,
    };
  });
  const issueTabPresence: Record<string, ReturnType<typeof issueGroupActivity>["presence"]> = {};
  for (const [issueId, activity] of issueActivityById) {
    issueTabPresence[issueId] = activity.presence;
  }
  const clearIssueUnreadRef = useRef<(issueId: string) => void>(() => {});
  useEffect(() => {
    if (host?.type !== "desktop") return;
    const closed = new Set(
      (host.closedIssueGroups ?? []).map((group) => group.issueId),
    );
    if (closed.size === 0) return;
    const bound = new Set(workspace.openIssueIds);
    if (workspace.panel.kind === "issue") bound.add(workspace.panel.issueId);
    if (workspace.lastIssueId) bound.add(workspace.lastIssueId);
    for (const issueId of bound) {
      if (closed.has(issueId)) workspace.closeIssueTab(issueId);
    }
  }, [host?.type, host?.closedIssueGroups, workspace]);
  const selectBotPanel = useCallback(
    (panel: Exclude<PanelSelection, { kind: "none" }>) => {
      workspace.selectPanel(panel);
      setBotMenu(null);
      if (panel.kind === "issue") clearIssueUnreadRef.current(panel.issueId);
    },
    [workspace],
  );
  const [threeColumnsOn, setThreeColumnsOn] = useState(false);
  // Pixel width of the Muse Bot column. Null until the user drags the split.
  // The column is a fixed grid track, so a window resize changes the issue column.
  const [splitLeftWidth, setSplitLeftWidth] = useState<number | null>(null);
  useEffect(() => {
    if (workspace.openIssueIds.length === 0) setThreeColumnsOn(false);
  }, [workspace.openIssueIds.length]);
  const openIssueGroup =
    workspace.active === "bot"
      ? undefined
      : (host?.issueGroups ?? []).find((group) => group.issueId === workspace.active);
  const splitIssueId = !threeColumnsOn
    ? null
    : workspace.active !== "bot" && workspace.openIssueIds.includes(workspace.active)
      ? workspace.active
      : workspace.lastIssueId && workspace.openIssueIds.includes(workspace.lastIssueId)
        ? workspace.lastIssueId
        : (workspace.openIssueIds[workspace.openIssueIds.length - 1] ?? null);
  const splitIssueGroup = splitIssueId
    ? (host?.issueGroups ?? []).find((group) => group.issueId === splitIssueId)
    : undefined;
  const threeColumns = Boolean(splitIssueGroup);
  // 两栏时主栏只显示当前标签。三栏时中间固定是一条事项会话，即使焦点在 Muse Bot。
  const shownIssueGroup = threeColumns ? splitIssueGroup : openIssueGroup;
  // 分栏时中间会话和右侧当前事项可能不是同一条。输入框聚焦后，把当前事项切回这条会话。
  const focusShownIssueFromSender = useCallback(() => {
    if (!threeColumns || !shownIssueGroup) return;
    const issueId = shownIssueGroup.issueId;
    const panel = workspace.panel;
    if (
      workspace.active === issueId &&
      panel.kind === "issue" &&
      panel.issueId === issueId
    ) {
      return;
    }
    workspace.focusTab(issueId);
    clearIssueUnreadRef.current(issueId);
  }, [threeColumns, shownIssueGroup, workspace]);

  return {
    botSwitchHost,
    setBotSwitchHost,
    botMenu,
    setBotMenu,
    botQueue,
    botIssues,
    issueTabPresence,
    clearIssueUnreadRef,
    selectBotPanel,
    setThreeColumnsOn,
    splitLeftWidth,
    setSplitLeftWidth,
    threeColumns,
    shownIssueGroup,
    focusShownIssueFromSender,
  };
}

export type BotIssueBoard = ReturnType<typeof useBotIssueBoard>;
