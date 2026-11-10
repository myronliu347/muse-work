import { useEffect, useRef, useState } from "react";
import type { BotWorkspaceContextValue } from "../components/desktop/BotTabs";
import type { IssueViewTab } from "../components/issue/IssueSessionHeader";
import type { MuseApiClient } from "../muse/apiClient";
import type { DesktopHostProps, DesktopIssueGroup, Message } from "../types";
import { resolveIssuePlanningSessionId } from "../utils/issueGroups";
import { materializeMessageImages } from "../utils/messageImages";
import { issueSessionBusy } from "../components/session/SessionStatusGlyph";
import { issueTabSessionId } from "../components/desktop/botWorkspace";

const EMPTY_MESSAGES: Message[] = [];

function applyNewestIssuePage(
  current: Message[] | null,
  currentHasMore: boolean,
  incoming: Message[],
  hasMore: boolean,
): { messages: Message[]; hasMore: boolean } {
  const anchor = incoming[0]?.id;
  const anchorIndex =
    current && anchor
      ? current.findIndex((message) => message.id === anchor)
      : -1;
  if (current && anchorIndex > 0) {
    return {
      messages: [...current.slice(0, anchorIndex), ...incoming],
      hasMore: currentHasMore,
    };
  }
  return { messages: incoming, hasMore };
}

type IssueTranscript =
  | {
      sessionId: string;
      status: "ready";
      messages: Message[];
      hasMore: boolean;
    }
  | { sessionId: string; status: "error" }
  | null;

/**
 * Issue column transcript: which planning/execution session is showing, the
 * polled message page, and older-page loads. Live turns still come from the
 * chat reducer when that session is the active one.
 */
