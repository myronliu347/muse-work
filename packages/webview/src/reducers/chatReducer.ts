import type {
  ChatState,
  ChatAction,
  Message,
  MessageBlock,
  TextBlock,
  ToolBlock,
  ErrorBlock,
  ToolBlockUpdateCallbackParams,
  EnrichedFileSnapshot,
} from "../types";
import { pinSessionTitle } from "../utils/session";
import { transcriptScore } from "../utils/subagentTranscript";
import { AGENT_TOOL_NAME } from "wave-agent-sdk/dist/constants/tools.js";

const SESSION_SCOPED_DIALOGS = new Set([
  "mcp",
  "status",
  "workflows",
  "agents",
]);

function dialogAfterSessionSwitch(
  activeDialog: ChatState["activeDialog"],
): ChatState["activeDialog"] {
  if (activeDialog && SESSION_SCOPED_DIALOGS.has(activeDialog)) return null;
  return activeDialog;
}

function isOptimisticUserId(id: string): boolean {
  return id.startsWith("user_") || id.startsWith("user-");
}

function userTextContent(message: Message): string | undefined {
  const block = message.blocks.find((b) => b.type === "text");
  if (!block || block.type !== "text") return undefined;
  const text = block.content?.trim();
  return text || undefined;
}

function emptyAssistant(messageId: string): Message {
  return {
    id: messageId,
    role: "assistant",
    timestamp: new Date().toISOString(),
    blocks: [],
  };
}

function ensureMessage(messages: Message[], messageId: string): Message[] {
  if (messages.some((m) => m.id === messageId)) return messages;
  return [...messages, emptyAssistant(messageId)];
}

function patchTranscript(
  transcripts: Record<string, Message[]>,
  subagentId: string,
  patch: (messages: Message[]) => Message[],
): Record<string, Message[]> {
  return {
    ...transcripts,
    [subagentId]: patch(transcripts[subagentId] ?? []),
  };
}

function applyStreamingContent(
  messages: Message[],
  payload: { messageId: string; chunk: string; stage: "streaming" | "end" },
): Message[] {
  const list = ensureMessage(messages, payload.messageId);
  return list.map((m) => {
    if (m.id !== payload.messageId) return m;
    const textBlockIndex = m.blocks.findIndex((b) => b.type === "text");
    if (textBlockIndex === -1) {
      return {
        ...m,
        blocks: [
          ...m.blocks,
          { type: "text" as const, content: payload.chunk, stage: payload.stage },
        ],
      };
    }
    return {
      ...m,
      blocks: m.blocks.map((block, idx) =>
        idx === textBlockIndex && block.type === "text"
          ? {
              ...block,
              content: block.content + payload.chunk,
              stage: payload.stage,
            }
          : block,
      ),
    };
  });
}

function applyToolBlock(
  messages: Message[],
  payload: ToolBlockUpdateCallbackParams,
): Message[] {
  const messageId = payload.messageId as string;
  const list = ensureMessage(messages, messageId);
  const { messageId: _ignored, id: toolBlockId, parametersChunk, ...rest } =
    payload;
  return list.map((m) => {
    if (m.id !== messageId) return m;
    const toolBlockIndex = m.blocks.findIndex(
      (b) => b.type === "tool" && b.id === toolBlockId,
    );
    if (toolBlockIndex === -1) {
      const newToolBlock: ToolBlock = {
        type: "tool",
        id: toolBlockId,
        name: rest.name || "",
        stage: rest.stage || "start",
        result: rest.result || "",
        success: rest.success ?? false,
        ...rest,
        parameters: (rest.parameters || "") + (parametersChunk || ""),
      };
      return { ...m, blocks: [...m.blocks, newToolBlock] };
    }
    return {
      ...m,
      blocks: m.blocks.map((block, idx) => {
        if (idx !== toolBlockIndex || block.type !== "tool") return block;
        const merged: ToolBlock = { ...block, ...rest };
        if (parametersChunk) {
          merged.parameters = (block.parameters || "") + parametersChunk;
        }
        return merged;
      }),
    };
  });
}

function enqueueAgentTool(state: ChatState, toolId: string): ChatState {
  if (
    !toolId ||
    state.agentToolSubagentIds[toolId] ||
    state.pendingAgentToolIds.includes(toolId)
  ) {
    return state;
  }
  return {
    ...state,
    pendingAgentToolIds: [...state.pendingAgentToolIds, toolId],
  };
}

