import type { ChatState, ChatAction } from "../../types";
import { DRAFT_SESSION_ID, pinSessionTitle } from "../../utils/session";
import { dialogAfterSessionSwitch, nestedMessagesFromLoaded } from "./shared";

type Action = Extract<ChatAction, { type: "SET_SESSIONS" | "SET_CURRENT_SESSION" | "SET_SESSIONS_LOADING" | "SET_INITIAL_STATE" | "UPDATE_SELECTION" | "SET_QUEUED_MESSAGES" | "SET_EDITING_QUEUED_ID" | "SET_PERMISSION_MODE" | "SET_WORKDIR" }>;

export function reduceSession(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "SET_SESSIONS":
      return {
        ...state,
        sessions: action.payload,
        sessionsLoading: false,
      };
    case "SET_CURRENT_SESSION": {
      const session = action.payload;
      if (!session) {
        return {
          ...state,
          currentSession: undefined,
          backgroundTasks: [],
          workflowRuns: [],
          tasks: [],
          activeDialog: dialogAfterSessionSwitch(state.activeDialog),
          isCompacting: false,
        };
      }
      // The backend pushes a currentSession without firstMessage on session
      // switch, but the sessions list carries the authoritative firstMessage
      // (from JSONL). Backfill it so the header title stays consistent with the
      // session list. New sessions (not yet in the list) keep an empty
      // firstMessage so getSessionTitle falls back to deriving from messages.
      let currentSession = session;
      if (!session.firstMessage) {
        const existing = state.sessions.find((s) => s.id === session.id);
        if (existing?.firstMessage) {
          currentSession = { ...session, firstMessage: existing.firstMessage };
        }
      }
      const switched = state.currentSession?.id !== currentSession.id;
      const realId =
        currentSession.id && currentSession.id !== DRAFT_SESSION_ID
          ? currentSession.id
          : null;
      const cached =
        switched && realId
          ? state.transcriptsBySession?.[realId]
          : undefined;
      // 第一条消息先在草稿上乐观插入，随后宿主才换成真实 id。这条会话还没有
      // 历史记录，屏幕上的气泡就是正文，不能当成切会话清掉。
      const promotingDraft =
        switched &&
        state.currentSession?.id === DRAFT_SESSION_ID &&
        realId != null &&
        cached === undefined;
      return {
        ...state,
        currentSession,
        ...(switched
          ? {
              backgroundTasks: [],
              workflowRuns: [],
              tasks: [],
              activeDialog: dialogAfterSessionSwitch(state.activeDialog),
              isCompacting: false,
              // rewind 等流程通过 setInitialState 塞过 inputContent 预填输入框；
              // 会话切换时必须清掉，否则 MessageInput 的 sessionChanged 重置会把
              // 上一会话的预填文本带进新会话。
              inputContent: undefined,
              // Subagent transcripts/bindings are session-scoped: SET_MESSAGES
              // merges (never replaces) subagentMessages, so without clearing
              // here transcripts from previous sessions would be pinned in
              // memory forever (multi-MB per workflow run).
              subagentMessages: cached ? nestedMessagesFromLoaded(cached) : {},
              agentToolSubagentIds: {},
              pendingAgentToolIds: [],
              unboundSubagentIds: [],
              // 标题先到、消息后到时，空列表会被欢迎页占住。有记录就同一帧放回去；
              // 还没有记录就先留空，等这次加载完成再决定是欢迎页还是正文。
              // 草稿刚发出去的那一条不在此列，留在屏幕上。
              ...(realId
                ? promotingDraft
                  ? {
                      transcriptPending: false,
                      hasOlderMessages: false,
                    }
                  : {
                      messages: cached ?? [],
                      transcriptPending: cached === undefined,
                      hasOlderMessages: false,
                    }
                : { transcriptPending: false }),
            }
          : {}),
      };
    }
    case "SET_SESSIONS_LOADING":
      return {
        ...state,
        sessionsLoading: action.payload,
      };
    case "SET_INITIAL_STATE":
      return {
        ...state,
        messages: action.payload.messages,
        tasks: action.payload.tasks || [],
        isTaskListCollapsed:
          action.payload.isTaskListCollapsed !== undefined
            ? action.payload.isTaskListCollapsed
            : state.isTaskListCollapsed,
        isStreaming:
          action.payload.isStreaming !== undefined
            ? action.payload.isStreaming
            : state.isStreaming,
        // A session switch must not inherit the previous session's compaction
        // hint; the host pushes the activated session's own state (or omits
        // it, meaning "not compacting").
        isCompacting: action.payload.isCompacting ?? false,
        // Same for the desktop restore overlay: each host push carries the
        // current restore state, defaulting to "not restoring".
        isRestoring: action.payload.isRestoring ?? false,
        transcriptPending: false,
        sessions: action.payload.sessions || state.sessions || [],
        // Re-pin from the same-snapshot messages: hosts re-push the session
        // object without firstMessage on pane/webview re-init.
        currentSession: pinSessionTitle(
          action.payload.currentSession || state.currentSession,
          action.payload.messages,
        ),
        configurationData:
          action.payload.configurationData || state.configurationData,
        pendingConfirmations: action.payload.pendingConfirmations || [],
        queuedMessages: action.payload.queuedMessages || [],
        backgroundTasks: action.payload.backgroundTasks ?? [],
        workflowRuns: action.payload.workflowRuns ?? [],
        inputContent: action.payload.inputContent,
        selection: action.payload.selection,
        permissionMode: action.payload.permissionMode || state.permissionMode,
        attachedImages: action.payload.attachedImages || [],
        sessionsLoading: false,
        configurationLoading: false,
        initialized: true,
        isAuthenticated:
          action.payload.isAuthenticated !== undefined
            ? action.payload.isAuthenticated
            : state.isAuthenticated,
        workdir:
          action.payload.workdir !== undefined
            ? action.payload.workdir
            : state.workdir,
        theme:
          action.payload.theme !== undefined
            ? action.payload.theme
            : state.theme,
        subagentMessages: nestedMessagesFromLoaded(
          action.payload.messages || [],
        ),
        agentToolSubagentIds: {},
        pendingAgentToolIds: [],
        unboundSubagentIds: [],
      };
    case "UPDATE_SELECTION":
      return {
        ...state,
        selection: action.payload,
      };
    case "SET_QUEUED_MESSAGES":
      return {
        ...state,
        queuedMessages: action.payload,
      };
    case "SET_EDITING_QUEUED_ID":
      return {
        ...state,
        editingQueuedId: action.payload,
      };
    case "SET_PERMISSION_MODE":
      return {
        ...state,
        permissionMode: action.payload,
      };
    case "SET_WORKDIR":
      return {
        ...state,
        workdir: action.payload,
      };
    // Incremental update actions for streaming optimization
  }
}
