import { useLayoutEffect, useRef } from "react";
import type React from "react";
import type { ChatAction, DesktopHostProps } from "../types";
import { DRAFT_SESSION_ID, draftSessionMetadata } from "../utils/session";

/**
 * The sessions page keeps its own selected session. Opening an issue on Muse
 * Bot switches the live session for streaming, then this puts the sessions
 * page back when the user returns.
 */
export function useSessionsPageSession({
  hostRef,
  currentSession,
  onSessionsSurface,
  paneId,
  dispatch,
  postToHost,
  assistantVisible,
  workspaceActive,
  openIssueSessionId,
}: {
  hostRef: React.MutableRefObject<DesktopHostProps | undefined>;
  currentSession: { id?: string; workdir?: string } | undefined;
  onSessionsSurface: boolean;
  paneId: string | undefined;
  dispatch: React.Dispatch<ChatAction>;
  postToHost: (message: Record<string, unknown>) => void;
  assistantVisible: boolean;
  workspaceActive: string;
  openIssueSessionId: string | undefined;
}) {
  const state = { currentSession };
  const workspace = { active: workspaceActive };
  // 会话页记住自己的会话。Muse Bot 看事项时会临时切到那条会话以接收流式，
  // 但不改会话页记下的选择，回到会话页再切回去。Bot 主页不占用当前会话。
  // 切回来时先在这一帧放上记下的会话，不等宿主往返，中间栏才不会空一拍。
  // 新对话也是会话页自己的选择：草稿不在列表里，不能被上一条会话盖回去。
  const sessionsPageSessionRef = useRef<string | null>(null);
  const sessionsPageActiveRef = useRef(false);
  useLayoutEffect(() => {
    const listedSessionId = (id: string | undefined): string | null => {
      if (!id || id === DRAFT_SESSION_ID) return null;
      const listed = (hostRef.current?.sessionTree ?? []).some((group) =>
        group.sessions.some((session) => session.sessionId === id),
      );
      return listed ? id : null;
    };
    const currentId = state.currentSession?.id;
    const listed = listedSessionId(currentId);
    if (listed) sessionsPageSessionRef.current = listed;

    const ownsSessionsPage =
      onSessionsSurface &&
      (paneId === undefined || (hostRef.current?.focusedPaneId ?? paneId) === paneId);
    const stayedOnSessionsPage =
      ownsSessionsPage && sessionsPageActiveRef.current;
    sessionsPageActiveRef.current = ownsSessionsPage;
    if (ownsSessionsPage) {
      if (currentId === DRAFT_SESSION_ID) {
        sessionsPageSessionRef.current = DRAFT_SESSION_ID;
        return;
      }
      let owned = sessionsPageSessionRef.current;
      if (owned === DRAFT_SESSION_ID) {
        // 第一条消息会把草稿换成还没进侧栏的真实会话。人还在这一页上，
        // 就接着看这条，不要再开一个空白草稿把发送清掉。
        if (stayedOnSessionsPage && currentId) {
          sessionsPageSessionRef.current = currentId;
          return;
        }
        dispatch({
          type: "SET_CURRENT_SESSION",
          payload: draftSessionMetadata(),
        });
        postToHost({ command: "newSession" });
        return;
      }
      if (!owned) {
        const panes = hostRef.current?.panes ?? [];
        const paneSessionId = (
          paneId ? panes.find((pane) => pane.paneId === paneId) : panes[0]
        )?.sessionId;
        owned = listedSessionId(paneSessionId);
      }
      if (!owned && currentId && currentId !== DRAFT_SESSION_ID && !listed) {
        let latest = 0;
        for (const group of hostRef.current?.sessionTree ?? []) {
          for (const session of group.sessions) {
            if ((session.lastActiveAt ?? 0) >= latest) {
              latest = session.lastActiveAt ?? 0;
              owned = session.sessionId;
            }
          }
        }
      }
      if (owned && currentId !== owned) {
        const entry = (hostRef.current?.sessionTree ?? [])
          .flatMap((group) => group.sessions)
          .find((session) => session.sessionId === owned);
        sessionsPageSessionRef.current = owned;
        dispatch({
          type: "SET_CURRENT_SESSION",
          payload: {
            id: owned,
            sessionType: "main",
            workdir: entry?.workdir ?? state.currentSession?.workdir ?? "",
            createdAt: new Date(entry?.lastActiveAt ?? 0),
            lastActiveAt: new Date(entry?.lastActiveAt ?? 0),
            latestTotalTokens: 0,
            firstMessage: entry?.title,
          },
        });
        postToHost({ command: "desktopSelectSession", sessionId: owned });
      }
      return;
    }

    if (!assistantVisible || workspace.active === "bot" || !openIssueSessionId) return;
    if (currentId === openIssueSessionId) return;
    postToHost({ command: "desktopSelectSession", sessionId: openIssueSessionId });
  }, [
    assistantVisible,
    onSessionsSurface,
    workspace.active,
    openIssueSessionId,
    state.currentSession?.id,
    state.currentSession?.workdir,
    postToHost,
    paneId,
    dispatch,
  ]);
}
