import { useCallback, useEffect, useMemo } from "react";
import type { IssueViewTab } from "../components/issue/IssueSessionHeader";
import type { ChatAppCore } from "./useChatAppCore";
import { messagesForDockIssue, recentTurnDiffFiles } from "../utils/fileHistorySnapshots";
import {
  findIssueGroupForSession,
  issueGroupSessionWorkdir,
  resolveIssuePlanningSessionId,
} from "../utils/issueGroups";
import { issueTabSessionId } from "../components/desktop/botWorkspace";
import type { ChatState, DesktopHostProps, DesktopIssueGroup, Message } from "../types";

type Transcript =
  | { sessionId: string; status: "ready"; messages: Message[]; hasMore: boolean }
  | { sessionId: string; status: "error" }
  | null;

/** Which issue the open session belongs to, and how its planning/execution tab moves. */
export function useIssueSessionChrome({
  state,
  host,
  effectiveWorkdir,
  dockWorkdir,
  dockIssueGroup,
  assistantVisible,
  shownIssueGroup,
  openIssueSessionId,
  shownIssueMessages,
  setIssueTabChoice,
  paneIssueViewTab,
  patchPane,
}: {
  state: ChatState;
  host: DesktopHostProps | undefined;
  effectiveWorkdir: string | undefined;
  dockWorkdir: string | null | undefined;
  dockIssueGroup: DesktopIssueGroup | undefined;
  assistantVisible: boolean;
  shownIssueGroup: DesktopIssueGroup | undefined;
  openIssueSessionId: string | undefined;
  shownIssueMessages: Message[];
  /** The issue column's tab choice: the single source for 规划/执行. */
  setIssueTabChoice: (choice: { issueId: string; tab: IssueViewTab }) => void;
  paneIssueViewTab: IssueViewTab | undefined;
  patchPane: ChatAppCore["patchPane"];
}) {
  const recentDiffFiles = useMemo(
    () => recentTurnDiffFiles(state.messages, effectiveWorkdir),
    [state.messages, effectiveWorkdir],
  );
  const issueRecentDiffFiles = useMemo(() => {
    const sessionId = dockIssueGroup ? issueTabSessionId(dockIssueGroup) : undefined;
    return recentTurnDiffFiles(
      messagesForDockIssue({
        sessionId,
        liveSessionId: state.currentSession?.id,
        liveMessages: state.messages,
        shownSessionId: openIssueSessionId,
        shownMessages: shownIssueMessages,
        cached: null,
      }),
      dockWorkdir ?? undefined,
    );
  }, [
    dockIssueGroup,
    state.currentSession?.id,
    state.messages,
    openIssueSessionId,
    shownIssueMessages,
    dockWorkdir,
  ]);

  const activeIssueGroup = useMemo(() => {
    if (host?.type !== "desktop") return undefined;
    const sessionId = state.currentSession?.id;
    return (
      findIssueGroupForSession(host.issueGroups, sessionId) ??
      findIssueGroupForSession(host.closedIssueGroups, sessionId)
    );
  }, [host, state.currentSession?.id]);
  // 事项标签上的输入框跟屏幕上这条 Issue。宿主当前会话可能还停在另一条已关闭的事项上。
  const issueForComposer =
    assistantVisible && shownIssueGroup ? shownIssueGroup : activeIssueGroup;
  const issueClosed =
    issueForComposer?.status === "completed" ||
    issueForComposer?.status === "cancelled";
  const issueViewTab: IssueViewTab = paneIssueViewTab ?? "planning";

  useEffect(() => {
    if (!activeIssueGroup) return;
    const sid = state.currentSession?.id;
    if (sid === activeIssueGroup.executionSessionId) {
      patchPane({ issueViewTab: "execution" });
    } else if (sid === activeIssueGroup.planningSessionId) {
      patchPane({ issueViewTab: "planning" });
    }
  }, [
    activeIssueGroup?.issueId,
    activeIssueGroup?.executionSessionId,
    activeIssueGroup?.planningSessionId,
    state.currentSession?.id,
    patchPane,
  ]);

  const handleIssueTabChange = useCallback(
    (tab: IssueViewTab) => {
      if (!activeIssueGroup || host?.type !== "desktop") return;
      const sessionId =
        tab === "execution"
          ? activeIssueGroup.executionSessionId
          : resolveIssuePlanningSessionId(activeIssueGroup);
      if (!sessionId) return;
      patchPane({ issueViewTab: tab });
      setIssueTabChoice({ issueId: activeIssueGroup.issueId, tab });
      host.onSelectSession(
        issueGroupSessionWorkdir(
          activeIssueGroup,
          sessionId,
          effectiveWorkdir ?? host.workdir,
        ),
        sessionId,
      );
    },
    [activeIssueGroup, host, patchPane, setIssueTabChoice, effectiveWorkdir],
  );

  const handleSelectIssue = useCallback(
    (issueId: string) => {
      if (host?.type !== "desktop") return;
      const group =
        host.issueGroups?.find((g) => g.issueId === issueId) ??
        host.closedIssueGroups?.find((g) => g.issueId === issueId);
      if (!group) return;
      // Open the tab the column would show by default: the execution session
      // when the issue has one, otherwise its planning session.
      const tab: IssueViewTab = group.executionSessionId ? "execution" : "planning";
      const sessionId =
        tab === "execution"
          ? (group.executionSessionId ?? resolveIssuePlanningSessionId(group))
          : resolveIssuePlanningSessionId(group);
      if (!sessionId) return;
      patchPane({ issueViewTab: tab });
      setIssueTabChoice({ issueId, tab });
      host.onSelectSession(
        issueGroupSessionWorkdir(
          group,
          sessionId,
          effectiveWorkdir ?? host.workdir,
        ),
        sessionId,
      );
    },
    [host, patchPane, setIssueTabChoice, effectiveWorkdir],
  );

  return {
    recentDiffFiles,
    issueRecentDiffFiles,
    activeIssueGroup,
    issueClosed,
    issueViewTab,
    handleIssueTabChange,
    handleSelectIssue,
  };
}
