import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
} from "react";
import type {
  ChatState,
  ChatAction,
  DesktopHostProps,
  VsCodeApi,
} from "../types";
import type { PaneGitBranches } from "../stores";
import type { ChatAppCore } from "./useChatAppCore";

interface UseChatSendParams {
  postToHost: ChatAppCore["postToHost"];
  patchPane: ChatAppCore["patchPane"];
  dispatch: Dispatch<ChatAction>;
  vscode: VsCodeApi;
  stateRef: MutableRefObject<ChatState>;
  messageInputRef: RefObject<{
    focus: () => void;
    appendText: (text: string) => void;
    loadQueuedEditContent: (text: string) => void;
  }>;
  state: ChatState;
  host?: DesktopHostProps;
  worktreeChecked: boolean;
  worktreeBranch: string;
  gitBranches: PaneGitBranches | null;
  effectiveWorkdir?: string;
}

export interface ChatSendHandlers {
  handleSendMessage: (
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
    force?: boolean,
  ) => void;
  handleAbortMessage: () => void;
  handleClearChat: () => void;
  handleDeleteQueuedMessage: (id: string) => void;
  handleEditQueuedMessage: (id: string) => void;
  handleSubmitQueuedEdit: (
    id: string,
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
  ) => void;
  handleCancelQueuedEdit: () => void;
  handleAddComment: (text: string) => void;
}

