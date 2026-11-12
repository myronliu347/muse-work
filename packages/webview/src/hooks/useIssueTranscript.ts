import { useEffect, useRef, useState } from "react";
import type { BotWorkspaceContextValue } from "../components/desktop/BotTabs";
import type { IssueViewTab } from "../components/issue/IssueSessionHeader";
import type { DesktopHostProps, DesktopIssueGroup, Message } from "../types";
import { resolveIssuePlanningSessionId, issueGroupSessionWorkdir } from "../utils/issueGroups";
import { issueTabSessionId } from "../components/desktop/botWorkspace";
import { issueSessionBusy } from "../components/session/SessionStatusGlyph";

const EMPTY_MESSAGES: Message[] = [];

/**
 * Issue column: which planning/execution session the 规划/执行 tab points at,
 * and the switch that makes it the current session.
 *
 * A desktop window shows one session at a time. Selecting an issue (or the
 * other tab) activates that session, so the column reads the same live chat
 * state the rest of the app does — the previous mirror had to re-fetch the whole
 * transcript over HTTP every four seconds because the socket only feeds the
 * current session.
 */
export function useIssueTranscript({
  shownIssueGroup,
  assistantVisible,
  host,
  currentSessionId,
  messages,
  isStreaming,
  postToHost,
}: {
  shownIssueGroup: DesktopIssueGroup | undefined;
  assistantVisible: boolean;
  host: DesktopHostProps | undefined;
  currentSessionId: string | undefined;
  messages: Message[];
  isStreaming: boolean;
  postToHost: (message: { command: "loadOlderMessages"; before: string }) => void;
}) {
  const [issueTabChoice, setIssueTabChoice] = useState<{
    issueId: string;
    tab: IssueViewTab;
  } | null>(null);
  const openIssueViewTab: IssueViewTab =
    shownIssueGroup && issueTabChoice?.issueId === shownIssueGroup.issueId
      ? issueTabChoice.tab
      : shownIssueGroup?.executionSessionId
        ? "execution"
        : "planning";
  const openIssueSessionId = !shownIssueGroup
    ? undefined
    : openIssueViewTab === "execution"
      ? (shownIssueGroup.executionSessionId ?? issueTabSessionId(shownIssueGroup))
      : resolveIssuePlanningSessionId(shownIssueGroup);
  const issueSessionActive =
    Boolean(openIssueSessionId) && currentSessionId === openIssueSessionId;

  // Ask the host to activate the session the column points at. A request is
  // keyed by (target, session we were on) so a re-render (the host echoes
  // currentSession) does not re-request, while a session moved elsewhere by the
  // sidebar is followed back.
  const requestedSwitchRef = useRef<{ target: string; from: string | undefined } | null>(null);
  useEffect(() => {
    if (!assistantVisible || host?.type !== "desktop") return;
    if (!shownIssueGroup || !openIssueSessionId) return;
    if (issueSessionActive) {
      requestedSwitchRef.current = null;
      return;
    }
    const last = requestedSwitchRef.current;
    if (last?.target === openIssueSessionId && last.from === currentSessionId) return;
    requestedSwitchRef.current = { target: openIssueSessionId, from: currentSessionId };
    host.onSelectSession(
      issueGroupSessionWorkdir(
        shownIssueGroup,
        openIssueSessionId,
        host.workdir,
      ),
      openIssueSessionId,
    );
  }, [
    assistantVisible,
    host,
    shownIssueGroup,
    openIssueSessionId,
    issueSessionActive,
    currentSessionId,
  ]);

  // 执行会话还是空的时候，停在执行标签上整页是黑的。用户没手动选过标签时，
  // 退回有记录的规划会话。
  useEffect(() => {
    if (!issueSessionActive || !shownIssueGroup) return;
    if (issueTabChoice?.issueId === shownIssueGroup.issueId) return;
    if (!shownIssueGroup.executionSessionId || openIssueViewTab !== "execution") return;
    if (messages.length > 0) return;
    if (!resolveIssuePlanningSessionId(shownIssueGroup)) return;
    // An execution session that never started has no transcript. Wait a beat so
    // the activated session's history can land before calling it empty.
    const timer = setTimeout(() => {
      setIssueTabChoice({ issueId: shownIssueGroup.issueId, tab: "planning" });
    }, 1200);
    return () => clearTimeout(timer);
  }, [issueSessionActive, shownIssueGroup, issueTabChoice, openIssueViewTab, messages.length]);

  const issueLoading = Boolean(openIssueSessionId) && !issueSessionActive;
  const shownIssueMessages: Message[] = issueSessionActive ? messages : EMPTY_MESSAGES;
  const issueShowWelcome = issueSessionActive && messages.length === 0;
  const issueStreaming =
    issueSessionActive &&
    (isStreaming ||
      Boolean(
        shownIssueGroup &&
          issueSessionBusy(shownIssueGroup, openIssueSessionId, {
            currentSessionId,
            isStreaming,
          }),
      ));
  const loadOlderIssueMessages = () => {
    if (!issueSessionActive) return;
    const before = messages[0]?.id;
    if (!before) return;
    postToHost({ command: "loadOlderMessages", before });
  };

  return {
    openIssueViewTab,
    setIssueTabChoice,
    openIssueSessionId,
    issueSessionActive,
    issueLoading,
    shownIssueMessages,
    issueShowWelcome,
    issueStreaming,
    loadOlderIssueMessages,
  };
}
