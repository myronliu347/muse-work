import type { ChatState, ChatAction } from "../types";
import {
  collectBlobUrlsFromMessages,
  collectBlobUrlsFromTranscriptBook,
  evictTranscriptCache,
  revokeBlobUrlsExcept,
  slimMessagesForTranscriptCache,
} from "../utils/messageImages";
import { reduceDialogs } from "./chat/dialogs";
import { reduceSession } from "./chat/session";
import { reduceSubagent } from "./chat/subagent";
import { reduceTasks } from "./chat/tasks";
import { reduceTranscript } from "./chat/transcript";

export const initialState: ChatState = {
  messages: [],
  transcriptsBySession: {},
  transcriptPending: false,
  hasOlderMessages: false,
  tasks: [],
  backgroundTasks: [],
  workflowRuns: [],
  isTaskListCollapsed: false,
  isQueueCollapsed: true,
  isBackgroundTasksCollapsed: false,
  editingQueuedId: null,
  isStreaming: false,
  isCompacting: false,
  isRestoring: false,
  shouldClearInput: false,
  sessions: [],
  currentSession: undefined,
  sessionsLoading: false,
  pendingConfirmations: [],
  queuedMessages: [],
  // Dialog state
  activeDialog: null,
  configurationData: undefined,
  configurationLoading: false,
  configurationError: undefined,
  // Permission mode state
  permissionMode: "acceptEdits",
  // Attached images state
  attachedImages: [],
  // Auth state
  isAuthenticated: false,
  initialized: false,
  workdir: undefined,
  subagentMessages: {},
  agentToolSubagentIds: {},
  pendingAgentToolIds: [],
  unboundSubagentIds: [],
};

function reduceChat(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_MESSAGES":
    case "PREPEND_MESSAGES":
    case "APPEND_MESSAGES":
    case "UPDATE_MESSAGE_ID":
    case "APPEND_MESSAGE":
    case "UPDATE_STREAMING_CONTENT":
    case "UPDATE_STREAMING_REASONING":
    case "UPDATE_FILE_HISTORY":
    case "UPDATE_TOOL_BLOCK":
    case "APPEND_ERROR_BLOCK":
    case "APPEND_BANG_MESSAGE":
    case "UPDATE_BANG_MESSAGE":
    case "COMPLETE_BANG_MESSAGE":
      return reduceTranscript(state, action);
    case "SET_TASKS":
    case "SET_BACKGROUND_TASKS":
    case "SET_WORKFLOW_RUNS":
    case "TOGGLE_TASK_LIST_COLLAPSE":
    case "SET_TASK_LIST_COLLAPSED":
    case "TOGGLE_BACKGROUND_TASKS_COLLAPSE":
    case "EXPAND_BACKGROUND_TASKS":
    case "TOGGLE_QUEUE_COLLAPSE":
    case "START_STREAMING":
    case "END_STREAMING":
    case "SET_COMPACTING":
    case "INPUT_CLEARED":
      return reduceTasks(state, action);
    case "SET_SESSIONS":
    case "SET_CURRENT_SESSION":
    case "SET_SESSIONS_LOADING":
    case "SET_INITIAL_STATE":
    case "UPDATE_SELECTION":
    case "SET_QUEUED_MESSAGES":
    case "SET_EDITING_QUEUED_ID":
    case "SET_PERMISSION_MODE":
    case "SET_WORKDIR":
      return reduceSession(state, action);
    case "SHOW_CONFIRMATION":
    case "HIDE_CONFIRMATION":
    case "SHOW_DIALOG":
    case "HIDE_DIALOG":
    case "SET_AUTHENTICATED":
    case "SET_LOGIN_ERROR":
    case "SET_CONFIGURATION_LOADING":
    case "SET_CONFIGURATION_ERROR":
    case "SET_CONFIGURATION_DATA":
      return reduceDialogs(state, action);
    case "APPEND_SUBAGENT_MESSAGE":
    case "SET_SUBAGENT_MESSAGES":
    case "UPDATE_SUBAGENT_STREAMING_CONTENT":
    case "UPDATE_SUBAGENT_TOOL_BLOCK":
      return reduceSubagent(state, action);
    default:
      return state;
  }
}

function withTranscriptMemory(prev: ChatState, next: ChatState): ChatState {
  let result = next;
  if (next !== prev && !next.transcriptPending) {
    const id = next.currentSession?.id;
    if (
      id &&
      id !== "__draft__" &&
      !(next.messages === prev.messages && id === prev.currentSession?.id)
    ) {
      const book = next.transcriptsBySession ?? {};
      // Slim copy: drop data: payloads only. Keep blob: so switch-back paint
      // still shows thumbs; old ChatState closures must not retain base64.
      const slim = slimMessagesForTranscriptCache(next.messages);
      if (book[id] !== slim) {
        result = {
          ...next,
          transcriptsBySession: evictTranscriptCache(
            {
              ...book,
              [id]: slim,
            },
            id,
          ),
        };
      }
    }
  }

  // Revoke only blobs that left both the live transcript and the session book.
  // Revoking against a slim cache of "" was wiping thumbs still on screen.
  if (result !== prev) {
    const keep = collectBlobUrlsFromMessages(result.messages);
    for (const url of collectBlobUrlsFromTranscriptBook(
      result.transcriptsBySession,
    )) {
      keep.add(url);
    }
    const candidates = collectBlobUrlsFromMessages(prev.messages);
    for (const url of collectBlobUrlsFromTranscriptBook(
      prev.transcriptsBySession,
    )) {
      candidates.add(url);
    }
    if (candidates.size > 0) revokeBlobUrlsExcept(keep, candidates);
  }

  return result;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  return withTranscriptMemory(state, reduceChat(state, action));
}