export function useChatSend({
  postToHost,
  patchPane,
  dispatch,
  vscode,
  stateRef,
  messageInputRef,
  state,
  host,
  worktreeChecked,
  worktreeBranch,
  gitBranches,
  effectiveWorkdir,
}: UseChatSendParams): ChatSendHandlers {
  // Live workdir read for the first-message worktree branch (handleSendMessage
  // runs before the host pushes the post-create workdir back).
  const effectiveWorkdirRef = useRef(effectiveWorkdir);
  useEffect(() => {
    effectiveWorkdirRef.current = effectiveWorkdir;
  }, [effectiveWorkdir]);

  const handleClearChat = useCallback(() => {
    // /clear 斜杠命令：三端统一为"原地清空当前会话"，streaming 期间忽略。
    if (stateRef.current.isStreaming) return;

    postToHost({
      command: "clearChat",
    });
  }, [postToHost]);

  const handleSendMessage = useCallback(
    (
      text: string,
      images?: Array<{ data: string; mediaType: string }>,
      force: boolean = false,
    ) => {
      const trimmedText = text.trim();
      if (!trimmedText && (!images || images.length === 0)) return;

      const slashMatch = trimmedText.match(
        /^\/(clear|compact|rewind|mcp|status|tasks|workflows|plugin|config|agents)(\s|$)/,
      );
      if (slashMatch) {
        const name = slashMatch[1];
        if (name === "clear") {
          handleClearChat();
          return;
        }
        if (name === "compact") {
          postToHost({ command: "compactChat" });
          return;
        }
        if (name === "rewind") {
          patchPane({
            rewindPopupOpen: true,
            rewindCheckpointsLoading: true,
          });
          postToHost({ command: "listRewindCheckpoints" });
          return;
        }
        if (name === "mcp") {
          dispatch({ type: "SHOW_DIALOG", payload: { type: "mcp" } });
          return;
        }
        if (name === "status") {
          dispatch({ type: "SHOW_DIALOG", payload: { type: "status" } });
          return;
        }
        if (name === "tasks") {
          // 后台任务改为 sender 上方实时内联展示，/tasks 只负责展开列表
          dispatch({ type: "EXPAND_BACKGROUND_TASKS" });
          return;
        }
        if (name === "workflows") {
          dispatch({ type: "SHOW_DIALOG", payload: { type: "workflows" } });
          return;
        }
        if (name === "plugin") {
          dispatch({ type: "SHOW_DIALOG", payload: { type: "plugin" } });
          return;
        }
        if (name === "agents") {
          dispatch({ type: "SHOW_DIALOG", payload: { type: "agents" } });
          return;
        }
        if (name === "config") {
          dispatch({
            type: "SHOW_DIALOG",
            payload: {
              type: "config",
              data: stateRef.current.configurationData || {},
            },
          });
          vscode.postMessage({ command: "getConfiguration" });
          return;
        }
      }

      // Desktop worktree flow (FR-023): on the first message of a new session
      // with the worktree checkbox on, create the worktree first — the main
      // process switches into it and forwards this message.
      if (
        host?.type === "desktop" &&
        !stateRef.current.messages.some(
          (m) => !(m.role === "user" && m.isMeta),
        ) &&
        worktreeChecked &&
        effectiveWorkdirRef.current &&
        gitBranches
      ) {
        postToHost({
          command: "desktopCreateWorktree",
          workdir: effectiveWorkdirRef.current,
          baseBranch: worktreeBranch || gitBranches.current,
          text: trimmedText,
          images: images,
        });
        // Reset the opt-in immediately: the pane-level reset below (on
        // effectiveWorkdir change) only fires after the main process finishes
        // creating the worktree and pushes the new workdir back — within that
        // window a second message would re-enter this branch and create a
        // duplicate worktree. Clearing here keeps one create per message.
        patchPane({ worktreeChecked: false });
        return;
      }

      // Send to extension
      postToHost({
        command: "sendMessage",
        text: trimmedText,
        images: images,
        force: force,
      });
    },
    [
      handleClearChat,
      host,
      worktreeChecked,
      worktreeBranch,
      gitBranches,
      postToHost,
      patchPane,
      vscode,
    ],
  );

  const handleAbortMessage = useCallback(() => {
    if (!state.isStreaming) return;

    postToHost({
      command: "abortMessage",
    });
  }, [state.isStreaming, postToHost]);

  const handleDeleteQueuedMessage = useCallback(
    (id: string) => {
      // Optimistically update local state (filter by id)
      const newQueue = state.queuedMessages.filter((qm) => qm.id !== id);
      dispatch({ type: "SET_QUEUED_MESSAGES", payload: newQueue });

      // If the deleted one is being edited, exit editing mode
      if (state.editingQueuedId === id) {
        dispatch({ type: "SET_EDITING_QUEUED_ID", payload: null });
      }

      // Notify extension to delete from SDK's queue by id
      postToHost({
        command: "deleteQueuedMessageById",
        id,
      });
    },
    [state.queuedMessages, state.editingQueuedId, postToHost],
  );

  const handleEditQueuedMessage = useCallback(
    (id: string) => {
      const qm = state.queuedMessages.find((m) => m.id === id);
      if (!qm) return;

      const text = qm.content || qm.text || "";

      // Load content into this pane's input via the imperative ref (scoped to this
      // pane only; window.postMessage would be received by all split-view panes).
      messageInputRef.current?.loadQueuedEditContent(text);
      dispatch({ type: "SET_EDITING_QUEUED_ID", payload: id });
    },
    [state.queuedMessages],
  );

  const handleSubmitQueuedEdit = useCallback(
    (
      id: string,
      text: string,
      images?: Array<{ data: string; mediaType: string }>,
    ) => {
      postToHost({
        command: "updateQueuedMessage",
        id,
        text,
        images,
      });
      dispatch({ type: "SET_EDITING_QUEUED_ID", payload: null });
    },
    [postToHost],
  );

  const handleCancelQueuedEdit = useCallback(() => {
    dispatch({ type: "SET_EDITING_QUEUED_ID", payload: null });
  }, []);

  // Desktop panel comments (preview element picks, diff-line comments) land in
  // this pane's input (not sent), so several can be batched and edited before
  // sending.
  const handleAddComment = useCallback((text: string) => {
    messageInputRef.current?.appendText(text);
  }, []);

  return {
    handleSendMessage,
    handleAbortMessage,
    handleClearChat,
    handleDeleteQueuedMessage,
    handleEditQueuedMessage,
    handleSubmitQueuedEdit,
    handleCancelQueuedEdit,
    handleAddComment,
  };
}