export function useIssueTranscript({
  shownIssueGroup,
  assistantVisible,
  host,
  workspace,
  museApi,
  currentSessionId,
  messages,
  isStreaming,
  postToHost,
}: {
  shownIssueGroup: DesktopIssueGroup | undefined;
  assistantVisible: boolean;
  host: DesktopHostProps | undefined;
  workspace: Pick<BotWorkspaceContextValue, "panel" | "lastIssueId">;
  museApi: MuseApiClient;
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
  const [issueTranscript, setIssueTranscript] = useState<IssueTranscript>(null);
  const [issueTranscriptAttempt, setIssueTranscriptAttempt] = useState(0);
  const issueTranscriptRef = useRef(issueTranscript);
  issueTranscriptRef.current = issueTranscript;
  const requestedOlderIssueRef = useRef<string | undefined>(undefined);
  // 左侧回到灵光时事项列会卸掉，但右侧当前事项还是这一条。继续拉它的记录，
  // 最近一次修改才不会被清空。
  const dockTranscriptSessionId = (() => {
    if (!assistantVisible || !host || host.type !== "desktop") return undefined;
    const issueId =
      workspace.panel.kind === "issue"
        ? workspace.panel.issueId
        : workspace.lastIssueId;
    if (!issueId) return undefined;
    const group = (host.issueGroups ?? []).find((item) => item.issueId === issueId);
    return group ? issueTabSessionId(group) : undefined;
  })();
  const loadedIssueSessionId = openIssueSessionId ?? dockTranscriptSessionId;
  useEffect(() => {
    requestedOlderIssueRef.current = undefined;
  }, [openIssueSessionId]);
  useEffect(() => {
    if (!assistantVisible || !loadedIssueSessionId) return;
    let cancelled = false;
    const sessionId = loadedIssueSessionId;
    const load = () => {
      void museApi
        .getMessages(sessionId)
        .then((page) => {
          if (cancelled) return;
          const incoming = materializeMessageImages(page.messages as Message[]);
          const hasMore = Boolean(page.hasMore);
          setIssueTranscript((current) => {
            const ready =
              current?.sessionId === sessionId && current.status === "ready"
                ? current
                : null;
            return {
              sessionId,
              status: "ready",
              ...applyNewestIssuePage(
                ready?.messages ?? null,
                ready?.hasMore ?? hasMore,
                incoming,
                hasMore,
              ),
            };
          });
        })
        .catch(() => {
          if (cancelled) return;
          setIssueTranscript((current) => {
            if (current?.sessionId === sessionId && current.status === "ready") {
              return current;
            }
            return { sessionId, status: "error" };
          });
        });
    };
    load();
    const interval = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [assistantVisible, loadedIssueSessionId, museApi, issueTranscriptAttempt]);
  const openIssueTranscript =
    issueTranscript && issueTranscript.sessionId === openIssueSessionId
      ? issueTranscript
      : null;
  const issueSessionLive =
    Boolean(openIssueSessionId) && currentSessionId === openIssueSessionId;
  const issueShowsLive = issueSessionLive && messages.length > 0;
  const shownIssueMessages = issueShowsLive
    ? messages
    : openIssueTranscript?.status === "ready"
      ? openIssueTranscript.messages
      : EMPTY_MESSAGES;
  const issueTranscriptReady = openIssueTranscript?.status === "ready";
  const issueTranscriptFailed = openIssueTranscript?.status === "error";
  const issueShowWelcome =
    shownIssueMessages.length === 0 && (issueShowsLive || issueTranscriptReady);
  const issueStreaming = issueShowsLive
    ? isStreaming
    : Boolean(
        shownIssueGroup &&
          issueSessionBusy(shownIssueGroup, openIssueSessionId, {
            currentSessionId,
            isStreaming,
          }),
      );
  // 执行会话还是空的时候，停在执行标签上整页是黑的。用户没手动选过标签时，
  // 退回有记录的规划会话。
  useEffect(() => {
    if (!shownIssueGroup) return;
    if (issueTabChoice?.issueId === shownIssueGroup.issueId) return;
    if (!shownIssueGroup.executionSessionId || openIssueViewTab !== "execution") return;
    if (openIssueTranscript?.status !== "ready" || openIssueTranscript.messages.length > 0) {
      return;
    }
    if (!resolveIssuePlanningSessionId(shownIssueGroup)) return;
    setIssueTabChoice({ issueId: shownIssueGroup.issueId, tab: "planning" });
  }, [shownIssueGroup, issueTabChoice, openIssueViewTab, openIssueTranscript]);
  const loadOlderIssueMessages = () => {
    if (issueShowsLive) {
      const before = messages[0]?.id;
      if (before) postToHost({ command: "loadOlderMessages", before });
      return;
    }
    const transcript = issueTranscriptRef.current;
    if (!openIssueSessionId || !transcript || transcript.status !== "ready") return;
    if (transcript.sessionId !== openIssueSessionId || !transcript.hasMore) return;
    const oldestId = transcript.messages[0]?.id;
    if (!oldestId || requestedOlderIssueRef.current === oldestId) return;
    requestedOlderIssueRef.current = oldestId;
    window.setTimeout(() => {
      if (requestedOlderIssueRef.current === oldestId) {
        requestedOlderIssueRef.current = undefined;
      }
    }, 3000);
    const sessionId = openIssueSessionId;
    void museApi
      .getMessages(sessionId, { before: oldestId, limit: 40 })
      .then((page) => {
        const older = materializeMessageImages(page.messages as Message[]);
        setIssueTranscript((current) => {
          if (
            !current ||
            current.sessionId !== sessionId ||
            current.status !== "ready"
          ) {
            return current;
          }
          const seen = new Set(current.messages.map((message) => message.id));
          const prepended = older.filter((message) => !seen.has(message.id));
          return {
            sessionId,
            status: "ready",
            messages: [...prepended, ...current.messages],
            hasMore: Boolean(page.hasMore),
          };
        });
      })
      .catch(() => {
        if (requestedOlderIssueRef.current === oldestId) {
          requestedOlderIssueRef.current = undefined;
        }
      });
  };

  return {
    openIssueViewTab,
    setIssueTabChoice,
    openIssueSessionId,
    issueTranscript,
    openIssueTranscript,
    issueShowsLive,
    shownIssueMessages,
    issueTranscriptFailed,
    issueShowWelcome,
    issueStreaming,
    setIssueTranscriptAttempt,
    loadOlderIssueMessages,
  };
}
