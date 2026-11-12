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
  const openIssueGroup =
    workspace.active === "bot"
      ? undefined
      : (host?.issueGroups ?? []).find((group) => group.issueId === workspace.active);
  // One session at a time: the issue column shows the active issue, there is
  // no second bot+issue split view.
  const shownIssueGroup = openIssueGroup;

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
    shownIssueGroup,
  };
}

export type BotIssueBoard = ReturnType<typeof useBotIssueBoard>;
