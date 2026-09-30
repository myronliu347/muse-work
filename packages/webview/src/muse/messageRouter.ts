import type React from "react";
import type {
  ChatState,
  ChatAction,
  VsCodeApi,
  DesktopPanelKind,
  FileViewState,
  ContentSearchFileHit,
  ToolBlockUpdateCallbackParams,
  FileTreeDirEntry,
  Message,
} from "../types";
import { patchPaneUi, usePanelGroupStore } from "../stores";
import { upsertFileContentTab, closeFileTab } from "./fileTabs";
import { stripImageSourceMarkers, normalizeUserTextForDedupe } from "../utils/messageUtils";

/**
 * Refs the message router reads at event time. Structurally typed so the
 * module never imports components (muse/ must not depend on components/):
 * MessageInputHandle only contributes `focus`, MessageList only
 * `scrollToBottom`.
 */
export interface MessageRouterRefs {
  paneIdRef: React.MutableRefObject<string | undefined>;
  stateRef: React.MutableRefObject<ChatState>;
  messageListRef: React.RefObject<{
    scrollToBottom: (behavior?: ScrollBehavior) => void;
  }>;
  messageInputRef: React.RefObject<{ focus: () => void }>;
  chatContainerRef: React.RefObject<HTMLDivElement>;
  togglePanelRef: React.MutableRefObject<(kind: DesktopPanelKind) => void>;
  previewUrlRef: React.MutableRefObject<string | null>;
  groupKeyRef: React.MutableRefObject<string | undefined>;
  openQuickOpenRef: React.MutableRefObject<(query: string) => void>;
}

export interface MessageHandlerDeps {
  dispatch: React.Dispatch<ChatAction>;
  vscode: VsCodeApi;
  refs: MessageRouterRefs;
}

/**
 * Factory for the window "message" listener that turns host pushes into
 * reducer actions / store patches. The 58-case switch is intentionally
 * copied verbatim from ChatApp.tsx (payloads are heterogeneous and the side
 * effects sequence-sensitive — an event-table rewrite would be a behavior
 * change). `myPane` is snapshotted once at factory creation; paneId never
 * changes for a mounted ChatApp, so this equals the old effect-time capture.
 */
