import React, {
  useEffect,
  useReducer,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentTranscriptPopup } from "./dialogs/AgentTranscriptPopup";
import { MessageList } from "./chat/MessageList";
import { MessageInput } from "./chat/MessageInput";
import type { MessageInputHandle } from "./chat/MessageInput";
import { ChatHeader } from "./chat/ChatHeader";
import { DesktopPanelDock } from "./desktop/DesktopPanelDock";
import { TaskList } from "./chat/TaskList";
import { QueuedMessageList } from "./chat/QueuedMessageList";
import { ConfirmationDialog } from "./dialogs/ConfirmationDialog";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { RewindPopup } from "./dialogs/RewindPopup";
import { ModelPopup } from "./dialogs/ModelPopup";
import { ToastStack } from "./shared/ToastStack";
import { BtwPanel } from "./chat/BtwPanel";
import ConfigDialog from "./dialogs/ConfigDialog";
import PluginDialog from "./dialogs/PluginDialog";
import McpDialog from "./dialogs/McpDialog";
import StatusDialog from "./dialogs/StatusDialog";
import BackgroundTaskManager from "./settings/BackgroundTaskManager";
import WorkflowManager from "./settings/WorkflowManager";
import AgentsDialog from "./dialogs/AgentsDialog";
import WelcomeView from "./chat/WelcomeView";
import { NewSessionPage } from "./chat/NewSessionPage";
import LoadingLogo from "./chat/LoadingLogo";
import {
  DesktopSidebar,
  resolveSidebarSessions,
} from "./desktop/DesktopSidebar";
import { DesktopShell } from "./desktop/DesktopShell";
import { DesktopWorkdirSelector } from "./desktop/DesktopWorkdirSelector";
import { DesktopGitContext } from "./desktop/DesktopGitContext";
import { DesktopWorktreeControls } from "./desktop/DesktopWorktreeControls";
import { matchPanelShortcut, matchNewSessionShortcut } from "../muse/panelShortcuts";
import { planPanelWidthsForOpen, defaultDockWidth } from "../muse/panelFit";
import { PANEL_TAB_ORDER } from "../muse/panelTabs";
import { PreviewPane } from "./panels/PreviewPane";
import { DiffPane } from "./panels/DiffPane";
import { TerminalPane, prefetchTerminalLib } from "./panels/TerminalPane";
import { FilePane } from "./panels/FilePane";
import type {
  ChatAppProps,
  ConfigurationData,
  ConfirmationDecision,
  DesktopPanelKind,
  FileViewState,
  Message,
  ToolBlock,
  ToolBlockUpdateCallbackParams,
  UpdateToast,
} from "../types";
import { chatReducer, initialState } from "../reducers/chatReducer";
import {
  parseAgentPrompt,
  resolveSubagentMessages,
} from "../utils/subagentTranscript";
import {
  usePanelGroupStore,
  nextActivePanelAfterClose,
  PANEL_DEFAULT_WIDTH,
  usePanelGroup,
  usePaneUi,
  patchPaneUi,
  type PanelGroupState,
} from "../stores";
import "../styles/ChatApp.css";

export { prunePanelGroupCache } from "../stores";

/** Desktop conversation-level panels: tab order in the shared dock. */
const PANEL_ORDER = PANEL_TAB_ORDER;
const PANEL_MIN_WIDTH = 320;
/** The conversation (message) area never shrinks below this when opening/dragging panels. */
const CHAT_MAIN_MIN_WIDTH = 360;

/**
 * Hostname spellings that name the same remote service through an ssh tunnel:
 * the forward always targets the remote's `localhost:<port>`, so every
 * loopback and all-interfaces spelling refers to the same endpoint (aligned
 * with VS Code's LOCALHOST_ADDRESSES / ALL_INTERFACES_ADDRESSES, whose
 * mapHasAddressLocalhostOrAllInterfaces treats them as one tunnel). Both
 * bracketed and bare IPv6 forms are covered — URL.hostname serializes the
 * former, terminal/Markdown links may carry the latter.
 */
const LOOPBACK_OR_ALL_INTERFACES_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0:0:0:0:0:0:0:1",
  "[0:0:0:0:0:0:0:1]",
  "0.0.0.0",
  "::",
  "[::]",
  "0:0:0:0:0:0:0:0",
  "[0:0:0:0:0:0:0:0]",
]);

/**
 * Canonical form of a preview URL for same-link comparison: collapses the
 * loopback/all-interfaces host spellings above to `localhost`, so clicking
 * `http://127.0.0.1:5173/app` after `http://localhost:5173/app` reuses the
 * established tunnel instead of release + re-acquire churn. Non-loopback URLs
 * (external sites) are returned unchanged.
 */
function canonicalForwardUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (LOOPBACK_OR_ALL_INTERFACES_HOSTS.has(u.hostname.toLowerCase()))
      u.hostname = "localhost";
    return u.href;
  } catch {
    return raw;
  }
}