function enqueueSubagent(state: ChatState, subagentId: string): ChatState {
  if (
    Object.values(state.agentToolSubagentIds).includes(subagentId) ||
    state.unboundSubagentIds.includes(subagentId)
  ) {
    return state;
  }
  return {
    ...state,
    unboundSubagentIds: [...state.unboundSubagentIds, subagentId],
  };
}

function bindAgentTools(state: ChatState): ChatState {
  const pending = [...state.pendingAgentToolIds];
  const unbound = [...state.unboundSubagentIds];
  const map = { ...state.agentToolSubagentIds };
  while (pending.length > 0 && unbound.length > 0) {
    const toolId = pending.shift()!;
    if (map[toolId]) continue;
    map[toolId] = unbound.shift()!;
  }
  const subagentMessages = { ...state.subagentMessages };
  for (const [toolId, subagentId] of Object.entries(map)) {
    if (subagentMessages[subagentId]) {
      subagentMessages[toolId] = subagentMessages[subagentId];
    }
  }
  return {
    ...state,
    pendingAgentToolIds: pending,
    unboundSubagentIds: unbound,
    agentToolSubagentIds: map,
    subagentMessages,
  };
}

function nestedMessagesFromLoaded(messages: Message[]): Record<string, Message[]> {
  const out: Record<string, Message[]> = {};
  for (const message of messages) {
    for (const block of message.blocks ?? []) {
      if (block.type !== "tool" || !block.id) continue;
      const nested = (
        block as ToolBlock & { nestedMessages?: Message[] }
      ).nestedMessages;
      if (Array.isArray(nested) && nested.length > 0) {
        out[block.id] = nested;
      }
    }
  }
  return out;
}