export function createMessageHandler({
  dispatch,
  vscode,
  refs,
}: MessageHandlerDeps): (event: MessageEvent) => void {
  const {
    paneIdRef,
    stateRef,
    messageListRef,
    messageInputRef,
    chatContainerRef,
    togglePanelRef,
    previewUrlRef,
    groupKeyRef,
    openQuickOpenRef,
  } = refs;

  // Session-scoped host pushes are pane-tagged on desktop (FR-032). This pane
  // consumes a message when it is untagged (single view / global commands) or
  // tagged with this pane's id. Messages tagged with a different paneId
  // belong to a sibling pane and are ignored here.
  const myPane = paneIdRef.current;
  const forThisPane = (message: { paneId?: string }): boolean =>
    myPane === undefined || message.paneId === myPane;

  return (event: MessageEvent) => {
    const message = event.data;

    switch (message.command) {
      case "updateMessages":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_MESSAGES", payload: message.messages });
        break;
      case "updateTasks":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_TASKS", payload: message.tasks });
        if (message.isTaskListCollapsed !== undefined) {
          dispatch({
            type: "SET_TASK_LIST_COLLAPSED",
            payload: message.isTaskListCollapsed,
          });
        }
        break;
      case "updateBackgroundTasks":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_BACKGROUND_TASKS", payload: message.tasks });
        break;
      case "updateWorkflowRuns":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_WORKFLOW_RUNS", payload: message.runs });
        break;
      case "updateSelection":
        if (!forThisPane(message)) break;
        dispatch({ type: "UPDATE_SELECTION", payload: message.selection });
        break;
      case "updatePermissionMode":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_PERMISSION_MODE", payload: message.mode });
        break;
      case "updateWorkdir":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_WORKDIR", payload: message.workdir });
        break;
      case "desktopGitBranches":
        // Per-pane branch list reply (FR-052). Routed by paneId so a sibling
        // pane's reply never overwrites this pane's selector.
        if (!forThisPane(message)) break;
        patchPaneUi(myPane, { paneGitBranches: message.result ?? null });
        break;
      case "desktopForwardPortResult":
        // Remote preview port-forward reply (scenario 15/16). The forward is
        // session-scoped, so the reply is matched against the session whose
        // cached forward carries this requestId — a reply that lands after
        // the pane rebinds to another session still updates the owning
        // session's cached URL instead of being dropped.
        if (!forThisPane(message)) break;
        {
          const targetKey = usePanelGroupStore
            .getState()
            .findGroupKeyByForwardRequestId(message.requestId);
          if (targetKey === undefined) break;
          if (message.error) {
            usePanelGroupStore.getState().patchGroup(targetKey, {
              forwardError: String(message.error),
            });
          } else {
            usePanelGroupStore.getState().patchGroup(targetKey, {
              forwardError: null,
              previewUrl: message.url as string,
            });
            if (
              message.url === previewUrlRef.current &&
              targetKey === groupKeyRef.current
            ) {
              // Same URL as before (re-acquire after a guest load failure):
              // remount so the webview actually reloads instead of the [url]
              // effect early-returning on an unchanged prop.
              usePanelGroupStore.getState().bumpPreviewEpoch(targetKey);
            }
          }
        }
        break;
      case "desktopFileContent":
        // File panel content reply (file panel spec scenario 1/2). Routed by
        // paneId so a sibling pane's reply never overwrites this pane's view.
        // Multi-tab: fill the tab for this path (keeping its pin state and
        // position), or build one and activate it when no tab exists.
        if (!forThisPane(message)) break;
        {
          const key = groupKeyRef.current;
          if (key) {
            const incoming = message.fileView as FileViewState;
            const requestedPath =
              typeof message.requestedPath === "string"
                ? message.requestedPath
                : undefined;
            usePanelGroupStore.getState().patchGroup(key, (group) =>
              upsertFileContentTab(
                {
                  fileTabs: group.fileTabs ?? [],
                  activeFilePath: group.activeFilePath ?? null,
                },
                incoming,
                requestedPath,
              ),
            );
          }
        }
        break;
      case "openQuickOpen":
        if (!forThisPane(message)) break;
        {
          const key = groupKeyRef.current;
          const closePath = typeof message.path === "string" ? message.path : "";
          if (key && closePath) {
            usePanelGroupStore.getState().patchGroup(key, (group) =>
              closeFileTab(
                {
                  fileTabs: group.fileTabs ?? [],
                  activeFilePath: group.activeFilePath ?? null,
                },
                closePath,
              ),
            );
          }
          const query = typeof message.query === "string" ? message.query : "";
          openQuickOpenRef.current(query);
        }
        break;
      case "desktopListDirResult": {
        const key = groupKeyRef.current;
        if (!key) break;
        const cacheDir = typeof message.dir === "string" ? message.dir : "";
        const entries = Array.isArray(message.entries)
          ? (message.entries as FileTreeDirEntry[])
          : [];
        usePanelGroupStore.getState().patchGroup(key, (group) => ({
          fileTree: {
            ...(group.fileTree ?? {
              expanded: [],
              width: 240,
              childrenCache: {},
              collapsed: true,
            }),
            childrenCache: {
              ...(group.fileTree?.childrenCache ?? {}),
              [cacheDir]: entries,
            },
          },
        }));
        break;
      }
      case "desktopSearchContentResult": {
        const key = groupKeyRef.current;
        if (!key) break;
        const requestId =
          typeof message.requestId === "string" ? message.requestId : "";
        usePanelGroupStore.getState().patchGroup(key, (group) => {
          if (
            !group.contentSearch?.requestId ||
            group.contentSearch.requestId !== requestId
          ) {
            return {};
          }
          return {
            contentSearch: {
              ...group.contentSearch,
              loading: false,
              results: Array.isArray(message.results)
                ? (message.results as ContentSearchFileHit[])
                : [],
              expandedFiles: Array.isArray(message.results)
                ? (message.results as ContentSearchFileHit[]).map(
                    (r) => r.relativePath,
                  )
                : [],
              truncated: Boolean(message.truncated) || undefined,
              error:
                typeof message.error === "string"
                  ? message.error
                  : undefined,
            },
          };
        });
        break;
      }
      case "updateQueue":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_QUEUED_MESSAGES", payload: message.messages });
        break;
      case "updateQueuedMessageMissing":
        if (!forThisPane(message)) break;
        // The edited queue message no longer exists. Keep input content, exit editing.
        dispatch({ type: "SET_EDITING_QUEUED_ID", payload: null });
        patchPaneUi(myPane, {
          queueEditWarning: "编辑的队列消息已不存在！",
        });
        break;
      case "rewindCheckpoints":
        if (!forThisPane(message)) break;
        patchPaneUi(myPane, {
          rewindCheckpoints: message.checkpoints || [],
          rewindCheckpointsLoading: false,
        });
        break;
      case "configuredModels":
        if (!forThisPane(message)) break;
        patchPaneUi(myPane, {
          configuredModels: message.models || [],
          currentModel: message.currentModel,
          modelLoading: false,
        });
        break;
      // Test-only handlers
      case "startStreaming":
        if (!forThisPane(message)) break;
        dispatch({ type: "START_STREAMING" });
        break;
      case "endStreaming":
        if (!forThisPane(message)) break;
        dispatch({ type: "END_STREAMING" });
        break;
      case "ensureUIReset":
        if (!forThisPane(message)) break;
        dispatch({ type: "END_STREAMING" });
        break;
      case "updateSessions":
        dispatch({ type: "SET_SESSIONS", payload: message.sessions });
        break;
      case "updateCurrentSession":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_CURRENT_SESSION", payload: message.session });
        break;
      case "showConfirmation":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SHOW_CONFIRMATION",
          payload: {
            confirmationId: message.confirmationId,
            toolName: message.toolName,
            confirmationType: message.confirmationType,
            toolInput: message.toolInput,
            suggestedPrefix: message.suggestedPrefix,
            hidePersistentOption: message.hidePersistentOption,
            permissionMode: message.permissionMode,
            warning: message.warning,
          },
        });
        // Scroll to bottom when confirmation is shown
        setTimeout(() => {
          if (
            messageListRef.current &&
            typeof messageListRef.current.scrollToBottom === "function"
          ) {
            messageListRef.current.scrollToBottom("auto");
          }
        }, 0);
        break;
      case "configurationResponse":
        dispatch({
          type: "SET_CONFIGURATION_DATA",
          payload: message.configurationData,
        });
        break;
      case "setInitialState":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SET_INITIAL_STATE",
          payload: {
            messages: message.messages,
            tasks: message.tasks,
            isStreaming: message.isStreaming,
            isTaskListCollapsed: message.isTaskListCollapsed,
            isRestoring: message.isRestoring,
            sessions: message.sessions,
            currentSession: message.session,
            configurationData: message.configurationData,
            pendingConfirmations:
              message.pendingConfirmations ||
              (message.pendingConfirmation
                ? [message.pendingConfirmation]
                : []),
            selection: message.selection,
            inputContent: message.inputContent,
            permissionMode: message.permissionMode,
            attachedImages: message.attachedImages,
            queuedMessages: message.queuedMessages,
            isAuthenticated: message.isAuthenticated,
            workdir: message.workdir,
            theme: message.theme,
            // The desktop host includes the running background tasks + workflow
            // runs in the snapshot so a webview re-init / pane switch does not
            // wipe them. Without this the reducer falls back to [] and /tasks
            // shows "暂无后台任务" until the next incremental
            // updateBackgroundTasks (e.g. stop).
            backgroundTasks: message.backgroundTasks,
            workflowRuns: message.workflowRuns,
          },
        });
        break;
      case "desktopThemeChange":
        break;
      case "issue:changed":
        // 对话内（AI 跑 issue.mjs）等非 UI 来源的 Issue 变更 → 刷新侧栏分组。
        vscode.postMessage({ command: "desktopRefreshSessionTree" });
        break;
      case "showToast":
        // Toasts are window-global (no paneId) — only the root instance (the
        // one that renders the shell/sidebar, never a split-view pane) tracks
        // them, so a multi-pane desktop never stacks duplicates.
        if (myPane !== undefined) break;
        patchPaneUi(undefined, (slice) => ({
          toasts: [
            ...slice.toasts.filter((t) => t.id !== message.toast.id),
            message.toast,
          ],
        }));
        break;
      case "desktopNewSessionShortcut":
        // Menu accelerator is window-global; the shell / single-pane instance
        // owns newSession so split panes do not spawn duplicates.
        if (myPane !== undefined) break;
        vscode.postMessage({ command: "newSession" });
        break;
      case "desktopTogglePanel":
        if (!forThisPane(message)) break;
        togglePanelRef.current(message.kind as DesktopPanelKind);
        break;
      case "showConfiguration":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SHOW_DIALOG",
          payload: {
            type: "config" as const,
            data:
              message.configurationData ||
              stateRef.current.configurationData ||
              {},
            error: message.error,
          },
        });
        break;
      case "showDialog":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SHOW_DIALOG",
          payload: { type: message.dialogType },
        });
        break;
      case "configurationUpdated":
        dispatch({ type: "HIDE_DIALOG" });
        break;
      case "statusResponse":
        if (!forThisPane(message)) break;
        if (message.configurationData) {
          dispatch({
            type: "SET_CONFIGURATION_DATA",
            payload: message.configurationData,
          });
        }
        break;
      case "configurationError":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_CONFIGURATION_ERROR", payload: message.error });
        break;
      case "focusInput":
        if (!forThisPane(message)) break;
        // When a confirm/rewind dialog is open in this pane, focus its
        // primary action instead of the message input. The input is hidden
        // (display:none) during a tool-permission confirmation, so focusing it
        // silently no-ops; a rewind modal also covers it. Landing focus on
        // the dialog lets the user act on it immediately (Enter to confirm,
        // Esc to cancel) right after the pane switch. Falls back to the
        // message input when no dialog is open.
        {
          const root = chatContainerRef.current ?? document;
          const rewindBtn = root.querySelector<HTMLElement>(
            ".confirm-dialog-btn-confirm:not([disabled])",
          );
          if (rewindBtn) {
            rewindBtn.focus();
            break;
          }
          const applyBtn = root.querySelector<HTMLElement>(
            ".confirmation-btn-apply:not([disabled])",
          );
          if (applyBtn) {
            applyBtn.focus();
            break;
          }
          if (
            messageInputRef.current &&
            typeof messageInputRef.current.focus === "function"
          ) {
            messageInputRef.current.focus();
          }
        }
        break;
      case "scrollToBottom":
        if (!forThisPane(message)) break;
        // Scroll the message list to bottom
        if (
          messageListRef.current &&
          typeof messageListRef.current.scrollToBottom === "function"
        ) {
          messageListRef.current.scrollToBottom("auto");
        }
        break;
      // Incremental update commands for streaming optimization
      case "appendMessage":
        if (!forThisPane(message)) break;
        dispatch({ type: "APPEND_MESSAGE", payload: message.message });
        break;
      // Queued sends (while the AI is busy) skip the optimistic bubble; when
      // the SDK dispatches the queued message it broadcasts user:message.
      // Dedupe against the last user bubble for normal non-queued sends,
      // which already appended the same content locally.
      case "user:message": {
        if (!forThisPane(message)) break;
        const um = message as {
          id?: string;
          content?: string;
          images?: Array<{ path: string; mimeType: string }>;
        };
        // The server extends screenshot sends with [Image source: ...]
        // markers; strip them so dedupe still matches the optimistic bubble
        // and the bubble does not render the marker text.
        const content = stripImageSourceMarkers(um.content ?? "").trim();
        if (!content && !um.images?.length) break;
        const realId =
          typeof um.id === "string" && um.id.length > 0 ? um.id : undefined;
        // 乐观气泡可能已被插队的错误块（如空 turn 提示）或 isMeta SessionStart
        // 提醒压到非最后一条，只比对「最近一条 role=user」会漏掉匹配、重复渲染
        // 同一条用户气泡。向上找最近一条未对齐的乐观气泡做去重。判据是「未对齐
        // 的乐观气泡」而非时间窗：SDK 排队（上轮慢流未结束）或斜杠技能先
        // executeSkill 再 addUserMessage 时，echo 可能在发送数秒后才广播，时间
        // 窗会误判为新消息、重复渲染；而乐观气泡用客户端临时 id（user_/user-
        // 前缀），对齐后变成 SDK 真实 id（msg- 前缀）。所以只有 id 仍为临时前缀、
        // 或已等于本 echo 真实 id（幂等重播）的消息才是去重目标——已对齐的历史
        // 消息（真实 id）不会被误配，连续发送的相同内容也不会被错误合并。
        // isMeta 用户消息（SessionStart hook）不参与匹配，也不打断向上扫描。
        const isOptimisticId = (id: string) =>
          id.startsWith("user_") || id.startsWith("user-");
        let lastMsg: (typeof stateRef.current.messages)[number] | undefined;
        for (let i = stateRef.current.messages.length - 1; i >= 0; i--) {
          const m = stateRef.current.messages[i];
          if (m.role !== "user" || m.isMeta) continue;
          if (
            isOptimisticId(m.id) ||
            (realId != null && m.id === realId)
          ) {
            lastMsg = m;
            break;
          }
          // 已对齐的真实用户消息：停止扫描，避免误配更早的同文乐观气泡。
          break;
        }
        if (
          lastMsg != null &&
          content &&
          lastMsg.blocks?.some(
            (b) =>
              b.type === "text" &&
              (b.content === content ||
                normalizeUserTextForDedupe(b.content ?? "") ===
                  normalizeUserTextForDedupe(content)),
          )
        ) {
          // 命中乐观气泡：把客户端临时 id 对齐成 SDK 真实 id，否则该消息
          // 上的 rewind 按钮会用临时 id 请求服务器 → checkpoint not found
          if (realId && lastMsg.id !== realId) {
            dispatch({
              type: "UPDATE_MESSAGE_ID",
              payload: { from: lastMsg.id, to: realId },
            });
          }
          break;
        }
        const blocks: Message["blocks"] = [];
        if (content) {
          blocks.push({ type: "text", content });
        }
        if (um.images?.length) {
          blocks.push({
            type: "image",
            imageUrls: um.images.map((img) => img.path),
          });
        }
        dispatch({
          type: "APPEND_MESSAGE",
          payload: {
            id:
              realId ??
              `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: "user",
            timestamp: new Date().toISOString(),
            blocks,
          },
        });
        break;
      }
      // Bang message incremental updates. Hosts post the bang params nested
      // under `params` (they contain a `command` field that would otherwise
      // clobber the postMessage command discriminator).
      case "bangMessageAdded":
        if (!forThisPane(message)) break;
        console.log(
          "DBG bangMessageAdded",
          message.params,
          stateRef.current.messages.length,
        );
        dispatch({ type: "APPEND_BANG_MESSAGE", payload: message.params });
        break;
      case "bangMessageUpdated":
        if (!forThisPane(message)) break;
        dispatch({ type: "UPDATE_BANG_MESSAGE", payload: message.params });
        break;
      case "bangMessageCompleted":
        if (!forThisPane(message)) break;
        dispatch({ type: "COMPLETE_BANG_MESSAGE", payload: message.params });
        break;
      case "compactionStateChange":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SET_COMPACTING",
          payload: message.isCompacting === true,
        });
        break;
      case "updateStreamingContent":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_STREAMING_CONTENT",
          payload: {
            messageId: message.messageId,
            chunk: message.chunk,
            stage: message.stage,
          },
        });
        break;
      case "updateStreamingReasoning":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_STREAMING_REASONING",
          payload: {
            messageId: message.messageId as string,
            chunk: message.chunk as string,
            stage: message.stage as "end" | "streaming",
          },
        });
        break;
      case "updateFileHistory":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_FILE_HISTORY",
          payload: {
            messages: message.messages as Array<{
              messageId: string;
              snapshots: unknown[];
            }>,
          },
        });
        break;
      case "updateToolBlock":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_TOOL_BLOCK",
          payload: message.params as ToolBlockUpdateCallbackParams,
        });
        break;
      case "updateErrorBlock":
        if (!forThisPane(message)) break;
        dispatch({
          type: "APPEND_ERROR_BLOCK",
          payload: { error: message.error },
        });
        break;
      case "appendSubagentMessage":
        if (!forThisPane(message)) break;
        dispatch({
          type: "APPEND_SUBAGENT_MESSAGE",
          payload: {
            subagentId: message.subagentId,
            messageId: message.messageId,
          },
        });
        break;
      case "updateSubagentStreamingContent":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_SUBAGENT_STREAMING_CONTENT",
          payload: {
            subagentId: message.subagentId,
            messageId: message.messageId,
            chunk: message.chunk,
            stage: message.stage,
          },
        });
        break;
      case "updateSubagentToolBlock":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_SUBAGENT_TOOL_BLOCK",
          payload: {
            subagentId: message.subagentId,
            params: message.params as ToolBlockUpdateCallbackParams,
          },
        });
        break;
      case "setSubagentMessages":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SET_SUBAGENT_MESSAGES",
          payload: {
            subagentId: message.subagentId,
            messages: message.messages,
          },
        });
        break;
      case "authStatusResponse":
        dispatch({
          type: "SET_AUTHENTICATED",
          payload: message.isAuthenticated || false,
        });
        break;
      case "showAuthDialog":
        dispatch({
          type: "SHOW_DIALOG",
          payload: { type: "login" },
        });
        break;
      case "loginResponse":
        if (message.success) {
          dispatch({ type: "SET_AUTHENTICATED", payload: true });
        } else {
          dispatch({
            type: "SET_LOGIN_ERROR",
            payload:
              typeof message.error === "string"
                ? message.error
                : "登录失败，请重试",
          });
        }
        break;
      case "logoutResponse":
        if (message.success) {
          dispatch({ type: "SET_AUTHENTICATED", payload: false });
        }
        break;
    }
  };
}