export const ChatApp: React.FC<ChatAppProps> = ({ vscode, host, paneId }) => {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const paneUi = usePaneUi(paneId);
  const {
    queueEditWarning,
    toasts,
    pendingRewindId,
    rewindPopupOpen,
    rewindCheckpoints,
    rewindCheckpointsLoading,
    modelPopupOpen,
    configuredModels,
    currentModel,
    modelLoading,
    agentTranscript,
    btwPanel,
    worktreeBranch,
    worktreeChecked,
    paneGitBranches,
  } = paneUi;
  const patchPane = useCallback(
    (
      patch:
        | Partial<typeof paneUi>
        | ((slice: typeof paneUi) => Partial<typeof paneUi>),
    ) => {
      patchPaneUi(paneId, patch);
    },
    [paneId],
  );
  // Question of the in-flight askBtw RPC. Cleared on close so a late reply is
  // dropped (scenario 7); matched against the reply's echoed question so a stale
  // reply never lands on a newer panel (scenario 6/7).
  const btwActiveRef = useRef<string | null>(null);
  // Session the current /btw panel belongs to. Compared against
  // state.currentSession.id in an effect below: the panel is conversation-scoped
  // (spec scenario 14), and desktop pane instances stay mounted across
  // conversation switches (ChatApp is keyed by paneId, not sessionId), so pane
  // UI state alone would leak the previous conversation's panel.
  const btwSessionRef = useRef<string | undefined>(undefined);
  // Desktop new sessions start with workdir=null. Host bridge syncs
  // updateWorkdir on activate / folder pick / auto-create. Fall back to
  // host.workdir only for bound (non-draft) sessions when state has not
  // caught up yet.
  const isDraftSession =
    !state.currentSession?.id || state.currentSession.id === "__draft__";
  const effectiveWorkdir = isDraftSession
    ? state.workdir
    : (state.workdir ?? host?.workdir);
  const isDesktop = host?.type === "desktop";
  // Local-only for now (remote hosts removed from the composer).
  const effectiveHost = "local";
  const effectiveHostRef = useRef(effectiveHost);
  const gitBranches = isDesktop ? paneGitBranches : null;
  const effectiveWorkdirRef = useRef(effectiveWorkdir);
  // Desktop only: panel group is keyed by absolute workdir (not session).
  // Fall back to host.workdir so a draft with a selected folder still shares
  // the same dock as sessions in that directory.
  const panelWorkdir =
    effectiveWorkdir ?? (isDesktop ? host?.workdir : undefined) ?? undefined;
  const groupKey =
    isDesktop && panelWorkdir ? panelWorkdir : undefined;
  const groupKeyRef = useRef(groupKey);
  groupKeyRef.current = groupKey;
  const {
    checked: checkedPanels,
    mounted: mountedPanels,
    active: activePanel,
    widths: panelWidths,
    previewUrl,
    fileView,
    fileTree,
    forward: currentForward,
    forwardError: previewForwardError,
    previewEpoch,
  } = usePanelGroup(groupKey);
  const updatePanelGroup = useCallback(
    (
      patch:
        | Partial<PanelGroupState>
        | ((group: PanelGroupState) => Partial<PanelGroupState>),
    ) => {
      if (!groupKey) return;
      usePanelGroupStore.getState().patchGroup(groupKey, patch);
    },
    [groupKey],
  );
  // Mirrors of the forward state, refreshed on every render. Message is a
  // React.memo component whose DOM click handler captures props.onOpenPreview
  // at mount time — a useCallback that closes over the state values would pin
  // the FIRST values forever and the same-link dedup in
  // handleOpenRemotePreview would never see the established forward. The
  // handlers read the refs at click time instead (same pattern as
  // TerminalPane.tsx:117-119).
  const currentForwardRef = useRef(currentForward);
  currentForwardRef.current = currentForward;
  const previewForwardErrorRef = useRef(previewForwardError);
  previewForwardErrorRef.current = previewForwardError;
  const forwardSeqRef = useRef(0);
  const previewUrlRef = useRef(previewUrl);
  const fileViewRef = useRef<FileViewState | null>(fileView);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [chatColumnWidth, setChatColumnWidth] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth : 1280),
  );
  const checkedPanelsRef = useRef(checkedPanels);
  const mountedPanelsRef = useRef(mountedPanels);
  const activePanelRef = useRef(activePanel);
  const panelWidthsRef = useRef(panelWidths);
  // Mirrors so the stable message listener can reach the panel toggle logic
  // (defined below) without re-subscribing.
  const togglePanelRef = useRef<(kind: DesktopPanelKind) => void>(() => {});
  const panelDisabledRef = useRef<DesktopPanelKind[]>([]);
  const messageInputRef = useRef<MessageInputHandle>(null);
  const messageListRef = useRef<{
    scrollToBottom: (behavior?: ScrollBehavior) => void;
  }>(null);
  const stateRef = useRef(state);
  // The pane this instance renders; undefined = single view (IDE hosts and the
  // desktop single-pane layout). Ref mirror for use inside stable callbacks.
  const paneIdRef = useRef<string | undefined>(paneId);

  // Keep stateRef in sync with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    effectiveWorkdirRef.current = effectiveWorkdir;
  }, [effectiveWorkdir]);

  useEffect(() => {
    effectiveHostRef.current = effectiveHost;
  }, [effectiveHost]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => {
    fileViewRef.current = fileView;
  }, [fileView]);

  useEffect(() => {
    checkedPanelsRef.current = checkedPanels;
  }, [checkedPanels]);

  // Track the chat column width so dock maxWidth stays correct across
  // window resizes and split-pane changes (ref reads alone do not re-render).
  useEffect(() => {
    if (!isDesktop) return;
    const el = chatContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      // clientWidth is the CSS-constrained layout width (requires min-width:0
      // on .chat-container). getBoundingClientRect can report an overflowed
      // content size and feed a too-large dockMaxWidth, worsening the spill.
      const width = el.clientWidth;
      if (width > 0) setChatColumnWidth(width);
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => ro.disconnect();
  }, [isDesktop, paneId, host?.panes?.length]);

  useEffect(() => {
    mountedPanelsRef.current = mountedPanels;
  }, [mountedPanels]);

  useEffect(() => {
    activePanelRef.current = activePanel;
  }, [activePanel]);

  useEffect(() => {
    panelWidthsRef.current = panelWidths;
  }, [panelWidths]);

  useEffect(() => {
    paneIdRef.current = paneId;
  }, [paneId]);

  // Auto-dismiss the queue-edit warning banner
  useEffect(() => {
    if (!queueEditWarning) return;
    const timer = setTimeout(() => patchPane({ queueEditWarning: null }), 4000);
    return () => clearTimeout(timer);
  }, [queueEditWarning, patchPane]);

  // Desktop: reset the worktree controls when the branch list changes (i.e. the
  // workdir was re-queried). Default to the repo's current branch; worktree off.
  useEffect(() => {
    patchPane({
      worktreeBranch: gitBranches?.current ?? "",
      worktreeChecked: false,
    });
  }, [gitBranches, patchPane]);

  // Handle messages from VS Code extension
  useEffect(() => {
    // Session-scoped host pushes are pane-tagged on desktop (FR-032). This pane
    // consumes a message when it is untagged (single view / IDE hosts / global
    // commands) or tagged with this pane's id. Messages tagged with a different
    // paneId belong to a sibling pane and are ignored here.
    const myPane = paneIdRef.current;
    const forThisPane = (message: { paneId?: string }): boolean =>
      myPane === undefined || message.paneId === myPane;

    const handleMessage = (event: MessageEvent) => {
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
          if (!forThisPane(message)) break;
          {
            const key = groupKeyRef.current;
            if (key) {
              usePanelGroupStore.getState().patchGroup(key, {
                fileView: message.fileView as FileViewState,
              });
            }
          }
          break;
        case "desktopListDirResult": {
          const key = groupKeyRef.current;
          if (!key) break;
          const cacheDir = typeof message.dir === "string" ? message.dir : "";
          const entries = Array.isArray(message.entries)
            ? (message.entries as import("../types").FileTreeDirEntry[])
            : [];
          usePanelGroupStore.getState().patchGroup(key, (group) => ({
            fileTree: {
              ...(group.fileTree ?? {
                expanded: [],
                width: 240,
                childrenCache: {},
              }),
              childrenCache: {
                ...(group.fileTree?.childrenCache ?? {}),
                [cacheDir]: entries,
              },
            },
          }));
          break;
        }
        case "updateQueue":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_QUEUED_MESSAGES", payload: message.queue });
          break;
        case "updateQueuedMessageMissing":
          if (!forThisPane(message)) break;
          // The edited queue message no longer exists. Keep input content, exit editing.
          dispatch({ type: "SET_EDITING_QUEUED_ID", payload: null });
          patchPaneUi(myPane, {
            queueEditWarning: "编辑的队列消息已不存在！",
          });
          break;
        case "updateCommandRunning":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_COMMAND_RUNNING", payload: message.running });
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
        case "btwStream":
          if (!forThisPane(message)) break;
          // Streaming chunks from the askBtw RPC (spec scenario 6): thinking
          // chunks show live while they stream, but once the first content
          // chunk arrives the accumulated thinking text is discarded and only
          // content is kept (user decision: thinking is not shown after the
          // thinking phase ends).
          if (
            !btwActiveRef.current ||
            message.question !== btwActiveRef.current
          )
            break;
          patchPaneUi(myPane, (panel) => {
            if (!panel.btwPanel) return {};
            const content =
              typeof message.content === "string" ? message.content : "";
            if (message.type === "content") {
              const base = panel.btwPanel.contentStarted
                ? panel.btwPanel.answer
                : "";
              return {
                btwPanel: {
                  ...panel.btwPanel,
                  contentStarted: true,
                  answer: base + content,
                },
              };
            }
            if (panel.btwPanel.contentStarted) return {};
            return {
              btwPanel: {
                ...panel.btwPanel,
                answer: panel.btwPanel.answer + content,
              },
            };
          });
          break;
        case "btwResponse":
          if (!forThisPane(message)) break;
          // Drop late replies: the panel must be open, the panel's question must
          // still match the in-flight one, and the reply must echo the same question.
          if (
            btwActiveRef.current &&
            message.question === btwActiveRef.current
          ) {
            patchPaneUi(myPane, (panel) =>
              panel.btwPanel
                ? {
                    btwPanel: {
                      ...panel.btwPanel,
                      answer: message.answer ?? "",
                      loading: false,
                    },
                  }
                : {},
            );
          }
          break;
        case "btwError":
          if (!forThisPane(message)) break;
          if (
            btwActiveRef.current &&
            message.question === btwActiveRef.current
          ) {
            patchPaneUi(myPane, (panel) =>
              panel.btwPanel
                ? {
                    btwPanel: {
                      ...panel.btwPanel,
                      answer: `(API error: ${message.error ?? "unknown"})`,
                      loading: false,
                    },
                  }
                : {},
            );
          }
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
              planContent: message.planContent,
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
        case "projectSettings":
          // Project settings (.wave/settings.json merged enabledPlugins) are
          // per-workdir, so on Desktop each pane may hold a different value —
          // must be pane-guarded (unlike the shared global configurationResponse).
          if (!forThisPane(message)) break;
          dispatch({
            type: "SET_PROJECT_SETTINGS",
            payload: { enabledPlugins: message.enabledPlugins },
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
              isCommandRunning: message.isCommandRunning,
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
              // Hosts (VSCE messageHandler / Desktop desktopHost) include the
              // running background tasks + workflow runs in the snapshot so a
              // webview re-init / pane switch does not wipe them. Without this
              // the reducer falls back to [] and /tasks shows "暂无后台任务"
              // until the next incremental updateBackgroundTasks (e.g. stop).
              backgroundTasks: message.backgroundTasks,
              workflowRuns: message.workflowRuns,
            },
          });
          break;
        case "desktopThemeChange":
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
        case "triggerShortcut":
          if (!forThisPane(message)) break;
          // Forwarded IDE keymap shortcut (JetBrains): the component-scoped AnAction
          // intercepts the IDE action and forwards the intended operation here, since
          // registerCustomShortcutSet consumes the AWT event before CEF can see it.
          if (
            messageInputRef.current &&
            typeof messageInputRef.current.triggerShortcut === "function"
          ) {
            messageInputRef.current.triggerShortcut(message.name);
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
        case "loginResponse":
          if (message.success) {
            dispatch({ type: "SET_AUTHENTICATED", payload: true });
          }
          break;
        case "logoutResponse":
          if (message.success) {
            dispatch({ type: "SET_AUTHENTICATED", payload: false });
          }
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Desktop multi-pane (FR-032): session-scoped commands carry this pane's id
  // so the host routes them to the agent bound to this pane. Untagged when
  // paneId is undefined (IDE hosts) — those backends ignore the field.
  const postToHost = useCallback(
    (message: Record<string, unknown>) => {
      const pid = paneIdRef.current;
      vscode.postMessage(
        pid === undefined ? message : { ...message, paneId: pid },
      );
    },
    [vscode],
  );

  // Desktop: query this pane's own workdir for its git branches (FR-052). Each
  // pane asks independently so a new-session pane keeps its workdir/branch even
  // when focus moves to a sibling pane (which would otherwise rewire the host's
  // global workdir). Clear stale branches first so the selector hides until the
  // fresh reply lands.
  //
  // Depend ONLY on effectiveWorkdir (a primitive string) — never on the host
  // object reference, and never on host.workdir. Rationale: when a new pane
  // boots, activateAgentInPane sends desktopWorkdirState to update the host's
  // global workdir from the previously-focused sibling's path to this pane's
  // repo root. That changes host.workdir even though THIS pane's
  // effectiveWorkdir is unchanged (spawn-before = recents[0] fallback; spawn-after
  // = state.workdir = agent.cwd = the same recents[0]). Re-querying on a
  // host.workdir change would null out the branches and flash the selector
  // twice. A genuine user workdir switch changes recents[0] (and thus
  // effectiveWorkdir), which is the only re-query signal we want.
  useEffect(() => {
    if (!isDesktop) return;
    patchPane({ paneGitBranches: null });
    if (!effectiveWorkdir) return;
    postToHost({
      command: "desktopListGitBranches",
      workdir: effectiveWorkdir,
      paneId,
    });
  }, [effectiveWorkdir, isDesktop, postToHost, paneId, patchPane]);

  const handleClearChat = useCallback(() => {
    // /clear 斜杠命令：三端统一为"原地清空当前会话"，streaming 期间忽略。
    if (stateRef.current.isStreaming) return;

    postToHost({
      command: "clearChat",
    });
  }, [postToHost]);

  const handleToastDismiss = useCallback(
    (id: string) => {
      patchPane((slice) => ({
        toasts: slice.toasts.filter((t) => t.id !== id),
      }));
    },
    [patchPane],
  );

  const handleToastAction = useCallback(
    (toast: UpdateToast) => {
      if (!toast.action) return;
      postToHost({
        command: "toastAction",
        toastId: toast.id,
        action: toast.action,
      });
      patchPane((slice) => ({
        toasts: slice.toasts.filter((t) => t.id !== toast.id),
      }));
    },
    [postToHost, patchPane],
  );

  // Desktop 的"新对话"入口（侧边栏按钮）：由宿主 spawn 新 agent 承载全新会话，
  // 当前会话在后台继续，因此流式期间保持可用。
  const handleDesktopNewSession = useCallback(() => {
    postToHost({
      command: "newSession",
    });
  }, [postToHost]);

  const handleDesktopNewSessionInWorkdir = useCallback(
    (workdir: string) => {
      postToHost({
        command: "newSession",
        workdir,
      });
    },
    [postToHost],
  );

  const handleLogin = useCallback(() => {
    vscode.postMessage({ command: "login" });
  }, [vscode]);

  const handleOpenSettings = useCallback(() => {
    dispatch({
      type: "SHOW_DIALOG",
      payload: {
        type: "config",
        data: stateRef.current.configurationData || {},
      },
    });
    vscode.postMessage({ command: "getConfiguration" });
  }, [vscode]);

  const handleLogout = useCallback(() => {
    vscode.postMessage({ command: "logout" });
  }, [vscode]);

  const handleSendMessage = useCallback(
    (
      text: string,
      images?: Array<{ data: string; mediaType: string }>,
      force: boolean = false,
    ) => {
      const trimmedText = text.trim();
      if (!trimmedText && (!images || images.length === 0)) return;

      const slashMatch = trimmedText.match(
        /^\/(clear|compact|rewind|mcp|status|tasks|workflows|plugin|config)(\s|$)/,
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
          dispatch({ type: "SHOW_DIALOG", payload: { type: "tasks" } });
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

  const handleSendQueuedMessage = useCallback(
    (id: string) => {
      const qm = state.queuedMessages.find((m) => m.id === id);
      if (!qm) return;

      const text = qm.content || qm.text || "";
      const images = qm.images?.map((img) => ({
        data: img.path || "",
        mediaType: img.mimeType || "",
      }));

      // force=true: terminate current conversation and send this message immediately
      handleSendMessage(text, images, true);

      // Optimistically remove from queue + notify backend (and exit editing if applicable)
      handleDeleteQueuedMessage(id);
    },
    [state.queuedMessages, handleSendMessage, handleDeleteQueuedMessage],
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

  // Configuration handlers
  const handleConfigurationSave = useCallback(
    (configData: ConfigurationData) => {
      dispatch({ type: "SET_CONFIGURATION_LOADING", payload: true });
      vscode.postMessage({
        command: "updateConfiguration",
        configurationData: configData,
      });
    },
    [vscode],
  );

  const handleDialogClose = useCallback(() => {
    dispatch({ type: "HIDE_DIALOG" });
  }, []);

  // A message counts as chat content only when the UI renders it — hidden meta
  // user messages (e.g. SessionStart hook additionalContext, isMeta: true) do
  // not, so they must not suppress the welcome page.
  const hasVisibleMessages = state.messages.some(
    (m) => !(m.role === "user" && m.isMeta),
  );

  // Welcome page shows only when there are no visible messages yet. Login is optional:
  // a direct-connect config (baseURL/apiKey) works without authentication, so an
  // unauthenticated user who sends a message must still see the chat, not the welcome page.
  const showWelcome = !hasVisibleMessages;
  // Withhold the welcome page until the initial state (incl. auth status) has
  // arrived, otherwise logged-in users see the login CTA flash before
  // setInitialState updates isAuthenticated to true.
  const showWelcomeReady = showWelcome && state.initialized;

  // Initialize webview and load sessions on component mount
  useEffect(() => {
    dispatch({ type: "SET_SESSIONS_LOADING", payload: true });
    vscode.postMessage({
      command: "webviewReady",
    });
  }, [vscode]);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      if (state.isStreaming) return;

      // 清空当前任务列表：避免恢复期间残留旧会话的任务，
      // 并让新会话任务从空状态进入（若全部已完成则直接保持隐藏）
      dispatch({ type: "SET_TASKS", payload: [] });

      postToHost({
        command: "restoreSession",
        sessionId,
      });
    },
    [state.isStreaming, postToHost],
  );

  const handleInputCleared = useCallback(() => {
    dispatch({ type: "INPUT_CLEARED" });
  }, []);

  // Desktop panel comments (preview element picks, diff-line comments) land in
  // this pane's input (not sent), so several can be batched and edited before
  // sending.
  const handleAddComment = useCallback((text: string) => {
    messageInputRef.current?.appendText(text);
  }, []);

  // Re-focus input when command finishes running (e.g., after bang execution)
  useEffect(() => {
    if (!state.isCommandRunning && messageInputRef.current) {
      messageInputRef.current.focus();
    }
  }, [state.isCommandRunning]);

  useEffect(() => {
    patchPane({ agentTranscript: null });
  }, [state.currentSession?.id, patchPane]);

  const handleConfirmation = useCallback(
    (confirmationId: string, decision?: ConfirmationDecision) => {
      postToHost({
        command: "confirmationResponse",
        confirmationId,
        approved: true,
        decision,
      });
      dispatch({ type: "HIDE_CONFIRMATION", payload: confirmationId });
    },
    [postToHost],
  );

  const handleRejection = useCallback(
    (confirmationId: string) => {
      postToHost({
        command: "confirmationResponse",
        confirmationId,
        approved: false,
      });
      dispatch({ type: "HIDE_CONFIRMATION", payload: confirmationId });
    },
    [postToHost],
  );

  const handleRewindToMessage = useCallback(
    (messageId: string) => {
      if (state.isStreaming) return;
      patchPane({ pendingRewindId: messageId });
    },
    [state.isStreaming, patchPane],
  );

  const handleOpenAgentTranscript = useCallback(
    (toolBlock: ToolBlock) => {
      const nested = (
        toolBlock as ToolBlock & { nestedMessages?: Message[] }
      ).nestedMessages;
      const resultText = (toolBlock.result || "").trim();
      patchPane({
        agentTranscript: {
          subagentId: toolBlock.id ?? "",
          title: toolBlock.compactParams?.trim() || toolBlock.name || "Agent",
          nestedMessages: nested,
          fallbackText: resultText || undefined,
          prompt: parseAgentPrompt(toolBlock.parameters),
        },
      });
    },
    [patchPane],
  );

  const handleCloseAgentTranscript = useCallback(() => {
    patchPane({ agentTranscript: null });
  }, [patchPane]);

  // /rewind popup selection reuses the same ConfirmDialog flow as the
  // per-message rewind button.
  const handleRewindCheckpointSelect = useCallback(
    (messageId: string) => {
      patchPane({ rewindPopupOpen: false, pendingRewindId: messageId });
      messageInputRef.current?.focus();
    },
    [patchPane],
  );

  const handleRewindPopupClose = useCallback(() => {
    patchPane({ rewindPopupOpen: false });
    messageInputRef.current?.focus();
  }, [patchPane]);

  // /model popup: send the switch and close silently (no toast/system message).
  const handleModelSelect = useCallback(
    (model: string) => {
      postToHost({ command: "setModel", model });
      patchPane({ modelPopupOpen: false });
      messageInputRef.current?.focus();
    },
    [postToHost, patchPane],
  );

  // Per-session model in sender toolbar → PATCH /sessions/:id { model }.
  const handleSessionModelChange = useCallback(
    (model: string) => {
      postToHost({ command: "setSessionModel", model });
    },
    [postToHost],
  );

  const handleModelPopupClose = useCallback(() => {
    patchPane({ modelPopupOpen: false });
    messageInputRef.current?.focus();
  }, [patchPane]);

  // Close the /btw panel. While a request is in flight, clearing btwActiveRef
  // makes the late reply a no-op (scenario 7: closing during loading drops it).
  const handleBtwClose = useCallback(() => {
    btwActiveRef.current = null;
    patchPane({ btwPanel: null });
    messageInputRef.current?.focus();
  }, [patchPane]);

  // The /btw panel is conversation-scoped (spec scenario 14): switching to
  // another conversation closes it, so the new conversation never shows the old
  // one's panel. Desktop panes key ChatApp by paneId (not sessionId), so a
  // sidebar session switch leaves this component mounted — without this effect
  // pane UI state would survive the switch (setInitialState only resets reducer
  // state). Clearing btwActiveRef also drops any in-flight askBtw reply that
  // lands after the switch. `previous !== undefined` keeps the initial mount
  // (no conversation assigned yet) a no-op.
  useEffect(() => {
    const sessionId = state.currentSession?.id;
    const previous = btwSessionRef.current;
    btwSessionRef.current = sessionId;
    if (previous !== undefined && previous !== sessionId) handleBtwClose();
  }, [state.currentSession?.id, handleBtwClose]);

  const handleRewindConfirm = useCallback(() => {
    const messageId = pendingRewindId;
    patchPane({ pendingRewindId: null });
    if (messageId) {
      postToHost({
        command: "rewindToMessage",
        messageId,
      });
    }
  }, [pendingRewindId, postToHost, patchPane]);

  const showPanelHint = useCallback(
    (text: string) => {
      // Route local validations (panel min-width refusals, preview URL checks)
      // through the host's global toast so desktop hints share one presentation
      // with host failures instead of a second hint style.
      postToHost({ command: "desktopShowHint", text });
    },
    [postToHost],
  );

  // Desktop remote sessions: request an ssh port forward for the clicked
  // localhost URL (scenario 15). The main process picks a local port, starts
  // `ssh -N -L` and replies with the rewritten 127.0.0.1 address, which the
  // preview pane then loads. Repeated clicks on the SAME link while the forward
  // is established or connecting are no-ops — the tunnel is reused, not rebuilt.
  const acquireForward = useCallback(
    (host: string, url: string) => {
      // The forward is keyed by the session's panel-group key; without one (a
      // pane-less desktop view) there is nothing to cache the reference under.
      if (!groupKey) return;
      let remotePort: number;
      try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          showPanelHint("仅支持 http/https 链接");
          return;
        }
        remotePort = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
      } catch {
        showPanelHint("无效的预览链接");
        return;
      }
      const requestId = `fwd-${++forwardSeqRef.current}`;
      const fwd = { host, remotePort, originalUrl: url, requestId };
      usePanelGroupStore.getState().ensureGroup(groupKey);
      updatePanelGroup({ forward: fwd });
      // The session id scopes the tunnel's lifetime on the host — it stays alive
      // across UI actions and is only released when the session is deleted
      // (scenario 18).
      postToHost({
        command: "desktopForwardPort",
        host,
        url,
        requestId,
        sessionId: groupKey,
      });
    },
    [postToHost, showPanelHint, groupKey, updatePanelGroup],
  );

  // Desktop: idle-preload the lazily injected xterm chunk so the first
  // terminal open doesn't pay the fetch+parse cost.
  useEffect(() => {
    if (!isDesktop) return;
    const id = window.requestIdleCallback?.(() => prefetchTerminalLib());
    return () => {
      if (id !== undefined) window.cancelIdleCallback?.(id);
    };
  }, [isDesktop]);

  // Open a panel as a tab in the shared dock. First open must fit beside the
  // conversation; later tabs reuse the same column. Mounting is sticky.
  const tryOpenPanel = useCallback(
    (kind: DesktopPanelKind): boolean => {
      if (checkedPanelsRef.current.includes(kind)) {
        updatePanelGroup({ active: kind });
        return true;
      }
      if (checkedPanelsRef.current.length === 0) {
        const containerW =
          chatContainerRef.current?.clientWidth ||
          chatContainerRef.current?.getBoundingClientRect().width;
        if (containerW) {
          // First open of this session's dock: ~50% of the chat column (not
          // the full window — sidebar already ate space). Later reopen after
          // close keeps the last dragged width.
          const desired = defaultDockWidth(containerW, PANEL_MIN_WIDTH);
          const baseWidths =
            mountedPanelsRef.current.length === 0
              ? {
                  preview: desired,
                  diff: desired,
                  terminal: desired,
                  file: desired,
                }
              : panelWidthsRef.current;
          const planned = planPanelWidthsForOpen(
            containerW,
            [],
            baseWidths,
            kind,
            { panelMin: PANEL_MIN_WIDTH, chatMin: CHAT_MAIN_MIN_WIDTH },
          );
          if (!planned.ok) {
            showPanelHint("空间不足，无法开启面板");
            return false;
          }
          const changed = PANEL_ORDER.some(
            (k) => planned.widths[k] !== panelWidthsRef.current[k],
          );
          if (changed) {
            panelWidthsRef.current = planned.widths;
            updatePanelGroup({ widths: planned.widths });
          }
        }
      }
      updatePanelGroup((group) => ({
        checked: group.checked.includes(kind)
          ? group.checked
          : [...group.checked, kind],
        mounted: group.mounted.includes(kind)
          ? group.mounted
          : [...group.mounted, kind],
        active: kind,
      }));
      return true;
    },
    [showPanelHint, updatePanelGroup],
  );

  const handleTogglePanel = useCallback(
    (kind: DesktopPanelKind) => {
      if (panelDisabledRef.current.includes(kind)) return;
      if (checkedPanelsRef.current.includes(kind)) {
        updatePanelGroup((group) => ({
          active: nextActivePanelAfterClose(group.checked, kind, group.active),
          checked: group.checked.filter((k) => k !== kind),
        }));
        // Closing the preview hides the pane but never releases a remote tunnel
        // (scenario 18): the URL stays cached so re-checking shows the same page,
        // and the host keeps the ssh forward alive until the session is deleted.
      } else {
        tryOpenPanel(kind);
      }
    },
    [tryOpenPanel, updatePanelGroup],
  );

  const handleSelectPanel = useCallback(
    (kind: DesktopPanelKind) => {
      updatePanelGroup({ active: kind });
    },
    [updatePanelGroup],
  );

  useEffect(() => {
    togglePanelRef.current = handleTogglePanel;
  }, [handleTogglePanel]);

  // Desktop panel shortcuts (labels in PanelToggleMenu). Shell host instance
  // must not bind — only the focused pane ChatApp (or single-pane layout).
  useEffect(() => {
    if (!isDesktop) return;
    const isShellHost =
      (host?.panes?.length ?? 0) > 0 && paneId === undefined;
    if (isShellHost) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        paneId !== undefined &&
        host?.focusedPaneId &&
        host.focusedPaneId !== paneId
      ) {
        return;
      }
      if (matchNewSessionShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        postToHost({ command: "newSession" });
        return;
      }
      const kind = matchPanelShortcut(event);
      if (!kind) return;
      event.preventDefault();
      event.stopPropagation();
      togglePanelRef.current(kind);
    };

    // Capture so contenteditable / xterm do not swallow the chord first.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isDesktop, host?.panes?.length, host?.focusedPaneId, paneId, postToHost]);

  // Desktop file panel (spec: 文件面板): a file path clicked in a message or
  // terminal opens here instead of the OS. Show the panel immediately with a
  // loading stub; the host reads the file (local fs or over ssh) and replies
  // with desktopFileContent to fill it in. The host is captured per-pane so a
  // split-view sibling's click never resolves against this pane's host.
  // IDE hosts (VSCE/JetBrains) keep the plain openFile RPC that opens the file
  // in the IDE — only the desktop host intercepts the click for the panel.
  const handleOpenFile = useCallback(
    (path: string, startLine?: number, endLine?: number) => {
      if (!path) return;
      if (!isDesktop) {
        vscode.postMessage({ command: "openFile", path, startLine, endLine });
        return;
      }
      if (!tryOpenPanel("file")) return;
      // Re-clicking the file already shown re-reads it (soft refresh: keep the
      // old content until the host reply lands, matching the diff pane).
      updatePanelGroup((group) => ({
        fileView:
          group.fileView && group.fileView.path === path
            ? {
                ...group.fileView,
                loading: true,
                startLine,
                endLine,
              }
            : {
                path,
                host: effectiveHost,
                loading: true,
                startLine,
                endLine,
              },
      }));
      postToHost({
        command: "openFile",
        path,
        host: effectiveHost,
        startLine,
        endLine,
      });
    },
    [isDesktop, tryOpenPanel, effectiveHost, postToHost, vscode, updatePanelGroup],
  );

  const handleRevealInFinder = useCallback(
    (path: string) => {
      if (!isDesktop || !path) return;
      postToHost({ command: "revealInFinder", path });
    },
    [isDesktop, postToHost],
  );

  const handleFileTreeChange = useCallback(
    (next: import("../types").FileTreeState) => {
      updatePanelGroup((group) => ({
        fileTree: {
          ...group.fileTree,
          expanded: next.expanded,
          selected: next.selected,
          width: next.width,
          childrenCache: {
            ...group.fileTree.childrenCache,
            ...next.childrenCache,
          },
        },
      }));
    },
    [updatePanelGroup],
  );

  // Authoritative clamp at drag time: keep the panel within [320, container -
  // other checked panels - conversation minimum].
  const handleDockWidthChange = useCallback((width: number) => {
    let clamped = Math.max(width, PANEL_MIN_WIDTH);
    const containerW =
      chatContainerRef.current?.clientWidth ||
      chatContainerRef.current?.getBoundingClientRect().width;
    if (containerW) {
      clamped = Math.min(clamped, containerW - CHAT_MAIN_MIN_WIDTH);
    }
    const next = {
      preview: clamped,
      diff: clamped,
      terminal: clamped,
      file: clamped,
    };
    panelWidthsRef.current = next;
    updatePanelGroup({ widths: next });
  }, [updatePanelGroup]);

  // Desktop only: open/re-target the preview panel. Clicking a localhost link
  // checks the preview item (refused with a hint when space runs out) and loads
  // the URL. Message.tsx gates on waveHostType, so this never fires in IDE hosts.
  const handleOpenPreview = useCallback(
    (url: string) => {
      if (!tryOpenPanel("preview")) return;
      updatePanelGroup({ previewUrl: url });
    },
    [tryOpenPanel, updatePanelGroup],
  );

  // Remote localhost link handler: open the preview panel (creating it when
  // absent) and forward. The same URL — under any loopback/all-interfaces
  // host spelling — is a no-op unless the previous attempt failed (scenario
  // 15/16). Every other click — a different path, a different origin, another
  // service entirely — just re-targets the panel; tunnels are session-scoped
  // and only die when the session is deleted (scenario 18).
  const handleOpenRemotePreview = useCallback(
    (url: string) => {
      if (!tryOpenPanel("preview")) return;
      // Read the refs, not the state values: this callback is captured by the
      // memoized Message component at mount, so closing over state would freeze
      // the first render's values and break the same-link dedup below.
      const current = currentForwardRef.current;
      if (
        current &&
        canonicalForwardUrl(current.originalUrl) === canonicalForwardUrl(url) &&
        previewForwardErrorRef.current === null
      )
        return;
      updatePanelGroup({ forwardError: null, previewUrl: null });
      acquireForward(effectiveHostRef.current, url);
    },
    [tryOpenPanel, acquireForward, updatePanelGroup],
  );

  // Retry after a failed forward (scenario 16): re-request the same tunnel.
  // The host treats a failed entry as gone, so a fresh forward is established.
  const handleRemotePreviewRetry = useCallback(() => {
    const fwd = currentForwardRef.current;
    if (!fwd) return;
    updatePanelGroup({ forwardError: null });
    acquireForward(fwd.host, fwd.originalUrl);
  }, [acquireForward, updatePanelGroup]);

  const openPreviewHandler =
    effectiveHost !== "local" ? handleOpenRemotePreview : handleOpenPreview;

  // No workdir: all panels disabled. With a workdir (incl. draft + host
  // folder): all panel kinds available; state is shared per workdir.
  const panelDisabled: DesktopPanelKind[] = useMemo(() => {
    if (!isDesktop) return [];
    if (!panelWorkdir) return [...PANEL_ORDER];
    return [];
  }, [isDesktop, panelWorkdir]);

  useEffect(() => {
    panelDisabledRef.current = panelDisabled;
  }, [panelDisabled]);

  // Report this pane's toggle state so the desktop app menu's 面板 checkboxes
  // reflect the focused pane.
  useEffect(() => {
    if (!isDesktop) return;
    postToHost({ command: "desktopPanelState", checked: checkedPanels });
  }, [checkedPanels, isDesktop, postToHost]);

  const dockMaxWidth = chatColumnWidth - CHAT_MAIN_MIN_WIDTH;

  // Persist a clamp when the pane shrinks (window resize / split) so the next
  // drag/open starts from a width that still fits beside the conversation.
  useEffect(() => {
    if (!isDesktop || checkedPanels.length === 0) return;
    if (!(dockMaxWidth > 0)) return;
    const current = panelWidthsRef.current[activePanel ?? "preview"];
    if (!(current > dockMaxWidth)) return;
    const clamped = Math.max(PANEL_MIN_WIDTH, dockMaxWidth);
    const next = {
      preview: clamped,
      diff: clamped,
      terminal: clamped,
      file: clamped,
    };
    panelWidthsRef.current = next;
    updatePanelGroup({ widths: next });
  }, [
    isDesktop,
    checkedPanels.length,
    activePanel,
    dockMaxWidth,
    updatePanelGroup,
  ]);

  const renderPanelSlot = (kind: DesktopPanelKind) => {
    const dockWidth =
      panelWidths[activePanel ?? kind] ?? PANEL_DEFAULT_WIDTH;
    const common = {
      width: dockWidth,
      onWidthChange: handleDockWidthChange,
      maxWidth: dockMaxWidth,
      onClose: () => handleTogglePanel(kind),
    };

    // Empty preview (no URL yet) reuses the same left-edge resize handle so it
    // can be widened like the loaded preview/diff/terminal panels.
    const onEmptyPreviewDragStart = (e: React.MouseEvent) => {
      e.preventDefault();
      const handle = e.currentTarget as HTMLElement;
      handle.style.background = "var(--accent-9)";
      document.body.classList.add("is-panel-resizing");
      const rect = handle.parentElement?.getBoundingClientRect();
      const onMove = (ev: MouseEvent) => {
        const next = (rect?.right ?? 0) - ev.clientX;
        common.onWidthChange(
          Math.min(Math.max(next, PANEL_MIN_WIDTH), common.maxWidth),
        );
      };
      const onUp = () => {
        handle.style.background = "";
        document.body.classList.remove("is-panel-resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    if (kind === "preview") {
      return previewUrl ? (
        <PreviewPane
          key={previewEpoch}
          url={previewUrl}
          originalUrl={currentForward?.originalUrl}
          onRetry={currentForward ? handleRemotePreviewRetry : undefined}
          vscode={vscode}
          onAddComment={handleAddComment}
          {...common}
        />
      ) : (
        <aside
          className="preview-pane"
          style={{ width: common.width }}
          data-testid="preview-pane-empty"
        >
          <div
            className="preview-pane-drag-handle"
            onMouseDown={onEmptyPreviewDragStart}
          />
          <div className="preview-pane-inner">
            <div className="preview-pane-toolbar">
              <span className="preview-pane-url">浏览器</span>
            </div>
            <div className="desktop-panel-placeholder">
              {previewForwardError ? (
                <>
                  <span>远程预览加载失败：{previewForwardError}</span>
                  <button
                    className="preview-pane-button"
                    data-testid="preview-forward-retry"
                    onClick={handleRemotePreviewRetry}
                  >
                    重试
                  </button>
                </>
              ) : (
                <>点击消息或终端中的 localhost 链接加载预览</>
              )}
            </div>
          </div>
        </aside>
      );
    }
    if (kind === "diff") {
      return (
        <DiffPane
          vscode={vscode}
          paneId={paneId}
          visible={checkedPanels.includes("diff")}
          isStreaming={state.isStreaming}
          sessionId={state.currentSession?.id}
          workdir={effectiveWorkdir}
          onAddComment={handleAddComment}
          {...common}
        />
      );
    }
    if (kind === "file") {
      return (
        <FilePane
          fileView={fileView}
          workdir={effectiveWorkdir}
          vscode={vscode}
          fileTree={fileTree}
          onFileTreeChange={handleFileTreeChange}
          onOpenFile={handleOpenFile}
          onRevealInFinder={handleRevealInFinder}
          {...common}
        />
      );
    }
    return (
      <TerminalPane
        vscode={vscode}
        paneId={paneId}
        visible={checkedPanels.includes("terminal")}
        workdir={effectiveWorkdir}
        onOpenPreview={openPreviewHandler}
        {...common}
      />
    );
  };

  const showNewSessionPage = isDesktop && isDraftSession && state.initialized;

  const messageInput = (
    <MessageInput
      ref={messageInputRef}
      onSendMessage={handleSendMessage}
      isStreaming={state.isStreaming}
      onAbortMessage={handleAbortMessage}
      onSubmitQueuedEdit={handleSubmitQueuedEdit}
      editingQueuedId={state.editingQueuedId}
      onCancelQueuedEdit={handleCancelQueuedEdit}
      shouldClearInput={state.shouldClearInput}
      onInputCleared={handleInputCleared}
      vscode={vscode}
      selection={state.selection}
      inputContent={state.inputContent}
      sessionId={state.currentSession?.id}
      permissionMode={state.permissionMode}
      initialAttachedImages={state.attachedImages}
      disabled={
        host?.type === "desktop" && !effectiveWorkdir && !isDraftSession
      }
      modelId={
        (state.currentSession as { model?: string } | undefined)?.model
      }
      onModelChange={handleSessionModelChange}
      workdir={effectiveWorkdir ?? panelWorkdir}
      workdirSelector={
        host?.type === "desktop" ? (
          isDraftSession ? (
            <>
              <DesktopWorkdirSelector
                host={effectiveHost}
                workdir={effectiveWorkdir}
                recentWorkdirs={host.recentWorkdirs}
                onSelectWorkdir={host.onSelectWorkdir}
                onSelectRecentWorkdir={host.onSelectRecentWorkdir}
                onRemoveRecentWorkdir={host.onRemoveRecentWorkdir}
              />
              {effectiveWorkdir &&
                gitBranches &&
                gitBranches.branches.length > 0 && (
                <DesktopWorktreeControls
                  branches={gitBranches.branches}
                  branch={worktreeBranch || gitBranches.current}
                  worktreeChecked={worktreeChecked}
                  onBranchChange={(branch) =>
                    patchPane({ worktreeBranch: branch })
                  }
                  onWorktreeChange={(checked) =>
                    patchPane({ worktreeChecked: checked })
                  }
                />
              )}
            </>
          ) : (
            <DesktopGitContext
              branch={
                (state.currentSession as { worktreeBranch?: string } | undefined)
                  ?.worktreeBranch ||
                gitBranches?.current ||
                undefined
              }
              worktreeName={
                (state.currentSession as { worktreeName?: string } | undefined)
                  ?.worktreeName
              }
            />
          )
        ) : undefined
      }
      rewindPopup={
        <RewindPopup
          isVisible={rewindPopupOpen}
          isLoading={rewindCheckpointsLoading}
          checkpoints={rewindCheckpoints}
          onSelect={handleRewindCheckpointSelect}
          onClose={handleRewindPopupClose}
        />
      }
      modelPopup={
        <ModelPopup
          isVisible={modelPopupOpen}
          isLoading={modelLoading}
          models={configuredModels}
          currentModel={currentModel}
          onSelect={handleModelSelect}
          onClose={handleModelPopupClose}
        />
      }
      btwPopup={
        btwPanel ? (
          <BtwPanel
            question={btwPanel.question}
            answer={btwPanel.answer}
            isLoading={btwPanel.loading}
            onClose={handleBtwClose}
          />
        ) : undefined
      }
    />
  );

  const newSessionPage = (
    <NewSessionPage
      welcome={
        <WelcomeView
          embedded
          isAuthenticated={state.isAuthenticated}
          hasDirectConnectConfig={
            !!(
              state.configurationData?.apiKey &&
              state.configurationData?.baseURL
            )
          }
          onLogin={handleLogin}
        />
      }
      composer={messageInput}
    />
  );

  const chatBodyContent = state.isRestoring ? (
    // Desktop restore in progress: the pane already switched to the target
    // session — show the sweep animation over the message + input area until
    // the host finishes connecting and replaying the transcript (spec 场景 7).
    <div
      className="chat-restoring-overlay"
      data-testid="chat-restoring-overlay"
    >
      <LoadingLogo />
    </div>
  ) : (
    <>
      {showWelcomeReady ? (
        <WelcomeView
          isAuthenticated={state.isAuthenticated}
          hasDirectConnectConfig={
            !!(
              state.configurationData?.apiKey &&
              state.configurationData?.baseURL
            )
          }
          onLogin={handleLogin}
        />
      ) : showWelcome ? (
        <LoadingLogo />
      ) : (
        <MessageList
          ref={messageListRef}
          messages={state.messages}
          queuedMessages={state.queuedMessages}
          isStreaming={state.isStreaming}
          isCompacting={state.isCompacting}
          vscode={vscode}
          onRewindToMessage={handleRewindToMessage}
          workdir={state.workdir}
          onOpenPreview={openPreviewHandler}
          onOpenFile={handleOpenFile}
          onOpenAgentTranscript={handleOpenAgentTranscript}
        />
      )}

      <div
        className={`input-area-container${isDesktop && state.pendingConfirmations.length > 0 ? " input-area-container--confirm" : ""}`}
      >
        <div
          style={{
            display: state.pendingConfirmations.length === 0 ? "block" : "none",
          }}
        >
          <TaskList
            // 按会话 id 重挂载：切换会话时重置“观察过未完成任务”的跟踪，
            // 使全部已完成的新会话立即隐藏，而不是沿用上一会话的 5 秒宽限
            key={state.currentSession?.id}
            tasks={state.tasks}
            isCollapsed={state.isTaskListCollapsed}
            onToggleCollapse={() =>
              dispatch({ type: "TOGGLE_TASK_LIST_COLLAPSE" })
            }
          />
          <QueuedMessageList
            queuedMessages={state.queuedMessages}
            isCollapsed={state.isQueueCollapsed}
            onToggleCollapse={() => dispatch({ type: "TOGGLE_QUEUE_COLLAPSE" })}
            onEdit={handleEditQueuedMessage}
            onSend={handleSendQueuedMessage}
            onDelete={handleDeleteQueuedMessage}
            editingQueuedId={state.editingQueuedId}
            vscode={vscode}
          />
        </div>

        <div
          style={{
            display: state.pendingConfirmations.length === 0 ? "block" : "none",
          }}
        >
          {messageInput}
        </div>

        {state.pendingConfirmations.length > 0 && (
          <ConfirmationDialog
            key={state.pendingConfirmations[0].confirmationId}
            data-confirmation-id={state.pendingConfirmations[0].confirmationId}
            confirmation={state.pendingConfirmations[0]}
            onConfirm={handleConfirmation}
            onReject={handleRejection}
          />
        )}
      </div>
    </>
  );

  // Dialogs render at the component root — not inside chatContainer — so they
  // stay visible in every layout: the desktop split-view shell (where the root
  // ChatApp never mounts its own chatContainer) still shows the config dialog
  // opened from the sidebar 更多 menu.
  const dialogs = (
    <>
      {state.activeDialog === "config" && (
        <ConfigDialog
          configurationData={state.configurationData || {}}
          isLoading={state.configurationLoading}
          error={state.configurationError}
          onSave={handleConfigurationSave}
          onCancel={handleDialogClose}
          projectSettings={state.projectSettings}
          onLoadProjectSettings={() =>
            postToHost({ command: "getProjectSettings" })
          }
          onToggleBuiltinPlugin={(pluginId, enabled) =>
            postToHost({
              command: "setBuiltinPluginEnabled",
              pluginId,
              enabled,
              scope: "project",
            })
          }
          vscode={vscode}
        />
      )}
      {state.activeDialog === "plugin" && (
        <PluginDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {state.activeDialog === "mcp" && (
        <McpDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {state.activeDialog === "status" && (
        <StatusDialog
          onClose={handleDialogClose}
          vscode={vscode}
          isDesktop={isDesktop}
        />
      )}
      {state.activeDialog === "tasks" && (
        <BackgroundTaskManager
          tasks={state.backgroundTasks}
          vscode={vscode}
          onClose={handleDialogClose}
        />
      )}
      {state.activeDialog === "workflows" && (
        <WorkflowManager
          runs={state.workflowRuns}
          vscode={vscode}
          onCancel={handleDialogClose}
          onOpenFile={(path) => {
            handleOpenFile(path);
            handleDialogClose();
          }}
        />
      )}
      {state.activeDialog === "agents" && (
        <AgentsDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {agentTranscript && (
        <AgentTranscriptPopup
          title={agentTranscript.title}
          messages={resolveSubagentMessages(
            state.subagentMessages,
            state.agentToolSubagentIds,
            agentTranscript.subagentId,
            {
              nestedMessages: agentTranscript.nestedMessages,
              fallbackText: agentTranscript.fallbackText,
              prompt: agentTranscript.prompt,
            },
          )}
          vscode={vscode}
          onClose={handleCloseAgentTranscript}
        />
      )}
      {pendingRewindId && (
        <ConfirmDialog
          title="确定要回滚到此消息吗？"
          description="这将删除之后的所有消息并撤销相关的文件更改。"
          onConfirm={handleRewindConfirm}
          onCancel={() => patchPane({ pendingRewindId: null })}
        />
      )}
      <ToastStack
        toasts={toasts}
        onDismiss={handleToastDismiss}
        onAction={handleToastAction}
      />
    </>
  );

  const chatChrome = (
    <>
      <ChatHeader
        onNewSession={handleClearChat}
        newSessionDisabled={false}
        onAbortMessage={handleAbortMessage}
        messages={state.messages}
        sessions={state.sessions}
        currentSession={state.currentSession}
        onSessionSelect={handleSessionSelect}
        sessionsLoading={state.sessionsLoading}
        onOpenSettings={handleOpenSettings}
        onLogin={handleLogin}
        onLogout={handleLogout}
        isAuthenticated={state.isAuthenticated}
        hideSessionButtons={isDesktop}
        hideMoreButton={isDesktop}
        panelToggle={
          isDesktop && checkedPanels.length === 0
            ? {
                checked: checkedPanels,
                onToggle: handleTogglePanel,
                disabled: panelDisabled,
              }
            : undefined
        }
      />
      {chatBodyContent}
    </>
  );

  const chatContainer = (
    <div
      className="chat-container"
      data-testid="chat-container"
      ref={isDesktop ? chatContainerRef : undefined}
    >
      {queueEditWarning && (
        <div
          className="queue-edit-warning-banner"
          role="alert"
          data-testid="queue-edit-warning"
        >
          <span className="queue-edit-warning-text">{queueEditWarning}</span>
          <button
            className="queue-edit-warning-close"
            onClick={() => patchPane({ queueEditWarning: null })}
            aria-label="关闭"
          >
            <i className="codicon codicon-close"></i>
          </button>
        </div>
      )}
      {isDesktop ? (
        <div className="desktop-chat-body">
          <div className="desktop-chat-main">
            {isDraftSession && !state.initialized ? (
              <LoadingLogo />
            ) : showNewSessionPage ? (
              newSessionPage
            ) : (
              chatChrome
            )}
          </div>
          {!isDraftSession && checkedPanels.length > 0 && activePanel && (
            <DesktopPanelDock
              checked={checkedPanels}
              active={activePanel}
              onSelect={handleSelectPanel}
              onCloseTab={handleTogglePanel}
              panelToggle={{
                checked: checkedPanels,
                onToggle: handleTogglePanel,
                disabled: panelDisabled,
              }}
              width={Math.min(
                panelWidths[activePanel] ?? PANEL_DEFAULT_WIDTH,
                Math.max(PANEL_MIN_WIDTH, dockMaxWidth),
              )}
              onWidthChange={handleDockWidthChange}
              maxWidth={Math.max(PANEL_MIN_WIDTH, dockMaxWidth)}
            >
              {PANEL_ORDER.filter((kind) => mountedPanels.includes(kind)).map(
                (kind) => (
                  <div
                    key={kind}
                    className="desktop-panel-slot"
                    style={{
                      display:
                        checkedPanels.includes(kind) && kind === activePanel
                          ? undefined
                          : "none",
                    }}
                  >
                    {renderPanelSlot(kind)}
                  </div>
                ),
              )}
            </DesktopPanelDock>
          )}
        </div>
      ) : (
        chatChrome
      )}
    </div>
  );

  if (host?.type === "desktop") {
    // FR-032 split-view: when the host has pushed a pane layout, DesktopShell
    // owns the row of paneId-scoped ChatApp instances. This instance then only
    // contributes its pane-scoped chatContainer (rendered below); without a
    // paneId it would double-render, so bail out to the shell instead.
    if ((host.panes?.length ?? 0) > 0 && paneId === undefined) {
      return (
        <>
          <DesktopShell
            vscode={vscode}
            host={host}
            onOpenSettings={handleOpenSettings}
          />
          {dialogs}
        </>
      );
    }
    // Inside DesktopShell each pane renders only its own chatContainer; the
    // sidebar / preview pane live in the shell / single-pane layout.
    if (paneId !== undefined) {
      return (
        <>
          {chatContainer}
          {dialogs}
        </>
      );
    }
    return (
      <div className="desktop-layout">
        <DesktopSidebar
          onNewSession={handleDesktopNewSession}
          onNewSessionInPane={() =>
            postToHost({ command: "desktopNewSessionInPane" })
          }
          onNewSessionInWorkdir={handleDesktopNewSessionInWorkdir}
          isStreaming={state.isStreaming}
          disabled={false}
          onOpenSettings={handleOpenSettings}
          {...resolveSidebarSessions({ sessionTree: host.sessionTree })}
          currentSessionId={state.currentSession?.id}
          onSelectSession={host.onSelectSession}
          onOpenPane={host.onOpenPane}
          onDeleteSession={host.onDeleteSession}
          onTogglePin={host.onTogglePin}
          onRenameSession={host.onRenameSession}
          onOpenInEditor={(workdir) =>
            postToHost({ command: "desktopOpenInEditor", workdir })
          }
          onOpenInTerminal={(workdir) =>
            postToHost({ command: "desktopOpenInTerminal", workdir })
          }
        />
        {chatContainer}
        {dialogs}
      </div>
    );
  }

  return (
    <>
      {chatContainer}
      {dialogs}
    </>
  );
};