export const initialState: ChatState = {
  messages: [],
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
  isCommandRunning: false,
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
  projectSettings: undefined,
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

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_MESSAGES": {
      return {
        ...state,
        messages: action.payload,
        currentSession: pinSessionTitle(state.currentSession, action.payload),
        subagentMessages: {
          ...state.subagentMessages,
          ...nestedMessagesFromLoaded(action.payload),
        },
      };
    }
    case "UPDATE_MESSAGE_ID": {
      // 乐观用户气泡的客户端临时 id 对齐成 SDK 真实 id：rewind 等按 id 的
      // 操作依赖服务器 agent 消息里的 id，临时 id 从未持久化会 404。
      const { from, to } = action.payload;
      if (!from || !to || from === to) return state;
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === from ? { ...m, id: to } : m,
        ),
      };
    }
    case "SET_TASKS":
      return {
        ...state,
        tasks: action.payload,
        // Auto-expand task list when tasks are first created
        isTaskListCollapsed:
          state.tasks.length === 0 && action.payload.length > 0
            ? false
            : state.isTaskListCollapsed,
      };
    case "SET_BACKGROUND_TASKS":
      return {
        ...state,
        backgroundTasks: action.payload,
        // 首批后台任务到达时自动展开（与 SET_TASKS 首次出现自动展开一致）
        isBackgroundTasksCollapsed:
          state.backgroundTasks.length === 0 && action.payload.length > 0
            ? false
            : state.isBackgroundTasksCollapsed,
      };
    case "SET_WORKFLOW_RUNS":
      return { ...state, workflowRuns: action.payload };
    case "TOGGLE_TASK_LIST_COLLAPSE":
      return {
        ...state,
        isTaskListCollapsed: !state.isTaskListCollapsed,
      };
    case "SET_TASK_LIST_COLLAPSED":
      return {
        ...state,
        isTaskListCollapsed: action.payload,
      };
    case "TOGGLE_BACKGROUND_TASKS_COLLAPSE":
      return {
        ...state,
        isBackgroundTasksCollapsed: !state.isBackgroundTasksCollapsed,
      };
    case "EXPAND_BACKGROUND_TASKS":
      return { ...state, isBackgroundTasksCollapsed: false };
    case "TOGGLE_QUEUE_COLLAPSE":
      return {
        ...state,
        isQueueCollapsed: !state.isQueueCollapsed,
      };
    case "START_STREAMING":
      return {
        ...state,
        isStreaming: true,
      };
    case "END_STREAMING":
      return {
        ...state,
        isStreaming: false,
      };
    case "SET_COMPACTING":
      return {
        ...state,
        isCompacting: action.payload,
      };
    case "INPUT_CLEARED":
      return {
        ...state,
        shouldClearInput: false,
      };
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
              subagentMessages: {},
              agentToolSubagentIds: {},
              pendingAgentToolIds: [],
              unboundSubagentIds: [],
            }
          : {}),
      };
    }
    case "SET_SESSIONS_LOADING":
      return {
        ...state,
        sessionsLoading: action.payload,
      };
    case "SHOW_CONFIRMATION":
      return {
        ...state,
        pendingConfirmations: [...state.pendingConfirmations, action.payload],
      };
    case "HIDE_CONFIRMATION":
      return {
        ...state,
        pendingConfirmations: state.pendingConfirmations.filter(
          (c) => c.confirmationId !== action.payload,
        ),
      };
    case "SHOW_DIALOG":
      return {
        ...state,
        activeDialog: action.payload.type,
        configurationData: action.payload.data ?? state.configurationData,
        configurationLoading: false,
        configurationError: action.payload.error,
      };
    case "HIDE_DIALOG":
      return {
        ...state,
        activeDialog: null,
        configurationError: undefined,
        loginError: undefined,
      };
    case "SET_AUTHENTICATED":
      return {
        ...state,
        isAuthenticated: action.payload,
        initialized: true,
        loginError: action.payload ? undefined : state.loginError,
      };
    case "SET_LOGIN_ERROR":
      return {
        ...state,
        loginError: action.payload,
      };
    case "SET_CONFIGURATION_LOADING":
      return {
        ...state,
        configurationLoading: action.payload,
      };
    case "SET_CONFIGURATION_ERROR":
      return {
        ...state,
        configurationError: action.payload,
        configurationLoading: false,
      };
    case "SET_CONFIGURATION_DATA":
      return {
        ...state,
        configurationData: action.payload,
        configurationLoading: false,
      };
    case "SET_PROJECT_SETTINGS":
      return {
        ...state,
        projectSettings: action.payload,
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
        isCommandRunning:
          action.payload.isCommandRunning !== undefined
            ? action.payload.isCommandRunning
            : state.isCommandRunning,
        // A session switch must not inherit the previous session's compaction
        // hint; the host pushes the activated session's own state (or omits
        // it, meaning "not compacting").
        isCompacting: action.payload.isCompacting ?? false,
        // Same for the desktop restore overlay: each host push carries the
        // current restore state, defaulting to "not restoring".
        isRestoring: action.payload.isRestoring ?? false,
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
    case "SET_COMMAND_RUNNING":
      return {
        ...state,
        isCommandRunning: action.payload,
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
    case "APPEND_MESSAGE": {
      // Dedupe by id: hostBridge clears its knownAssistantIds guard on turn end
      // / error / session switch, so a straggler delta for a message already in
      // the list would otherwise be re-appended (duplicate React key warning).
      if (state.messages.some((m) => m.id === action.payload.id)) return state;
      // Fast-turn race: the SDK user:message echo can land before the host's
      // optimistic appendMessage. Drop the late client bubble when the nearest
      // user row already has the same text under a real SDK id.
      if (
        action.payload.role === "user" &&
        isOptimisticUserId(action.payload.id)
      ) {
        const incoming = userTextContent(action.payload);
        if (incoming) {
          for (let i = state.messages.length - 1; i >= 0; i--) {
            const m = state.messages[i];
            if (m.role !== "user") continue;
            if (!isOptimisticUserId(m.id) && userTextContent(m) === incoming) {
              return state;
            }
            break;
          }
        }
      }
      const messages = [...state.messages, action.payload];
      return {
        ...state,
        messages,
        // The desktop host delivers user messages incrementally and never
        // routes them through SET_MESSAGES, so the title pin must happen here
        // too — otherwise compaction wipes the derivation material.
        currentSession: pinSessionTitle(state.currentSession, messages),
      };
    }
    case "UPDATE_STREAMING_CONTENT": {
      const { messageId, chunk, stage } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const textBlockIndex = message.blocks.findIndex((b) => b.type === "text");

      let newBlocks: MessageBlock[];
      if (textBlockIndex === -1) {
        // No text block yet, append one
        const newTextBlock: TextBlock = {
          type: "text",
          content: chunk,
          stage,
        };
        newBlocks = [...message.blocks, newTextBlock];
      } else {
        // Append the delta chunk to the existing text block
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === textBlockIndex && block.type === "text") {
            return {
              ...block,
              content: block.content + chunk,
              stage,
            } as TextBlock;
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      return {
        ...state,
        messages: newMessages,
      };
    }
    case "UPDATE_STREAMING_REASONING": {
      const { messageId, chunk, stage } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const reasoningBlockIndex = message.blocks.findIndex(
        (b) => b.type === "reasoning",
      );

      let newBlocks: MessageBlock[];
      if (reasoningBlockIndex === -1) {
        // No reasoning block yet, append one. Record startTime so the UI can show
        // elapsed thinking time during streaming (SET_MESSAGES later overrides it
        // with the SDK's persisted value).
        const newReasoningBlock = {
          type: "reasoning" as const,
          content: chunk,
          stage,
          startTime: Date.now(),
          ...(stage === "end" ? { endTime: Date.now() } : {}),
        };
        newBlocks = [...message.blocks, newReasoningBlock];
      } else {
        // Append the delta chunk to the existing reasoning block, preserving
        // startTime and stamping endTime when the reasoning finishes.
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === reasoningBlockIndex && block.type === "reasoning") {
            return {
              ...block,
              content: block.content + chunk,
              stage,
              startTime: block.startTime ?? Date.now(),
              ...(stage === "end"
                ? { endTime: block.endTime ?? Date.now() }
                : {}),
            };
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      return {
        ...state,
        messages: newMessages,
      };
    }
    case "UPDATE_FILE_HISTORY": {
      // Turn ended: merge the turn's file_history blocks (messageId → enriched
      // snapshots) into the matching messages. Delta events never carry
      // file_history, so without this the card only appears after a session
      // switch re-fetches messages.
      const updates = action.payload.messages;
      if (!Array.isArray(updates) || updates.length === 0) return state;
      const byId = new Map(updates.map((u) => [u.messageId, u.snapshots]));
      const newMessages = state.messages.map((m) => {
        const snapshots = byId.get(m.id);
        if (!snapshots) return m;
        // Replace any existing file_history blocks with the fresh snapshot set
        // (a turn may append multiple blocks; the card wants the merged view).
        const otherBlocks = (m.blocks ?? []).filter(
          (b) => b.type !== "file_history",
        );
        return {
          ...m,
          blocks: [
            ...otherBlocks,
            {
              type: "file_history" as const,
              snapshots: snapshots as EnrichedFileSnapshot[],
            },
          ],
        };
      });
      return { ...state, messages: newMessages };
    }
    case "UPDATE_TOOL_BLOCK": {
      const {
        messageId,
        id: toolBlockId,
        parametersChunk,
        ...rest
      } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const toolBlockIndex = message.blocks.findIndex(
        (b) => b.type === "tool" && b.id === toolBlockId,
      );

      let newBlocks: MessageBlock[];
      if (toolBlockIndex === -1) {
        // Tool block doesn't exist yet, add it as a new block
        const newToolBlock: ToolBlock = {
          type: "tool",
          id: toolBlockId,
          name: rest.name || "",
          stage: rest.stage || "start",
          result: rest.result || "",
          success: rest.success ?? false,
          ...rest,
          parameters: (rest.parameters || "") + (parametersChunk || ""),
        };
        newBlocks = [...message.blocks, newToolBlock];
      } else {
        // Update existing tool block
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === toolBlockIndex && block.type === "tool") {
            const merged: ToolBlock = { ...block, ...rest };
            if (parametersChunk) {
              // Delta form (streaming): append the chunk to the accumulated parameters
              merged.parameters = (block.parameters || "") + parametersChunk;
            }
            return merged;
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      const isAgentTool =
        rest.name === AGENT_TOOL_NAME ||
        (toolBlockIndex !== -1 &&
          message.blocks[toolBlockIndex].type === "tool" &&
          message.blocks[toolBlockIndex].name === AGENT_TOOL_NAME);

      return bindAgentTools(
        enqueueAgentTool(
          { ...state, messages: newMessages },
          isAgentTool ? String(toolBlockId ?? "") : "",
        ),
      );
    }
    case "APPEND_ERROR_BLOCK": {
      const { error } = action.payload;
      const last = state.messages[state.messages.length - 1];
      // Empty-turn is a server bookkeeping miss when the SDK flickers loading
      // around Agent/tools. Don't pin "模型没有产生输出" under a live tool row.
      if (
        error === "模型没有产生输出" &&
        last?.role === "assistant" &&
        last.blocks.some((b) => b.type !== "error")
      ) {
        return state;
      }
      const newErrorBlock: ErrorBlock = { type: "error", content: error };

      // Compact / LLM errors must appear after the latest user send. Attaching
      // them to an older assistant bubble hides the failure above the follow-up.
      if (!last || last.role !== "assistant") {
        const errorMessage: Message = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          role: "assistant",
          timestamp: new Date().toISOString(),
          blocks: [newErrorBlock],
        };
        return {
          ...state,
          messages: [...state.messages, errorMessage],
        };
      }

      return {
        ...state,
        messages: state.messages.map((m, idx) =>
          idx === state.messages.length - 1
            ? { ...m, blocks: [...m.blocks, newErrorBlock] }
            : m,
        ),
      };
    }
    // Bang message incremental updates (keyed by messageId). Mirrors the CLI's
    // incremental bang handlers in useChat.tsx: add creates the user message
    // wrapper, update merges command/output, complete stamps exitCode + stage.
    case "APPEND_BANG_MESSAGE": {
      const { command, messageId } = action.payload;
      if (state.messages.some((m) => m.id === messageId)) return state;
      const bangMessage: Message = {
        id: messageId,
        role: "user",
        timestamp: new Date().toISOString(),
        blocks: [
          {
            type: "bang",
            command,
            output: "",
            stage: "running",
            exitCode: null,
          },
        ],
      };
      const messages = [...state.messages, bangMessage];
      return {
        ...state,
        messages,
        currentSession: pinSessionTitle(state.currentSession, messages),
      };
    }
    case "UPDATE_BANG_MESSAGE": {
      const { command, output, messageId } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;
      const newMessages = state.messages.map((m, idx) => {
        if (idx !== messageIndex) return m;
        return {
          ...m,
          blocks: m.blocks.map((b, bidx) =>
            bidx === m.blocks.length - 1 && b.type === "bang"
              ? { ...b, command, output }
              : b,
          ),
        };
      });
      return { ...state, messages: newMessages };
    }
    case "COMPLETE_BANG_MESSAGE": {
      const { command, exitCode, messageId, output } = action.payload;
      const messageIndex = state.messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return state;
      const newMessages = state.messages.map((m, idx) => {
        if (idx !== messageIndex) return m;
        return {
          ...m,
          blocks: m.blocks.map((b, bidx) =>
            bidx === m.blocks.length - 1 && b.type === "bang"
              ? {
                  ...b,
                  command,
                  exitCode,
                  stage: "end" as const,
                  ...(output !== undefined ? { output } : {}),
                }
              : b,
          ),
        };
      });
      return { ...state, messages: newMessages };
    }
    case "APPEND_SUBAGENT_MESSAGE": {
      const { subagentId, messageId } = action.payload;
      return bindAgentTools(
        enqueueSubagent(
          {
            ...state,
            subagentMessages: patchTranscript(
              state.subagentMessages,
              subagentId,
              (messages) => ensureMessage(messages, messageId),
            ),
          },
          subagentId,
        ),
      );
    }
    case "SET_SUBAGENT_MESSAGES": {
      const { subagentId, messages: incoming } = action.payload;
      const existing = state.subagentMessages[subagentId];
      const messages =
        transcriptScore(incoming) >= transcriptScore(existing)
          ? incoming
          : (existing ?? incoming);
      return bindAgentTools(
        enqueueSubagent(
          {
            ...state,
            subagentMessages: {
              ...state.subagentMessages,
              [subagentId]: messages,
            },
          },
          subagentId,
        ),
      );
    }
    case "UPDATE_SUBAGENT_STREAMING_CONTENT": {
      const { subagentId, ...payload } = action.payload;
      return bindAgentTools({
        ...state,
        subagentMessages: patchTranscript(
          state.subagentMessages,
          subagentId,
          (messages) => applyStreamingContent(messages, payload),
        ),
      });
    }
    case "UPDATE_SUBAGENT_TOOL_BLOCK": {
      const { subagentId, params } = action.payload;
      return bindAgentTools({
        ...state,
        subagentMessages: patchTranscript(
          state.subagentMessages,
          subagentId,
          (messages) => applyToolBlock(messages, params),
        ),
      });
    }
    default:
      return state;
  }
}
