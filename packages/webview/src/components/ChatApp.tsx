import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MessageInputHandle } from "./chat/MessageInput";
import {
  AssistantNotice,
  useAssistantHomeVisible,
} from "./assistant/museBotNotice";
import {
  DesktopSidebar,
  resolveSidebarSessions,
} from "./desktop/DesktopSidebar";
import { DesktopSessionList } from "./desktop/DesktopSessionList";
import { DesktopShell } from "./desktop/DesktopShell";
import { ChatContainer } from "./chat/ChatContainer";
import { AutomationsPage } from "./automation/AutomationsPage";
import { SkillsPage } from "./skills/SkillsPage";
import { AssistantPage } from "./assistant/AssistantPage";
import { Tooltip } from "./shared/Tooltip";
import {
  BotTabs,
  useBotWorkspace,
  useBotWorkspaceController,
  type BotWorkspaceContextValue,
} from "./desktop/BotTabs";
import {
  BOT_MESSAGE_COLUMN_MAX,
  botListsColumnWidth,
  botListsWideForPanel,
  BotLists,
  readBotQueue,
  useBotListsWide,
  type BotListQueueItem,
} from "./desktop/BotLists";
import {
  issueTabSessionId,
  sessionActionLabel,
  type PanelSelection,
} from "./desktop/botWorkspace";
import { DockDetail } from "./desktop/DockDetail";
import { ChatBody } from "./chat/ChatBody";
import { ChatComposer } from "./chat/ChatComposer";
import { PanelToggleControl } from "./panels/PanelToggleControl";
import { ChatDialogs, type ChatDialogsProps } from "./dialogs/ChatDialogs";
import ConfigDialog, {
  settingsPageLeaveBlocked,
  type ConfigDialogHandle,
} from "./dialogs/ConfigDialog";
import { registerDesktopSettingsOpener } from "../muse/desktopSettingsNav";
import { NewIssueDialog } from "./issue/NewIssueDialog";
import { OpenPlanningDialog } from "./issue/OpenPlanningDialog";
import {
  IssueSessionHeader,
  type IssueViewTab,
} from "./issue/IssueSessionHeader";
import {
  issueGroupActivity,
  issueSessionBusy,
} from "./session/SessionStatusGlyph";
import {
  findIssueGroupForSession,
  isSplitIssueGroup,
  issueGroupSessionWorkdir,
  resolveIssuePlanningSessionId,
} from "../utils/issueGroups";
import {
  DesktopPanelSlots,
  type DesktopPanelSlotsProps,
} from "./desktop/DesktopPanelSlots";
import {
  useProvidedShellSurface,
  useShellSurface,
  type ShellSurface,
} from "./desktop/shellSurface";
import { useScenarioModelsStore } from "../stores/scenarioModelsStore";
import { MuseApiClient } from "../muse/apiClient";
import { resolveDraftModel } from "../muse/defaultModel";
import { resolveMuseServerUrl } from "../muse/hostBridge";
import type { WorkspaceDiffFile } from "./panels/DiffPane";
import { prefetchTerminalLib } from "./panels/TerminalPane";
import {
  DESKTOP_SIDEBAR_WIDTH,
  SPLIT_ISSUE_MIN_WIDTH,
  chatMainMinWidth,
  clampSplitLeftWidth,
  paneHasSidebarInset,
} from "../muse/layout";
import { useDesktopSidebarCollapsed } from "../hooks/useDesktopSidebarCollapsed";
import { useDesktopSessionListWidth } from "../hooks/useDesktopSidebarWidth";
import { DesktopSidebarToggle } from "./desktop/DesktopSidebarToggle";
import { useMuseTheme } from "../ui/theme";
import museM from "../assets/muse-m.png";
import "../styles/WelcomeView.css";
import type {
  ChatAppProps,
  DesktopPanelKind,
  DiffViewState,
  Message,
} from "../types";
import { chatReducer, initialState } from "../reducers/chatReducer";
import { DOCK_DETAIL_TAB, PANEL_ADD_ORDER } from "../muse/panelTabs";
import {
  DOCK_TAB_DETAIL_KEY,
  defaultDockTabKeys,
  fileTabKey,
  insertTabAfterCurrent,
  kindTabKey,
  toolTabKey,
} from "../muse/dockTabOrder";
import {
  activePreviewTool,
  appendDockTool,
  botDockChromeChecked,
  botToolTermId,
  createDockToolId,
  nextDockToolId,
  patchDockTool,
  removeDockTool,
} from "../muse/dockTools";
import { openFileTab, pinFileTab, selectFileTab } from "../muse/fileTabs";
import { firstOpenDockWidths } from "../muse/panelFit";
import { restoredDockAlreadyOpen, takeRestoredFileLoads } from "../muse/botPageState";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  EMPTY_DOCK_TOOLS,
  EMPTY_TAB_ORDER,
  PANEL_DEFAULT_WIDTH,
  emptyContentSearchState,
  resolvePanelGroup,
  usePanelGroup,
  usePanelGroupStore,
  usePaneUi,
  type DockToolInstance,
  type PanelGroupState,
} from "../stores";
import { applyCloseFileTab } from "../stores/panelGroupStore";
import { dedupeSnapshotsByFile } from "../utils/fileHistorySnapshots";
import { createMessageHandler } from "../muse/messageRouter";

const EMPTY_LISTING_CACHE: PanelGroupState["fileTree"]["childrenCache"] = {};
const EMPTY_LISTING_SEARCH = emptyContentSearchState();
const EMPTY_FILE_TABS: PanelGroupState["fileTabs"] = [];
const EMPTY_EXPANDED: string[] = [];

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
import { useChatAppCore } from "../hooks/useChatAppCore";
import { useChatSend } from "../hooks/useChatSend";
import { usePanels } from "../hooks/usePanels";
import { useFilePanel } from "../hooks/useFilePanel";
import { usePreview } from "../hooks/usePreview";
import { useRewind } from "../hooks/useRewind";
import { useDialogs } from "../hooks/useDialogs";
import "../styles/ChatApp.css";

const EMPTY_RECENT_DIFF_FILES: WorkspaceDiffFile[] = [];

export { prunePanelGroupCache } from "../stores";

function AssistantWelcome() {
  const { effective } = useMuseTheme();
  const showLogo = effective !== "light";
  return (
    <div className="assistant-welcome">
      <h1 className="welcome-headline" data-testid="welcome-headline">
        {showLogo ? (
          <img
            src={museM}
            alt=""
            className="welcome-headline-logo"
            width={64}
            height={64}
            draggable={false}
          />
        ) : null}
        今天想让我帮你做些什么？
      </h1>
    </div>
  );
}

/** 主内容区视图：chat 需要结合当前会话（state.currentSession）渲染。 */
export type MainView = "newChat" | "chat" | "automations" | "skills" | "assistant";

type ChatAppInnerProps = ChatAppProps & {
  workspace: BotWorkspaceContextValue;
};

export const ChatApp: React.FC<ChatAppProps> = (props) => {
  const providedWorkspace = useBotWorkspace();
  if (providedWorkspace) {
    return <ChatAppInner {...props} workspace={providedWorkspace} />;
  }
  return <ChatAppWorkspaceOwner {...props} />;
};

/** 没有 provider 时只在这个子组件里挂 controller，避免和已有 context 同时调用。 */
const ChatAppWorkspaceOwner: React.FC<ChatAppProps> = (props) => {
  const issueIds = useMemo(
    () => props.host?.issueGroups?.map((group) => group.issueId),
    [props.host?.issueGroups],
  );
  const ownedWorkspace = useBotWorkspaceController(
    props.host?.issueGroups?.[0]?.issueId ?? null,
    issueIds,
  );
  return <ChatAppInner {...props} workspace={ownedWorkspace} />;
};

const ChatAppInner: React.FC<ChatAppInnerProps> = ({
  vscode,
  host,
  paneId,
  workspace,
}) => {
  const museApi = useMemo(
    () => new MuseApiClient({ baseUrl: resolveMuseServerUrl() }),
    [],
  );
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
    worktreeBranch,
    worktreeChecked,
    paneGitBranches,
  } = paneUi;
  // Desktop new sessions start with workdir=null. Host bridge syncs
  // updateWorkdir on activate / folder pick / auto-create. Fall back to
  // host.workdir only for bound (non-draft) sessions when state has not
  // caught up yet.
  const isDraftSession =
    !state.currentSession?.id || state.currentSession.id === "__draft__";
  const effectiveWorkdir = isDraftSession
    ? state.workdir
    : (state.workdir ?? host?.workdir);
  // Local-only for now (remote hosts removed from the composer).
  const effectiveHost = "local";
  const gitBranches = paneGitBranches;
  const sessionGitMeta = state.currentSession as
    | {
        worktreeBranch?: string;
        worktreeName?: string;
        baseBranch?: string;
      }
    | undefined;
  const headerGitContext =
    !isDraftSession
      ? {
          branch:
            gitBranches?.current || sessionGitMeta?.worktreeBranch || undefined,
          worktreeName: sessionGitMeta?.worktreeName,
          workdir: effectiveWorkdir,
        }
      : undefined;
  // 无窗格桌面就是单栏布局：图标栏默认落在 Muse Bot。有窗格时由 DesktopShell 管。
  const noPaneDesktop =
    host?.type === "desktop" &&
    paneId === undefined &&
    (host.panes?.length ?? 0) === 0;
  // 主内容区视图：聊天 / 新会话页 / 自动化 / Muse Bot。
  const [view, setView] = useState<MainView>(noPaneDesktop ? "assistant" : "chat");
  // 图标选中态不跟会话推送走。助理面上的会话推送也不能把视图拉回普通聊天。
  const [noPaneRail, setNoPaneRail] = useState<ShellSurface>("assistant");
  const settingsPageRef = useRef<ConfigDialogHandle>(null);
  useLayoutEffect(() => {
    if (!noPaneDesktop) return;
    return registerDesktopSettingsOpener(() => {
      setNoPaneRail("settings");
    });
  }, [noPaneDesktop]);
  const shellSurface = useShellSurface();
  const providedShellSurface = useProvidedShellSurface();
  const issueTitles: Record<string, string> = {};
  for (const group of host?.issueGroups ?? []) {
    issueTitles[group.issueId] = group.title;
  }
  const [assistantWorkdir, setAssistantWorkdir] = useState<string | undefined>();
  const [assistantSessionId, setAssistantSessionId] = useState<string | undefined>();
  const assistantVisible =
    host?.type === "desktop" &&
    (paneId !== undefined
      ? providedShellSurface === "assistant" &&
        (host.focusedPaneId ?? paneId) === paneId
      : (host.panes?.length ?? 0) === 0 &&
        view === "assistant" &&
        noPaneRail === "assistant");
  const [botComposerFocused, setBotComposerFocused] = useState(false);
  // 分栏时 Muse Bot 标签被锁住，进不了主页。左侧输入框聚焦才算回到这条会话。
  useAssistantHomeVisible(
    assistantVisible && (workspace.active === "bot" || botComposerFocused),
  );
  useEffect(() => {
    if (!assistantVisible) return;
    let cancelled = false;
    void museApi
      .getAssistantSession()
      .then((info) => {
        if (cancelled) return;
        if (info.workdir) setAssistantWorkdir(info.workdir);
        if (info.sessionId) setAssistantSessionId(info.sessionId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [assistantVisible, museApi]);
  const botListsWide = useBotListsWide();
  const [botSwitchHost, setBotSwitchHost] = useState<HTMLDivElement | null>(null);
  const [botMenu, setBotMenu] = useState<"queue" | "todo" | null>(null);
  const [botQueue, setBotQueue] = useState<BotListQueueItem[]>([]);
  useEffect(() => {
    if (!assistantVisible) return;
    let cancelled = false;
    let sawPush = false;
    const apply = (items: unknown) => {
      if (!cancelled && Array.isArray(items)) setBotQueue(readBotQueue(items));
    };
    void museApi
      .listAssistantQueue()
      .then((page) => {
        if (sawPush) return;
        apply(page.items);
      })
      .catch(() => undefined);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { command?: string; items?: unknown };
      if (data?.command !== "assistant:queue") return;
      sawPush = true;
      apply(data.items);
    };
    window.addEventListener("message", onMessage);
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
    };
  }, [assistantVisible, museApi]);
  const issueActivityById = new Map(
    (host?.issueGroups ?? []).map((group) => [
      group.issueId,
      issueGroupActivity(group, {
        currentSessionId: state.currentSession?.id,
        isStreaming: state.isStreaming,
      }),
    ]),
  );
  const botIssues = (host?.issueGroups ?? []).map((group) => {
    const activity = issueActivityById.get(group.issueId);
    const presence = activity?.presence ?? null;
    return {
      issueId: group.issueId,
      title: group.title,
      priority: group.priority,
      type: group.type,
      presence:
        presence === "unread" && !workspace.openIssueIds.includes(group.issueId)
          ? null
          : presence,
      statusLabel: activity?.label,
      openLabel: issueTabSessionId(group)
        ? sessionActionLabel(workspace, group.issueId)
        : null,
    };
  });
  const issueTabPresence: Record<string, ReturnType<typeof issueGroupActivity>["presence"]> = {};
  for (const [issueId, activity] of issueActivityById) {
    issueTabPresence[issueId] = activity.presence;
  }
  const clearIssueUnreadRef = useRef<(issueId: string) => void>(() => {});
  useEffect(() => {
    if (host?.type !== "desktop") return;
    const closed = new Set(
      (host.closedIssueGroups ?? []).map((group) => group.issueId),
    );
    if (closed.size === 0) return;
    const bound = new Set(workspace.openIssueIds);
    if (workspace.panel.kind === "issue") bound.add(workspace.panel.issueId);
    if (workspace.lastIssueId) bound.add(workspace.lastIssueId);
    for (const issueId of bound) {
      if (closed.has(issueId)) workspace.closeIssueTab(issueId);
    }
  }, [host?.type, host?.closedIssueGroups, workspace]);
  const selectBotPanel = useCallback(
    (panel: Exclude<PanelSelection, { kind: "none" }>) => {
      workspace.selectPanel(panel);
      setBotMenu(null);
      if (panel.kind === "issue") clearIssueUnreadRef.current(panel.issueId);
    },
    [workspace],
  );
  const [threeColumnsOn, setThreeColumnsOn] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  useEffect(() => {
    if (workspace.openIssueIds.length === 0) setThreeColumnsOn(false);
  }, [workspace.openIssueIds.length]);
  const openIssueGroup =
    workspace.active === "bot"
      ? undefined
      : (host?.issueGroups ?? []).find((group) => group.issueId === workspace.active);
  const splitIssueId = !threeColumnsOn
    ? null
    : workspace.active !== "bot" && workspace.openIssueIds.includes(workspace.active)
      ? workspace.active
      : workspace.lastIssueId && workspace.openIssueIds.includes(workspace.lastIssueId)
        ? workspace.lastIssueId
        : (workspace.openIssueIds[workspace.openIssueIds.length - 1] ?? null);
  const splitIssueGroup = splitIssueId
    ? (host?.issueGroups ?? []).find((group) => group.issueId === splitIssueId)
    : undefined;
  const threeColumns = Boolean(splitIssueGroup);
  // 两栏时主栏只显示当前标签。三栏时中间固定是一条事项会话，即使焦点在 Muse Bot。
  const shownIssueGroup = threeColumns ? splitIssueGroup : openIssueGroup;
  // 分栏时中间会话和右侧当前事项可能不是同一条。输入框聚焦后，把当前事项切回这条会话。
  const focusShownIssueFromSender = useCallback(() => {
    if (!threeColumns || !shownIssueGroup) return;
    const issueId = shownIssueGroup.issueId;
    const panel = workspace.panel;
    if (
      workspace.active === issueId &&
      panel.kind === "issue" &&
      panel.issueId === issueId
    ) {
      return;
    }
    workspace.focusTab(issueId);
    clearIssueUnreadRef.current(issueId);
  }, [threeColumns, shownIssueGroup, workspace]);
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
  const [issueTranscript, setIssueTranscript] = useState<
    | {
        sessionId: string;
        status: "ready";
        messages: Message[];
        hasMore: boolean;
      }
    | { sessionId: string; status: "error" }
    | null
  >(null);
  const [issueTranscriptAttempt, setIssueTranscriptAttempt] = useState(0);
  const issueTranscriptRef = useRef(issueTranscript);
  issueTranscriptRef.current = issueTranscript;
  const requestedOlderIssueRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    requestedOlderIssueRef.current = undefined;
  }, [openIssueSessionId]);
  useEffect(() => {
    if (!assistantVisible || !openIssueSessionId) return;
    let cancelled = false;
    const sessionId = openIssueSessionId;
    const load = () => {
      void museApi
        .getMessages(sessionId)
        .then((page) => {
          if (cancelled) return;
          const incoming = page.messages as Message[];
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
  }, [assistantVisible, openIssueSessionId, museApi, issueTranscriptAttempt]);
  const openIssueTranscript =
    issueTranscript && issueTranscript.sessionId === openIssueSessionId
      ? issueTranscript
      : null;
  const issueSessionLive =
    Boolean(openIssueSessionId) && state.currentSession?.id === openIssueSessionId;
  const issueShowsLive = issueSessionLive && state.messages.length > 0;
  const shownIssueMessages = issueShowsLive
    ? state.messages
    : openIssueTranscript?.status === "ready"
      ? openIssueTranscript.messages
      : [];
  const issueTranscriptReady = openIssueTranscript?.status === "ready";
  const issueTranscriptFailed = openIssueTranscript?.status === "error";
  const issueShowWelcome =
    shownIssueMessages.length === 0 && (issueShowsLive || issueTranscriptReady);
  const issueStreaming = issueShowsLive
    ? state.isStreaming
    : Boolean(
        shownIssueGroup &&
          issueSessionBusy(shownIssueGroup, openIssueSessionId, {
            currentSessionId: state.currentSession?.id,
            isStreaming: state.isStreaming,
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
      const before = state.messages[0]?.id;
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
        const older = page.messages as Message[];
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
  // Desktop only: panel group is keyed by absolute workdir (not session).
  // Fall back to host.workdir so a draft with a selected folder still shares
  // the same dock as sessions in that directory. On Muse Bot, 变更 follows
  // the selected issue. 文件预览 opened on this page stays on the bot's own
  // bar and survives an issue switch. A file opened from the issue transcript
  // stays with that issue. The file tree still shows the current issue's
  // directory. 终端 and 浏览器 are bot-level tabs: switching issues does not
  // swap or close them, and each one can be opened more than once. A new
  // terminal starts in the current issue workdir. 会话 stays on the open
  // session's directory, including its own terminal and browser. The column
  // width and open flag stay on the assistant key, so Muse Bot and 会话 share
  // one dock width.
  const dockIssueId =
    workspace.panel.kind === "issue" ? workspace.panel.issueId : workspace.lastIssueId;
  const dockIssueGroup = dockIssueId
    ? (host?.issueGroups ?? []).find((group) => group.issueId === dockIssueId)
    : undefined;
  const onSessionsSurface =
    host?.type === "desktop" &&
    (paneId !== undefined
      ? providedShellSurface === "sessions"
      : noPaneRail === "sessions");
  const sessionPanelWorkdir = effectiveWorkdir ?? host?.workdir ?? undefined;
  const dockWorkdir = dockIssueGroup
    ? issueGroupSessionWorkdir(
        dockIssueGroup,
        issueTabSessionId(dockIssueGroup) ?? "",
        host?.workdir,
      )
    : onSessionsSurface
      ? sessionPanelWorkdir
      : assistantWorkdir;
  const panelWorkdir = assistantVisible ? dockWorkdir : sessionPanelWorkdir;
  const followIssueTools = assistantVisible || onSessionsSurface;
  const groupKey =
    dockIssueGroup && dockWorkdir
      ? dockWorkdir
      : assistantVisible
        ? ASSISTANT_PANEL_GROUP_KEY
        : panelWorkdir
          ? panelWorkdir
          : undefined;
  const groupKeyRef = useRef(groupKey);
  groupKeyRef.current = groupKey;
  const assistantVisibleRef = useRef(assistantVisible);
  assistantVisibleRef.current = assistantVisible;
  const dockWorkdirRef = useRef(dockWorkdir);
  dockWorkdirRef.current = dockWorkdir;
  const dockIssueIdRef = useRef(dockIssueId);
  dockIssueIdRef.current = dockIssueId;
  const vscodeRef = useRef(vscode);
  vscodeRef.current = vscode;
  const previewGroupKeyRef = useRef<string | undefined>(undefined);
  previewGroupKeyRef.current =
    followIssueTools && dockWorkdir ? dockWorkdir : groupKey;
  const {
    checked: checkedPanels,
    mounted: mountedPanels,
    active: activePanel,
    widths: panelWidths,
    dockFullscreen,
    previewUrl,
    fileTabs,
    activeFilePath,
    diffView,
    fileTree,
    fileSidebarMode,
    contentSearch,
    forward: currentForward,
    forwardError: previewForwardError,
    previewEpoch,
    previewTitle,
  } = usePanelGroup(groupKey);
  const assistantTools = usePanelGroupStore(
    (state) => state.groups[ASSISTANT_PANEL_GROUP_KEY]?.tools ?? EMPTY_DOCK_TOOLS,
  );
  const assistantFileTabs = usePanelGroupStore(
    (state) => state.groups[ASSISTANT_PANEL_GROUP_KEY]?.fileTabs ?? EMPTY_FILE_TABS,
  );
  const assistantActiveFilePath = usePanelGroupStore(
    (state) => state.groups[ASSISTANT_PANEL_GROUP_KEY]?.activeFilePath ?? null,
  );
  const assistantActiveToolId = usePanelGroupStore(
    (state) => state.groups[ASSISTANT_PANEL_GROUP_KEY]?.activeToolId ?? null,
  );
  const assistantTabOrder = usePanelGroupStore(
    (state) => state.groups[ASSISTANT_PANEL_GROUP_KEY]?.tabOrder ?? EMPTY_TAB_ORDER,
  );
  const groupTabOrder = usePanelGroupStore(
    (state) => (groupKey ? state.groups[groupKey]?.tabOrder : undefined) ?? EMPTY_TAB_ORDER,
  );
  const dockTabOrder = assistantVisible ? assistantTabOrder : groupTabOrder;
  // With an issue selected, terminal and browser are not that directory's tabs.
  // Without one, those bot tools still have to count as open chrome, or a click
  // leaves the dock on 详情.
  const issueBoundDock = assistantVisible && Boolean(dockIssueGroup);
  const residentFileOpen = assistantVisible && assistantFileTabs.length > 0;
  const chromeChecked = useMemo(() => {
    const kinds = assistantVisible
      ? botDockChromeChecked(issueBoundDock, checkedPanels, assistantTools)
      : checkedPanels;
    if (!residentFileOpen || kinds.includes("file")) return kinds;
    return [...kinds, "file"];
  }, [
    assistantVisible,
    issueBoundDock,
    checkedPanels,
    assistantTools,
    residentFileOpen,
  ]);
  const chromeActive =
    issueBoundDock && (activePanel === "terminal" || activePanel === "preview")
      ? null
      : activePanel;
  const slotChecked = issueBoundDock
    ? checkedPanels.filter((kind) => kind === "file" || kind === "diff")
    : checkedPanels;
  const slotMounted = issueBoundDock
    ? mountedPanels.filter((kind) => kind === "file" || kind === "diff")
    : mountedPanels;
  const slotCheckedWithFile =
    residentFileOpen && !slotChecked.includes("file")
      ? [...slotChecked, "file" as const]
      : slotChecked;
  const slotMountedWithFile =
    residentFileOpen && !slotMounted.includes("file")
      ? [...slotMounted, "file" as const]
      : slotMounted;
  // Column width belongs to Muse Bot, not the directory whose tabs are showing.
  const assistantWidths = usePanelGroupStore(
    (state) => resolvePanelGroup(state.groups, ASSISTANT_PANEL_GROUP_KEY).widths,
  );
  const shownWidths = followIssueTools ? assistantWidths : panelWidths;
  const dockPreviewUrl = usePanelGroupStore((state) =>
    followIssueTools && dockWorkdir
      ? (state.groups[dockWorkdir]?.previewUrl ?? null)
      : null,
  );
  const dockForward = usePanelGroupStore((state) =>
    followIssueTools && dockWorkdir
      ? (state.groups[dockWorkdir]?.forward ?? null)
      : null,
  );
  const dockForwardError = usePanelGroupStore((state) =>
    followIssueTools && dockWorkdir
      ? (state.groups[dockWorkdir]?.forwardError ?? null)
      : null,
  );
  const dockPreviewEpoch = usePanelGroupStore((state) =>
    followIssueTools && dockWorkdir
      ? (state.previewEpochs[dockWorkdir] ?? 0)
      : 0,
  );
  const usingIssuePreview = Boolean(followIssueTools && dockWorkdir);
  const issueChildrenCache = usePanelGroupStore((state) =>
    usingIssuePreview && dockWorkdir
      ? (state.groups[dockWorkdir]?.fileTree?.childrenCache ??
        EMPTY_LISTING_CACHE)
      : undefined,
  );
  const issueContentSearch = usePanelGroupStore((state) =>
    usingIssuePreview && dockWorkdir
      ? (state.groups[dockWorkdir]?.contentSearch ?? EMPTY_LISTING_SEARCH)
      : undefined,
  );
  const issueFileTabs = usePanelGroupStore((state) => {
    if (!usingIssuePreview || !dockWorkdir) return undefined;
    return state.groups[dockWorkdir]?.fileTabs ?? EMPTY_FILE_TABS;
  });
  const issueActiveFilePath = usePanelGroupStore((state) => {
    if (!usingIssuePreview || !dockWorkdir) return undefined;
    return state.groups[dockWorkdir]?.activeFilePath ?? null;
  });
  const issueExpanded = usePanelGroupStore((state) => {
    if (!usingIssuePreview || !dockWorkdir) return undefined;
    return state.groups[dockWorkdir]?.fileTree?.expanded ?? EMPTY_EXPANDED;
  });
  const issueSelected = usePanelGroupStore((state) => {
    if (!usingIssuePreview || !dockWorkdir) return undefined;
    return state.groups[dockWorkdir]?.fileTree?.selected;
  });
  const shownFileTabs = useMemo(() => {
    if (!assistantVisible) return issueFileTabs ?? fileTabs;
    const directoryTabs = dockIssueGroup ? (issueFileTabs ?? []) : [];
    const issueOnly = directoryTabs.filter(
      (tab) => !assistantFileTabs.some((item) => item.path === tab.path),
    );
    return [...assistantFileTabs, ...issueOnly];
  }, [assistantVisible, dockIssueGroup, assistantFileTabs, issueFileTabs, fileTabs]);
  const shownActiveFilePath = useMemo(() => {
    if (!assistantVisible) {
      return issueActiveFilePath !== undefined ? issueActiveFilePath : activeFilePath;
    }
    const issueOnly = (dockIssueGroup ? (issueFileTabs ?? []) : []).filter(
      (tab) => !assistantFileTabs.some((item) => item.path === tab.path),
    );
    if (
      issueActiveFilePath &&
      issueOnly.some((tab) => tab.path === issueActiveFilePath)
    ) {
      return issueActiveFilePath;
    }
    if (
      assistantActiveFilePath &&
      assistantFileTabs.some((tab) => tab.path === assistantActiveFilePath)
    ) {
      return assistantActiveFilePath;
    }
    return null;
  }, [
    assistantVisible,
    dockIssueGroup,
    assistantFileTabs,
    assistantActiveFilePath,
    issueFileTabs,
    issueActiveFilePath,
    activeFilePath,
  ]);
  const shownFileTree =
    issueChildrenCache !== undefined
      ? {
          ...fileTree,
          expanded: issueExpanded ?? EMPTY_EXPANDED,
          selected: issueSelected,
          childrenCache: issueChildrenCache,
        }
      : fileTree;
  const shownContentSearch = issueContentSearch ?? contentSearch;
  const shownPreviewUrl = usingIssuePreview ? dockPreviewUrl : previewUrl;
  const shownForward = usingIssuePreview ? dockForward : currentForward;
  const shownForwardError = usingIssuePreview
    ? dockForwardError
    : previewForwardError;
  const shownPreviewEpoch = usingIssuePreview ? dockPreviewEpoch : previewEpoch;
  // Opening a kind from a shortcut, the dock toggle, or the add menu also
  // leaves 详情. List clicks only call selectPanel, so a stale active kind
  // must not pull the dock back off 详情. Closing the kind that was active
  // while 详情 is showing must not follow the next kind either. Each
  // directory has its own dock; Muse Bot and 会话 show the selected issue's
  // directory. 设置, 自动化, and the draft page do not
  // mount it, so those groupKey changes must not call selectDock. On a dock
  // surface a group switch keeps the chrome kind, unless this group does not
  // have it checked — then the chrome returns to 详情 instead of adopting the
  // other group's active kind. Inside one group, if that close leaves active
  // unchanged and another kind is still checked, select the first remaining
  // kind in PANEL_ADD_ORDER; select 详情 only when none remain. With panes,
  // this outer instance only mounts DesktopShell and never paints the dock.
  // DesktopShell does not update noPaneRail, so a session here must not make
  // dockOnScreen true. Every pane shares one chrome tab. Only the no-pane
  // ChatApp, or the focused pane, may call selectDock from this effect. An
  // unfocused pane, and the outer ChatApp that only renders DesktopShell,
  // return without writing. When focusedPaneId is missing, a pane writes only
  // if it is the sole pane. The effect reads the chrome tab from a ref and
  // does not depend on the workspace object. If this instance's checked set,
  // active kind, and group did not change, it does not retarget the chrome
  // just because another pane wrote it. Gaining write permission is different:
  // this pane's snapshot can be unchanged while it becomes the only writer.
  // If the chrome kind is not checked here, return to 详情. Do not adopt this
  // group's active kind. If the chrome kind is checked here, leave it.
  const seenPanelKind = useRef(chromeActive);
  const seenPanelGroupKey = useRef(groupKey);
  const seenCheckedPanels = useRef(chromeChecked);
  const dockChromeRef = useRef(workspace.dock);
  dockChromeRef.current = workspace.dock;
  const selectDockRef = useRef(workspace.selectDock);
  selectDockRef.current = workspace.selectDock;
  const shellHostWithoutDock =
    paneId === undefined && (host?.panes?.length ?? 0) > 0;
  const dockOnScreen =
    !shellHostWithoutDock &&
    (assistantVisible ||
      (view === "chat" && !isDraftSession && noPaneRail !== "settings"));
  const dockOnScreenRef = useRef(dockOnScreen);
  dockOnScreenRef.current = dockOnScreen;
  const paneCount = host?.panes?.length ?? 0;
  const focusedPaneId = host?.focusedPaneId;
  const dockWriter =
    paneId === undefined
      ? paneCount === 0
      : focusedPaneId
        ? focusedPaneId === paneId
        : paneCount <= 1;
  const dockWriteAllowed = dockOnScreen && dockWriter;
  const dockWasOnScreen = useRef(false);
  const dockWriteWasAllowed = useRef(false);
  useEffect(() => {
    // 会话页和分屏里的会话不跟 Issue 详情共用选中态。这边打开详情，
    // 切到会话时不能把那边的面板改成详情，也不能反过来写这边的 dock。
    if (host?.type === "desktop" && !assistantVisible) return;
    const previousKind = seenPanelKind.current;
    const previousGroupKey = seenPanelGroupKey.current;
    const previousChecked = seenCheckedPanels.current;
    const wasOnScreen = dockWasOnScreen.current;
    const onScreen = dockOnScreenRef.current;
    const wasWriter = dockWriteWasAllowed.current;
    seenPanelKind.current = chromeActive;
    seenPanelGroupKey.current = groupKey;
    seenCheckedPanels.current = chromeChecked;
    dockWasOnScreen.current = onScreen;
    dockWriteWasAllowed.current = dockWriteAllowed;
    if (!dockWriteAllowed) return;
    const checkedUnchanged =
      previousChecked.length === chromeChecked.length &&
      previousChecked.every((kind, index) => kind === chromeChecked[index]);
    const gainedWrite = !wasWriter;
    if (
      !gainedWrite &&
      previousGroupKey === groupKey &&
      previousKind === chromeActive &&
      checkedUnchanged
    ) {
      return;
    }
    const dock = dockChromeRef.current;
    const selectDock = selectDockRef.current;
    const chromeKindMissing =
      dock !== DOCK_DETAIL_TAB && !chromeChecked.includes(dock);
    if (gainedWrite) {
      if (chromeKindMissing) selectDock(DOCK_DETAIL_TAB);
      return;
    }
    if (previousGroupKey !== groupKey || !wasOnScreen) {
      if (chromeKindMissing) selectDock(DOCK_DETAIL_TAB);
      return;
    }
    if (previousGroupKey === groupKey && previousKind === chromeActive) {
      if (chromeKindMissing) {
        const nextKind = PANEL_ADD_ORDER.find((kind) =>
          chromeChecked.includes(kind),
        );
        selectDock(nextKind ?? DOCK_DETAIL_TAB);
      }
      return;
    }
    const closedPreviousKind =
      previousGroupKey === groupKey &&
      previousKind != null &&
      !chromeChecked.includes(previousKind);
    if (dock === DOCK_DETAIL_TAB && closedPreviousKind && chromeActive) {
      return;
    }
    if (chromeActive && dock !== chromeActive) {
      selectDock(chromeActive);
    } else if (!chromeActive && dock !== DOCK_DETAIL_TAB) {
      // A bot terminal or browser stays put when the issue directory's active
      // kind disappears. Only leave it when that tab itself is gone.
      if (
        (dock === "terminal" || dock === "preview") &&
        chromeChecked.includes(dock)
      ) {
        return;
      }
      selectDock(DOCK_DETAIL_TAB);
    }
  }, [assistantVisible, chromeActive, chromeChecked, dockWriteAllowed, groupKey, host?.type]);
  // Single-file view for the panel body = the active tab (multi-tab: the tab
  // bar lives in FilePane; everything downstream keeps working on one view).
  const fileView = useMemo(
    () => shownFileTabs.find((t) => t.path === shownActiveFilePath) ?? null,
    [shownFileTabs, shownActiveFilePath],
  );
  const previewUrlRef = useRef(previewUrl);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [chatColumnWidth, setChatColumnWidth] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth : 1280),
  );
  // Null until the frame is measured (jsdom). Cards stay while the message
  // column can still shrink, and fold once it would go under its minimum.
  // matchMedia follows the screen under the Electron viewport, so a real
  // measurement wins.
  const [leftPanelWidth, setLeftPanelWidth] = useState(0);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [planningIssueId, setPlanningIssueId] = useState<string | null>(null);
  // 初始化 agent store（GET /agents + /agents/scenarios），用于草稿默认模型解析与设置页
  useEffect(() => {
    useScenarioModelsStore.getState().init(museApi);
  }, [museApi]);
  // 只有会话 id 真的变了才离开当前页。切图标栏本身不能把视图拉回聊天。
  // 无窗格的面是 noPaneRail；窗格的面是壳提供的 shell surface。
  // 不改 noPaneRail。设置页在 view 之前渲染，所以这里 setView 不会盖住设置。
  // 正在把布局交给 DesktopShell 的外层实例不渲染 view，会话变化不能改掉它。
  const sessionIdRef = useRef(state.currentSession?.id);
  useEffect(() => {
    const nextId = state.currentSession?.id;
    if (sessionIdRef.current === nextId) return;
    sessionIdRef.current = nextId;
    if (noPaneDesktop) {
      if (noPaneRail === "assistant" || noPaneRail === "skills") return;
      setView("chat");
      return;
    }
    if (paneId !== undefined) {
      if (providedShellSurface === "assistant") return;
      setView("chat");
      return;
    }
    if (host?.type !== "desktop") setView("chat");
  }, [
    state.currentSession?.id,
    noPaneDesktop,
    noPaneRail,
    paneId,
    providedShellSurface,
    host?.type,
  ]);
  // Mirrors so the stable message listener can reach the panel toggle logic
  // (filled by usePanels) without re-subscribing.
  const togglePanelRef = useRef<(kind: DesktopPanelKind) => void>(() => {});
  const toggleFullscreenRef = useRef<() => void>(() => {});
  const openQuickOpenRef = useRef<(query: string) => void>(() => {});
  const messageInputRef = useRef<MessageInputHandle>(null);
  const messageListRef = useRef<{
    scrollToBottom: (behavior?: ScrollBehavior) => void;
  }>(null);
  const stateRef = useRef(state);
  // The pane this instance renders; undefined = single view (desktop
  // single-pane layout). Ref mirror for use inside stable callbacks.
  const paneIdRef = useRef<string | undefined>(paneId);
  const hostRef = useRef(host);
  hostRef.current = host;

  openQuickOpenRef.current = (query: string) => {
    setQuickOpenQuery(query);
    setQuickOpenOpen(true);
  };

  // Keep stateRef in sync with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const shownToolPreview = activePreviewTool(assistantTools, assistantActiveToolId);
  useEffect(() => {
    previewUrlRef.current = assistantVisible
      ? (shownToolPreview?.previewUrl ?? null)
      : shownPreviewUrl;
  }, [assistantVisible, shownPreviewUrl, shownToolPreview]);

  // Track the chat column width so dock maxWidth stays correct across
  // window resizes and split-pane changes (ref reads alone do not re-render).
  // Re-measure after every commit: opening the dock does not resize the frame,
  // and matchMedia does not follow that either.
  const measureFrame = useCallback(() => {
    const el = chatContainerRef.current;
    const frame = el?.clientWidth ?? 0;
    if (frame > 0) {
      setChatColumnWidth((current) => (current === frame ? current : frame));
    }
    const main = el?.querySelector(".desktop-chat-main");
    const left = main?.clientWidth ?? 0;
    if (left > 0) {
      setLeftPanelWidth((current) => (current === left ? current : left));
    }
  }, []);
  useLayoutEffect(() => {
    measureFrame();
  });
  useEffect(() => {
    window.addEventListener("resize", measureFrame);
    window.visualViewport?.addEventListener("resize", measureFrame);
    const el = chatContainerRef.current;
    let ro: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => measureFrame());
      ro.observe(el);
      const dock = el.querySelector(".desktop-panel-dock");
      if (dock) ro.observe(dock);
    }
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measureFrame);
      window.visualViewport?.removeEventListener("resize", measureFrame);
    };
  }, [measureFrame, paneId, host?.panes?.length, view, shellSurface]);

  useEffect(() => {
    paneIdRef.current = paneId;
  }, [paneId]);

  // Host pushes (updateMessages, setInitialState, user:message, ...) arrive on
  // the window message channel. The 58-case router lives in muse/messageRouter
  // (extracted verbatim) — this component only registers it. `refs` objects are
  // stable across renders, so the handler is created once per mount.
  const handleMessage = useMemo(
    () =>
      createMessageHandler({
        dispatch,
        vscode,
        refs: {
          paneIdRef,
          stateRef,
          messageListRef,
          messageInputRef,
          chatContainerRef,
          togglePanelRef,
          previewUrlRef,
          groupKeyRef,
          previewGroupKeyRef,
          openQuickOpenRef,
          hostRef,
        },
      }),
    [dispatch, vscode],
  );
  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Domain hooks: core bridge first, then panels → preview → file panel
  // (tryOpenPanel/acquireForward/handleOpenPreview flow down), then the
  // rewind/dialog/send groups. Order is fixed — missing params are tsc errors.
  const core = useChatAppCore({
    paneId,
    vscode,
    effectiveWorkdir,
    groupKey,
    paneIdRef,
  });
  const { postToHost, patchPane, updatePanelGroup } = core;
  // 当前会话跟着激活的标签走。切到 Issue 才选中那条会话；切回 Muse Bot 再交还给助手自己的会话。
  const followedIssueSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!assistantVisible) return;
    if (workspace.active !== "bot") {
      if (!openIssueSessionId) return;
      followedIssueSessionRef.current = openIssueSessionId;
      if (state.currentSession?.id === openIssueSessionId) return;
      postToHost({ command: "desktopSelectSession", sessionId: openIssueSessionId });
      return;
    }
    const taken = followedIssueSessionRef.current;
    if (!taken || !assistantSessionId || assistantSessionId === taken) return;
    if (state.currentSession?.id && state.currentSession.id !== taken) {
      followedIssueSessionRef.current = null;
      return;
    }
    if (state.currentSession?.id === assistantSessionId) {
      followedIssueSessionRef.current = null;
      return;
    }
    followedIssueSessionRef.current = null;
    postToHost({ command: "desktopSelectSession", sessionId: assistantSessionId });
  }, [
    assistantVisible,
    workspace.active,
    openIssueSessionId,
    assistantSessionId,
    state.currentSession?.id,
    postToHost,
  ]);
  useEffect(() => {
    const loads = takeRestoredFileLoads();
    for (const item of loads) {
      postToHost({
        command: "openFile",
        path: item.path,
        host: item.host,
        // The reply must land on this group's tabs. At startup the visible
        // preview group is often still the assistant key, because the issue
        // list has not arrived yet. "assistant" is the bot file bar, not a
        // directory: an absolute path still reads, and a relative one falls
        // back to the app workdir.
        ...(item.workdir === ASSISTANT_PANEL_GROUP_KEY
          ? {}
          : { workdir: item.workdir }),
        fileGroupKey: item.workdir,
      });
    }
  }, [postToHost]);
  useEffect(() => {
    clearIssueUnreadRef.current = (issueId: string) => {
      const group = (host?.issueGroups ?? []).find((item) => item.issueId === issueId);
      const sessionIds = (group?.sessions ?? [])
        .filter((item) => item.unreadDone && item.sessionId)
        .map((item) => item.sessionId);
      if (sessionIds.length === 0) return;
      postToHost({ command: "desktopClearUnread", sessionIds });
    };
  }, [host?.issueGroups, postToHost]);
  useEffect(() => {
    if (workspace.active === "bot") return;
    clearIssueUnreadRef.current(workspace.active);
  }, [workspace.active, host?.issueGroups]);
  const updatePreviewGroup = useCallback(
    (
      patch:
        | Partial<PanelGroupState>
        | ((group: PanelGroupState) => Partial<PanelGroupState>),
    ) => {
      if (assistantVisibleRef.current) {
        const store = usePanelGroupStore.getState();
        const group = resolvePanelGroup(store.groups, ASSISTANT_PANEL_GROUP_KEY);
        const resolved = typeof patch === "function" ? patch(group) : patch;
        const touchesPreview =
          "previewUrl" in resolved ||
          "forward" in resolved ||
          "forwardError" in resolved;
        const target = activePreviewTool(group.tools ?? [], group.activeToolId);
        if (touchesPreview && target) {
          store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
            tools: patchDockTool(group.tools ?? [], target.id, {
              ...("previewUrl" in resolved ? { previewUrl: resolved.previewUrl } : {}),
              ...("forward" in resolved ? { forward: resolved.forward } : {}),
              ...("forwardError" in resolved
                ? { forwardError: resolved.forwardError }
                : {}),
            }),
          });
          return;
        }
      }
      const key = previewGroupKeyRef.current;
      if (!key) return;
      usePanelGroupStore.getState().patchGroup(key, patch);
    },
    [],
  );
  const updateFileGroup = useCallback(
    (
      patch:
        | Partial<PanelGroupState>
        | ((group: PanelGroupState) => Partial<PanelGroupState>),
    ) => {
      const store = usePanelGroupStore.getState();
      if (!assistantVisibleRef.current) {
        const key = previewGroupKeyRef.current;
        if (!key) return;
        store.patchGroup(key, patch);
        return;
      }
      store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, patch);
      const issueKey = previewGroupKeyRef.current;
      if (!issueKey || issueKey === ASSISTANT_PANEL_GROUP_KEY) return;
      store.patchGroup(issueKey, { activeFilePath: null });
    },
    [],
  );
  const resolveFileGroupKey = useCallback((path: string) => {
    if (!assistantVisibleRef.current) return undefined;
    const store = usePanelGroupStore.getState();
    const issueKey = previewGroupKeyRef.current;
    const onAssistant = (store.groups[ASSISTANT_PANEL_GROUP_KEY]?.fileTabs ?? []).some(
      (tab) => tab.path === path,
    );
    const onIssue = Boolean(
      issueKey &&
        issueKey !== ASSISTANT_PANEL_GROUP_KEY &&
        (store.groups[issueKey]?.fileTabs ?? []).some((tab) => tab.path === path),
    );
    if (onIssue && !onAssistant) return issueKey;
    return ASSISTANT_PANEL_GROUP_KEY;
  }, []);

  // Auto-dismiss the queue-edit warning banner
  useEffect(() => {
    if (!queueEditWarning) return;
    const timer = setTimeout(() => patchPane({ queueEditWarning: null }), 4000);
    return () => clearTimeout(timer);
  }, [queueEditWarning, patchPane]);

  // Desktop: reset worktree opt-in only when the workdir path actually changes.
  // Do not depend on `gitBranches` (poll rewrites it) or treat `patchPane`
  // identity changes as a workdir switch — that wiped the pick and created
  // from HEAD/current instead of the selected base branch.
  const prevWorkdirRef = useRef(effectiveWorkdir);
  useEffect(() => {
    const prev = prevWorkdirRef.current;
    prevWorkdirRef.current = effectiveWorkdir;
    if (prev === effectiveWorkdir) return;
    patchPane({
      worktreeBranch: "",
      worktreeChecked: false,
    });
  }, [effectiveWorkdir, patchPane]);

  const issueSendSessionRef = useRef<string | undefined>(undefined);
  issueSendSessionRef.current =
    assistantVisible && openIssueSessionId ? openIssueSessionId : undefined;

  const send = useChatSend({
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
    pinnedSessionIdRef: issueSendSessionRef,
  });
  const {
    handleSendMessage,
    handleAbortMessage,
    handleClearChat,
    handleDeleteQueuedMessage,
    handleEditQueuedMessage,
    handleSubmitQueuedEdit,
    handleCancelQueuedEdit,
    handleAddComment,
  } = send;

  const sidebarWidth = DESKTOP_SIDEBAR_WIDTH;
  const { collapsed: sidebarCollapsed } = useDesktopSidebarCollapsed();
  const { width: sessionListWidth, setWidth: setSessionListWidth } =
    useDesktopSessionListWidth();
  const layoutSidebarWidth = sidebarWidth;
  const sessionListInset =
    noPaneDesktop && noPaneRail === "sessions" && !sidebarCollapsed
      ? sessionListWidth
      : 0;
  const contentInset = layoutSidebarWidth + sessionListInset;
  const sidebarInset =
    !dockFullscreen && !sidebarCollapsed && paneHasSidebarInset(host?.panes, paneId);
  const chatMinWidth = chatMainMinWidth(sidebarInset, contentInset);
  // Three columns keep the Muse Bot floor and still leave the issue column
  // its own floor, so the dock cannot eat the left side down to one column.
  const layoutChatMin = threeColumns
    ? chatMinWidth + SPLIT_ISSUE_MIN_WIDTH
    : chatMinWidth;
  const dockMaxWidth = chatColumnWidth - layoutChatMin;
  const assistantDockToggleRef = useRef<(() => void) | null>(null);
  const restoreAssistantToolsRef = useRef(false);
  const assistantDockSeenOpen = useRef(restoredDockAlreadyOpen());
  const [assistantDockOpen, setAssistantDockOpenState] = useState(
    () =>
      usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.dockColumnOpen ===
      true,
  );
  const setAssistantDockOpen = useCallback((open: boolean) => {
    setAssistantDockOpenState(open);
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      dockColumnOpen: open,
    });
  }, []);
  // Opening the bot dock starts on 详情 and also opens 变更 for the current issue.
  // Closing 变更 while the dock stays open keeps it closed until the next open.
  useEffect(() => {
    if (!assistantVisible || !assistantDockOpen) {
      assistantDockSeenOpen.current = false;
      return;
    }
    const justOpened = !assistantDockSeenOpen.current;
    assistantDockSeenOpen.current = true;
    if (!dockIssueId || !dockWorkdir) return;
    const group = usePanelGroupStore.getState().groups[dockWorkdir];
    const checked = group?.checked ?? [];
    if (checked.includes("diff")) return;
    const untouched = checked.length === 0 && !group?.collapsedTabs;
    if (!justOpened && !untouched) return;
    usePanelGroupStore.getState().patchGroup(dockWorkdir, {
      checked: [...checked, "diff"],
      mounted: group?.mounted.includes("diff")
        ? group.mounted
        : [...(group?.mounted ?? []), "diff"],
    });
  }, [assistantVisible, assistantDockOpen, dockIssueId, dockWorkdir]);
  const [assistantView, setAssistantView] = useState<"chat" | "transcript">("chat");
  const onAssistantViewMode = useCallback((mode: "chat" | "transcript") => {
    setAssistantView(mode);
  }, []);
  useEffect(() => {
    if (workspace.active !== "bot") setAssistantView("chat");
  }, [workspace.active]);
  const updateMuseWidthGroup = useCallback(
    (
      patch:
        | Partial<PanelGroupState>
        | ((group: PanelGroupState) => Partial<PanelGroupState>),
    ) => {
      usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, patch);
    },
    [],
  );
  // 详情不是面板 kind，原来停在 420。文件、终端第一次打开会按栏宽重算，
  // 右侧宽度就会跳。这里用同一套首次宽度，已经拖过或开过的宽度不动。
  useLayoutEffect(() => {
    if (!assistantVisible || !assistantDockOpen) return;
    if (checkedPanels.length > 0) return;
    if (
      assistantWidths.preview !== PANEL_DEFAULT_WIDTH ||
      assistantWidths.diff !== PANEL_DEFAULT_WIDTH ||
      assistantWidths.terminal !== PANEL_DEFAULT_WIDTH ||
      assistantWidths.file !== PANEL_DEFAULT_WIDTH
    ) {
      return;
    }
    const containerW = chatContainerRef.current?.clientWidth ?? 0;
    // chatColumnWidth 更新说明栏已经量过，这时再读 clientWidth。
    if (!(containerW > 0) || chatColumnWidth <= 0) return;
    const next = firstOpenDockWidths(containerW, layoutChatMin);
    if (!next) return;
    if (
      next.preview === assistantWidths.preview &&
      next.diff === assistantWidths.diff &&
      next.terminal === assistantWidths.terminal &&
      next.file === assistantWidths.file
    ) {
      return;
    }
    updateMuseWidthGroup({ widths: next });
  }, [
    assistantVisible,
    assistantDockOpen,
    checkedPanels.length,
    assistantWidths,
    chatColumnWidth,
    layoutChatMin,
    updateMuseWidthGroup,
  ]);
  const beforeToggleRef = useRef<((kind: DesktopPanelKind) => boolean) | null>(null);
  const panelShortcutRef = useRef<((kind: DesktopPanelKind) => boolean) | null>(null);
  const placeKindRef = useRef<((kind: DesktopPanelKind) => void) | null>(null);
  const dockTabPlaceRef = useRef<{
    orderKey: string | undefined;
    present: string[];
    current: string | null;
  }>({ orderKey: undefined, present: [], current: null });
  const showingDetail =
    assistantVisible &&
    (workspace.dock === DOCK_DETAIL_TAB || !chromeChecked.includes(workspace.dock));
  const visibleKind = showingDetail
    ? null
    : assistantVisible
      ? workspace.dock
      : workspace.dock !== DOCK_DETAIL_TAB && chromeChecked.includes(workspace.dock)
        ? workspace.dock
        : activePanel;
  const currentFileKey =
    visibleKind === "file" &&
    shownActiveFilePath &&
    shownFileTabs.some((tab) => tab.path === shownActiveFilePath)
      ? fileTabKey(shownActiveFilePath)
      : null;
  const currentToolKey =
    assistantVisible &&
    (visibleKind === "terminal" || visibleKind === "preview") &&
    assistantActiveToolId
      ? toolTabKey(assistantActiveToolId)
      : null;
  dockTabPlaceRef.current = {
    orderKey: assistantVisible ? ASSISTANT_PANEL_GROUP_KEY : groupKey,
    present: defaultDockTabKeys({
      detail: assistantVisible,
      checked: slotCheckedWithFile,
      filePaths: shownFileTabs.map((tab) => tab.path),
      tools: assistantVisible ? assistantTools : [],
    }),
    current: showingDetail
      ? DOCK_TAB_DETAIL_KEY
      : (currentToolKey ?? currentFileKey ?? (visibleKind ? kindTabKey(visibleKind) : null)),
  };
  const placeDockTab = (newKey: string) => {
    const placed = dockTabPlaceRef.current;
    if (!placed.orderKey) return;
    const store = usePanelGroupStore.getState();
    store.patchGroup(placed.orderKey, {
      tabOrder: insertTabAfterCurrent(
        store.groups[placed.orderKey]?.tabOrder,
        placed.present,
        placed.current,
        newKey,
      ),
    });
  };
  placeKindRef.current = (kind) => placeDockTab(kindTabKey(kind));
  const placeForwardRef = useRef<
    ((fwd: NonNullable<PanelGroupState["forward"]>) => void) | null
  >(null);
  const focusOrOpenBotPreviewRef = useRef<() => boolean>(() => false);
  const readAssistantTools = () => {
    const store = usePanelGroupStore.getState();
    const group = resolvePanelGroup(store.groups, ASSISTANT_PANEL_GROUP_KEY);
    return { store, group, tools: group.tools ?? EMPTY_DOCK_TOOLS };
  };
  const focusBotTool = (id: string) => {
    const { store, tools } = readAssistantTools();
    const tool = tools.find((item) => item.id === id);
    if (!tool) return;
    store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, { activeToolId: id });
    selectDockRef.current(tool.kind);
  };
  const openBotTerminal = (): boolean => {
    const cwd = dockWorkdirRef.current?.trim();
    if (!cwd) return false;
    const tool: DockToolInstance = {
      id: createDockToolId("terminal"),
      kind: "terminal",
      workdir: cwd,
    };
    const { store, group, tools } = readAssistantTools();
    const placed = dockTabPlaceRef.current;
    store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      tools: appendDockTool(tools, tool),
      activeToolId: tool.id,
      tabOrder: insertTabAfterCurrent(
        group.tabOrder,
        placed.present,
        placed.current,
        toolTabKey(tool.id),
      ),
    });
    selectDockRef.current("terminal");
    return true;
  };
  const openBotPreview = (): boolean => {
    const tool: DockToolInstance = {
      id: createDockToolId("preview"),
      kind: "preview",
      previewUrl: null,
      forward: null,
      forwardError: null,
      epoch: 0,
    };
    const { store, group, tools } = readAssistantTools();
    const placed = dockTabPlaceRef.current;
    store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      tools: appendDockTool(tools, tool),
      activeToolId: tool.id,
      tabOrder: insertTabAfterCurrent(
        group.tabOrder,
        placed.present,
        placed.current,
        toolTabKey(tool.id),
      ),
    });
    selectDockRef.current("preview");
    return true;
  };
  const focusOrOpenBotPreview = (): boolean => {
    const { tools, group } = readAssistantTools();
    const existing = activePreviewTool(tools, group.activeToolId);
    if (existing) {
      focusBotTool(existing.id);
      return true;
    }
    return openBotPreview();
  };
  focusOrOpenBotPreviewRef.current = focusOrOpenBotPreview;
  const closeBotTool = (id: string) => {
    const { store, tools, group } = readAssistantTools();
    const closed = tools.find((tool) => tool.id === id);
    if (!closed) return;
    if (closed.kind === "terminal") {
      vscodeRef.current.postMessage({
        command: "desktopTerminalKill",
        termId: botToolTermId(id),
      });
    }
    const nextId = nextDockToolId(tools, id, group.activeToolId);
    const nextTools = removeDockTool(tools, id);
    store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      tools: nextTools,
      activeToolId: nextId,
    });
    if (dockChromeRef.current !== closed.kind) return;
    if (group.activeToolId && group.activeToolId !== id) return;
    const next = nextTools.find((tool) => tool.id === nextId);
    selectDockRef.current(next ? next.kind : DOCK_DETAIL_TAB);
  };
  beforeToggleRef.current = (kind) => {
    if (!assistantVisibleRef.current) return false;
    if (kind !== "terminal" && kind !== "preview") return false;
    const { tools, group } = readAssistantTools();
    const ofKind = tools.filter((tool) => tool.kind === kind);
    if (ofKind.length === 0) {
      if (!dockIssueIdRef.current && group.checked.includes(kind)) return false;
      if (kind === "terminal") {
        openBotTerminal();
        return true;
      }
      openBotPreview();
      return true;
    }
    const active =
      ofKind.find((tool) => tool.id === group.activeToolId) ?? ofKind[ofKind.length - 1];
    if (dockChromeRef.current === kind && group.activeToolId === active.id) {
      closeBotTool(active.id);
      return true;
    }
    focusBotTool(active.id);
    return true;
  };
  placeForwardRef.current = assistantVisibleRef.current
    ? (fwd) => {
        const { store, tools, group } = readAssistantTools();
        const target = activePreviewTool(tools, group.activeToolId);
        if (!target) return;
        store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
          tools: patchDockTool(tools, target.id, {
            forward: fwd,
            forwardError: null,
            previewUrl: null,
          }),
        });
      }
    : null;
  const panels = usePanels({
    postToHost,
    updatePanelGroup,
    updateWidthGroup: followIssueTools ? updateMuseWidthGroup : undefined,
    groupKey,
    forwardGroupKeyRef: previewGroupKeyRef,
    panelWorkdir,
    chatContainerRef,
    togglePanelRef,
    toggleFullscreenRef,
    dockToggleHandlerRef: assistantDockToggleRef,
    isDraftSession,
    host,
    paneId,
    setView,
    setQuickOpenOpen: (value) => {
      const next =
        typeof value === "function" ? value(quickOpenOpen) : value;
      if (next) setQuickOpenQuery("");
      else setQuickOpenQuery("");
      setQuickOpenOpen(next);
    },
    checkedPanels,
    mountedPanels,
    activePanel,
    panelWidths: shownWidths,
    dockMaxWidth,
    chatMinWidth: layoutChatMin,
    hideDiff: assistantVisible && !dockIssueId,
    previewWithoutWorkdir: assistantVisible,
    beforeToggleRef,
    panelShortcutRef,
    placeForwardRef,
    placeKindRef,
  });
  const {
    tryOpenPanel,
    acquireForward,
    panelDisabled,
    handleTogglePanel,
    handleToggleDock,
    handleAddPanel,
    handleToggleFullscreen,
    handleSelectPanel,
    handleDockWidthChange,
  } = panels;
  // Panel chords open or switch. On Muse Bot they also leave 详情. A second
  // press keeps the panel; the tab close button is what removes it.
  panelShortcutRef.current = (kind) => {
    if (!assistantVisibleRef.current) return false;
    if (kind === "terminal" || kind === "preview") {
      const { tools, group } = readAssistantTools();
      const ofKind = tools.filter((tool) => tool.kind === kind);
      if (ofKind.length === 0) {
        if (!dockIssueIdRef.current && group.checked.includes(kind)) return false;
        setAssistantDockOpen(true);
        if (kind === "terminal") openBotTerminal();
        else openBotPreview();
        return true;
      }
      const active =
        ofKind.find((tool) => tool.id === group.activeToolId) ?? ofKind[ofKind.length - 1];
      setAssistantDockOpen(true);
      focusBotTool(active.id);
      return true;
    }
    handleAddPanel(kind);
    const key = groupKeyRef.current;
    const group = key ? usePanelGroupStore.getState().groups[key] : undefined;
    if (!group?.checked.includes(kind) && group?.active !== kind) return true;
    setAssistantDockOpen(true);
    selectDockRef.current(kind);
    return true;
  };
  const toggleAssistantDock = useCallback(() => {
    if (!assistantVisible) {
      handleToggleDock();
      return;
    }
    if (assistantDockOpen) {
      restoreAssistantToolsRef.current = checkedPanels.length > 0;
      if (checkedPanels.length > 0) handleToggleDock();
      setAssistantDockOpen(false);
      return;
    }
    setAssistantDockOpen(true);
    if (restoreAssistantToolsRef.current) {
      restoreAssistantToolsRef.current = false;
      handleToggleDock();
    }
  }, [
    assistantDockOpen,
    assistantVisible,
    checkedPanels.length,
    handleToggleDock,
    setAssistantDockOpen,
  ]);
  assistantDockToggleRef.current = assistantVisible ? toggleAssistantDock : null;

  const tryOpenForPreview = useCallback(
    (kind: DesktopPanelKind) => {
      if (assistantVisibleRef.current && kind === "preview") {
        return focusOrOpenBotPreviewRef.current();
      }
      return tryOpenPanel(kind);
    },
    [tryOpenPanel],
  );
  const preview = usePreview({
    updatePanelGroup: updatePreviewGroup,
    tryOpenPanel: tryOpenForPreview,
    acquireForward,
    effectiveHost,
    currentForward: shownForward,
    previewForwardError: shownForwardError,
  });
  const {
    handleOpenPreview,
    handleRemotePreviewRetry,
    handlePreviewNavigate,
    openPreviewHandler,
  } = preview;

  const filePanel = useFilePanel({
    postToHost,
    updatePanelGroup,
    tryOpenPanel,
    handleOpenPreview,
    api: museApi,
    currentSession: state.currentSession,
    effectiveHost,
    effectiveWorkdir: followIssueTools ? dockWorkdir : effectiveWorkdir,
    groupKey,
    contentSearch: shownContentSearch,
    updateListingGroup: updatePreviewGroup,
    updateFileGroup,
    resolveFileGroupKey,
  });
  const {
    handleOpenFile: openFileTabInGroup,
    handleOpenFilePin,
    handleRefreshOpenFile,
    handleSelectFileTab,
    handleCloseFileTab,
    handlePinFileTab,
    handleRevealInFinder,
    handleOpenFileHistoryDiff,
    handleRevertFileHistory,
    revertingFileHistory,
    handleFileTreeChange,
    handleOpenLocalFilePreview,
    handleFileSidebarModeChange,
    handleContentSearchChange,
  } = filePanel;
  // 详情 doesn't change the directory group's active kind. Opening a file
  // while that kind is already "file" would update the tab and leave the
  // dock on 详情. Always bring the file chrome forward on the bot surface.
  const handleOpenFile = useCallback(
    (path: string, startLine?: number, endLine?: number, pinned?: boolean) => {
      openFileTabInGroup(path, startLine, endLine, pinned);
      if (!path || !assistantVisibleRef.current) return;
      const store = usePanelGroupStore.getState();
      const keys = [previewGroupKeyRef.current, ASSISTANT_PANEL_GROUP_KEY];
      const opened = keys.some((key) => {
        if (!key) return false;
        const group = store.groups[key];
        return group?.active === "file" || Boolean(group?.checked?.includes("file"));
      });
      if (!opened) return;
      setAssistantDockOpen(true);
      selectDockRef.current("file");
    },
    [openFileTabInGroup, setAssistantDockOpen],
  );
  // A file link in the conversation opens a permanent tab. A later preview
  // open must not replace it.
  const openMessageFile = useCallback(
    (path: string, startLine?: number, endLine?: number) => {
      handleOpenFile(path, startLine, endLine, true);
    },
    [handleOpenFile],
  );
  // Issue transcript links stay on that issue. Bot-page opens stay resident.
  const openIssueMessageFile = useCallback(
    (path: string, startLine?: number, endLine?: number) => {
      if (!path) return;
      if (!assistantVisibleRef.current) {
        openMessageFile(path, startLine, endLine);
        return;
      }
      if (!tryOpenPanel("file")) return;
      const key = previewGroupKeyRef.current;
      if (!key) return;
      const store = usePanelGroupStore.getState();
      store.patchGroup(key, (group) =>
        openFileTab(
          {
            fileTabs: group.fileTabs ?? [],
            activeFilePath: group.activeFilePath ?? null,
          },
          path,
          effectiveHost,
          { startLine, endLine, pinned: true },
        ),
      );
      store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, { activeFilePath: null });
      postToHost({
        command: "openFile",
        path,
        host: effectiveHost,
        workdir: dockWorkdirRef.current,
        startLine,
        endLine,
        fileGroupKey: key,
      });
      setAssistantDockOpen(true);
      selectDockRef.current("file");
    },
    [effectiveHost, openMessageFile, postToHost, setAssistantDockOpen, tryOpenPanel],
  );
  const issueOwnsFileTab = useCallback((path: string) => {
    if (!assistantVisibleRef.current) return false;
    const store = usePanelGroupStore.getState();
    const onAssistant = (store.groups[ASSISTANT_PANEL_GROUP_KEY]?.fileTabs ?? []).some(
      (tab) => tab.path === path,
    );
    if (onAssistant) return false;
    const issueKey = previewGroupKeyRef.current;
    if (!issueKey || issueKey === ASSISTANT_PANEL_GROUP_KEY) return false;
    return (store.groups[issueKey]?.fileTabs ?? []).some((tab) => tab.path === path);
  }, []);
  const selectShownFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      const issueKey = previewGroupKeyRef.current;
      if (issueOwnsFileTab(path) && issueKey) {
        if (!tryOpenPanel("file")) return;
        const store = usePanelGroupStore.getState();
        store.patchGroup(issueKey, (group) =>
          selectFileTab(
            {
              fileTabs: group.fileTabs ?? [],
              activeFilePath: group.activeFilePath ?? null,
            },
            path,
          ),
        );
        store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, { activeFilePath: null });
        return;
      }
      handleSelectFileTab(path);
    },
    [handleSelectFileTab, issueOwnsFileTab, tryOpenPanel],
  );
  const closeShownFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      const issueKey = previewGroupKeyRef.current;
      if (issueOwnsFileTab(path) && issueKey) {
        usePanelGroupStore.getState().patchGroup(issueKey, (group) => {
          const tabs = group.fileTabs ?? [];
          if (!tabs.some((tab) => tab.path === path)) return {};
          return applyCloseFileTab(group, path);
        });
        return;
      }
      handleCloseFileTab(path);
    },
    [handleCloseFileTab, issueOwnsFileTab],
  );
  const pinShownFileTab = useCallback(
    (path: string) => {
      if (!path) return;
      const issueKey = previewGroupKeyRef.current;
      if (issueOwnsFileTab(path) && issueKey) {
        usePanelGroupStore.getState().patchGroup(issueKey, (group) =>
          pinFileTab(
            {
              fileTabs: group.fileTabs ?? [],
              activeFilePath: group.activeFilePath ?? null,
            },
            path,
          ),
        );
        return;
      }
      handlePinFileTab(path);
    },
    [handlePinFileTab, issueOwnsFileTab],
  );

  const rewind = useRewind({
    postToHost,
    patchPane,
    dispatch,
    isStreaming: state.isStreaming,
    pendingRewindId,
    messageInputRef,
  });
  const {
    handleConfirmation,
    handleRejection,
    handleRewindToMessage,
    handleOpenAgentTranscript,
    handleCloseAgentTranscript,
    handleRewindCheckpointSelect,
    handleRewindPopupClose,
    handleRewindConfirm,
  } = rewind;

  const dialogActions = useDialogs({
    postToHost,
    patchPane,
    dispatch,
    vscode,
    stateRef,
    messageInputRef,
    setView,
  });
  const {
    handleConfigurationSave,
    handleDialogClose,
    handleLogin,
    handleLogout,
    handleOpenSettings,
    handleToastDismiss,
    handleToastAction,
    handleModelSelect,
    handleSessionModelChange,
    handleModelPopupClose,
    handleDesktopNewSession,
    handleDesktopNewSessionInWorkdir,
    handleInputCleared,
  } = dialogActions;

  const sessionDefaultModel = useScenarioModelsStore(
    (s) => s.models?.session,
  );

  const currentSessionModel = (
    state.currentSession as { model?: string } | undefined
  )?.model;
  const resolvedModelId = isDraftSession
    ? resolveDraftModel(currentSessionModel, sessionDefaultModel)
    : currentSessionModel;

  // Initialize webview and load sessions on component mount
  useEffect(() => {
    dispatch({ type: "SET_SESSIONS_LOADING", payload: true });
    vscode.postMessage({
      command: "webviewReady",
    });
  }, [vscode]);

  useEffect(() => {
    patchPane({ agentTranscript: null });
  }, [state.currentSession?.id, patchPane]);

  // Desktop: idle-preload the lazily injected xterm chunk so the first
  // terminal open doesn't pay the fetch+parse cost.
  useEffect(() => {
    const id = window.requestIdleCallback?.(() => prefetchTerminalLib());
    return () => {
      if (id !== undefined) window.cancelIdleCallback?.(id);
    };
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

  // "最近一次修改" diff source: every assistant message of the NEWEST turn
  // that carries an enriched file_history block (server adds +N/−M + hunks in
  // getMessages). A turn starts at a real user message (role=user, not isMeta)
  // and runs to the next one. Only the newest turn is considered — a plain
  // question with no file changes shows nothing (no fallback to earlier
  // turns). Derived from the live message list so it survives session
  // switches — the reloaded transcript carries the same file_history blocks.
  const recentDiffFiles = useMemo<WorkspaceDiffFile[]>(() => {
    const msgs = state.messages;
    // Walk from the tail and collect every assistant message of the newest
    // turn; meta-injected user messages do not break the turn. We stop at the
    // first real user message — earlier turns are ignored even when the newest
    // turn has no file_history.
    const snapshots: Array<{
      filePath: string;
      additions?: number;
      deletions?: number;
      hunks?: string;
    }> = [];
    let inTurn = false;
    let foundFh = false;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "user" && !m.isMeta) {
        // The newest turn ends here; do not look further back.
        break;
      }
      if (m.role !== "assistant") continue;
      inTurn = true;
      const block = (m.blocks ?? []).find(
        (b) => b.type === "file_history",
      ) as
        | {
            type: "file_history";
            snapshots: Array<{
              filePath: string;
              snapshotPath?: string;
              additions?: number;
              deletions?: number;
              hunks?: string;
            }>;
          }
        | undefined;
      if (block && Array.isArray(block.snapshots)) {
        snapshots.push(...block.snapshots);
        foundFh = true;
      }
    }
    if (!inTurn || !foundFh) return [];
    const wd = effectiveWorkdir;
    // A turn often edits the same file repeatedly; keep the OLDEST snapshot per
    // file so the diff covers the whole turn (enrich diffs against current disk
    // content — newer snapshots would only show the delta since that edit).
    const deduped = dedupeSnapshotsByFile(snapshots);
    return deduped
      .filter(
        (s) =>
          s.filePath &&
          // Internal bookkeeping files (task state, etc.) outside the workdir
          // are not user-facing changes.
          (!wd || s.filePath.startsWith(wd)) &&
          ((s.additions ?? 0) > 0 || (s.deletions ?? 0) > 0),
      )
      .map((s) => ({
        path: s.filePath,
        status: "modified" as const,
        additions: s.additions ?? 0,
        deletions: s.deletions ?? 0,
        hunks: s.hunks ?? "",
        truncated: false,
        binary: false,
        ...(s.snapshotPath ? { snapshotPath: s.snapshotPath } : {}),
      }));
  }, [state.messages, effectiveWorkdir]);

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
  const issueViewTab: IssueViewTab = paneUi.issueViewTab ?? "planning";

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
      host.onSelectSession(
        issueGroupSessionWorkdir(
          activeIssueGroup,
          sessionId,
          effectiveWorkdir ?? host.workdir,
        ),
        sessionId,
      );
    },
    [activeIssueGroup, host, patchPane, effectiveWorkdir],
  );

  const handleSelectIssue = useCallback(
    (issueId: string) => {
      if (host?.type !== "desktop") return;
      const group =
        host.issueGroups?.find((g) => g.issueId === issueId) ??
        host.closedIssueGroups?.find((g) => g.issueId === issueId);
      if (!group) return;
      const sessionId = resolveIssuePlanningSessionId(group);
      if (!sessionId) return;
      patchPane({ issueViewTab: "planning" });
      host.onSelectSession(
        issueGroupSessionWorkdir(
          group,
          sessionId,
          effectiveWorkdir ?? host.workdir,
        ),
        sessionId,
      );
    },
    [host, patchPane, effectiveWorkdir],
  );

  const showIssueChrome = Boolean(activeIssueGroup);
  const issueSessionHeader =
    showIssueChrome && activeIssueGroup ? (
      <IssueSessionHeader
        title={activeIssueGroup.title}
        activeTab={issueViewTab}
        onTabChange={handleIssueTabChange}
        showTabs={Boolean(
          activeIssueGroup && isSplitIssueGroup(activeIssueGroup),
        )}
        executionEnabled={Boolean(activeIssueGroup.executionSessionId)}
      />
    ) : undefined;

  // 执行会话不收用户消息。从执行标签发出去时，改投规划会话并切过去。
  const sendIssueMessage = useCallback(
    (
      text: string,
      images?: Array<{ data: string; mediaType: string }>,
      force?: boolean,
    ) => {
      const planningId =
        shownIssueGroup && isSplitIssueGroup(shownIssueGroup)
          ? resolveIssuePlanningSessionId(shownIssueGroup)
          : undefined;
      if (
        assistantVisible &&
        shownIssueGroup &&
        planningId &&
        openIssueViewTab === "execution" &&
        (text.trim() || (images && images.length > 0))
      ) {
        issueSendSessionRef.current = planningId;
        setIssueTabChoice({ issueId: shownIssueGroup.issueId, tab: "planning" });
      }
      handleSendMessage(text, images, force);
    },
    [assistantVisible, shownIssueGroup, openIssueViewTab, handleSendMessage],
  );

  const composer = (
    <ChatComposer
      ref={messageInputRef}
      onSendMessage={sendIssueMessage}
      isStreaming={
        assistantVisible && shownIssueGroup ? issueStreaming : state.isStreaming
      }
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
      host={host}
      isDraftSession={isDraftSession}
      effectiveHost={effectiveHost}
      effectiveWorkdir={effectiveWorkdir}
      panelWorkdir={panelWorkdir}
      gitBranches={gitBranches}
      worktreeBranch={worktreeBranch}
      worktreeChecked={worktreeChecked}
      patchPane={patchPane}
      modelId={resolvedModelId}
      onModelChange={handleSessionModelChange}
      rewindPopupOpen={rewindPopupOpen}
      rewindCheckpointsLoading={rewindCheckpointsLoading}
      rewindCheckpoints={rewindCheckpoints}
      onRewindCheckpointSelect={handleRewindCheckpointSelect}
      onRewindPopupClose={handleRewindPopupClose}
      modelPopupOpen={modelPopupOpen}
      modelLoading={modelLoading}
      configuredModels={configuredModels}
      currentModel={currentModel}
      onModelSelect={handleModelSelect}
      onModelPopupClose={handleModelPopupClose}
      closed={issueClosed}
      showDraftControls={isDraftSession && !(assistantVisible && shownIssueGroup)}
    />
  );

  // One assembly for the 4 return branches (desktop shell / pane / layout / web).
  const dialogProps: ChatDialogsProps = {
    activeDialog: state.activeDialog,
    configurationData: state.configurationData,
    configurationLoading: state.configurationLoading,
    configurationError: state.configurationError,
    onConfigurationSave: handleConfigurationSave,
    onDialogClose: handleDialogClose,
    vscode,
    workflowRuns: state.workflowRuns,
    onOpenFile: handleOpenFile,
    isAuthenticated: state.isAuthenticated,
    loginError: state.loginError,
    onLogin: handleLogin,
    agentTranscript,
    subagentMessages: state.subagentMessages,
    agentToolSubagentIds: state.agentToolSubagentIds,
    onCloseAgentTranscript: handleCloseAgentTranscript,
    pendingRewindId,
    onRewindConfirm: handleRewindConfirm,
    onCancelRewind: () => patchPane({ pendingRewindId: null }),
    toasts,
    onToastDismiss: handleToastDismiss,
    onToastAction: handleToastAction,
    quickOpenOpen,
    quickOpenQuery,
    onQuickOpenClose: () => {
      setQuickOpenOpen(false);
      setQuickOpenQuery("");
    },
    effectiveWorkdir,
    quickOpenIssues: (host?.issueGroups ?? []).map((group) => ({
      id: group.issueId,
      title: group.title,
      type: group.type,
    })),
    onQuickOpenIssue: (issueId: string) => {
      selectBotPanel({ kind: "issue", issueId });
    },
  };

  const detailSelection = (() => {
    const panel = workspace.panel;
    if (panel.kind === "issue") {
      const found = (host?.issueGroups ?? []).find(
        (group) => group.issueId === panel.issueId,
      );
      return found
        ? { kind: "issue" as const, issue: found }
        : { kind: "none" as const };
    }
    if (panel.kind === "queue") {
      const found = botQueue.find((item) => item.id === panel.id);
      return found
        ? {
            kind: "queue" as const,
            typeLabel: found.kind,
            title: found.title,
            body: "",
          }
        : { kind: "none" as const };
    }
    return { kind: "none" as const };
  })();
  const detailIssueGroup =
    workspace.panel.kind === "issue"
      ? (host?.issueGroups ?? []).find((group) => group.issueId === workspace.panel.issueId)
      : undefined;
  const detailActionLabel =
    detailIssueGroup && issueTabSessionId(detailIssueGroup)
      ? sessionActionLabel(workspace, detailIssueGroup.issueId)
      : null;
  const detailTitle =
    detailSelection.kind === "issue"
      ? detailSelection.issue.title
      : detailSelection.kind === "queue"
        ? detailSelection.title
        : undefined;

  // Shared dock payload: the 4 panel slots + dock chrome (rendered by
  // ChatContainer when a bound session is showing).
  // The highlighted kind and the visible pane follow the chrome tab.
  // The other group's active must not paint through when it differs.
  // Panes share workspace.dock, and an unfocused pane does not write it.
  // If that chrome kind is not in this pane's checked set, show this pane's
  // detail layer. Leave the shared chrome alone until this pane can write.
  const chromeKindMissing =
    workspace.dock !== DOCK_DETAIL_TAB &&
    !chromeChecked.includes(workspace.dock);
  const issueDiffView = useMemo<DiffViewState | null>(
    () => (dockIssueId ? { mode: "unstaged" } : null),
    [dockIssueId],
  );
  // 详情只属于 Muse Bot / Issue。会话页用自己目录里正在打开的那种面板，
  // 不因为这边停在详情就把那边也打开。
  const showIssueDetail = assistantVisible;
  const sessionChromeKind =
    workspace.dock !== DOCK_DETAIL_TAB && chromeChecked.includes(workspace.dock)
      ? workspace.dock
      : activePanel;
  const dock: DesktopPanelSlotsProps = {
    checked: slotCheckedWithFile,
    active: showIssueDetail
      ? workspace.dock === DOCK_DETAIL_TAB
        ? chromeActive
        : workspace.dock
      : sessionChromeKind,
    mounted: slotMountedWithFile,
    disabledPanels: panelDisabled,
    fullscreen: dockFullscreen,
    widths: shownWidths,
    dockMaxWidth,
    onSelect: (kind) => {
      if (showIssueDetail) workspace.selectDock(kind);
      handleSelectPanel(kind);
    },
    onSelectDetail: showIssueDetail
      ? () => {
          workspace.selectDock(DOCK_DETAIL_TAB);
        }
      : undefined,
    detailTitle: showIssueDetail ? detailTitle : undefined,
    detailPresence:
      showIssueDetail && detailIssueGroup
        ? issueTabPresence[detailIssueGroup.issueId] ?? null
        : null,
    detailActive:
      showIssueDetail &&
      (workspace.dock === DOCK_DETAIL_TAB || chromeKindMissing),
    detail: showIssueDetail ? (
      <DockDetail
        selection={detailSelection}
        actionLabel={detailActionLabel}
        onOpenSession={workspace.openIssueSession}
        onOpenInEditor={(workdir) =>
          postToHost({ command: "desktopOpenInEditor", workdir })
        }
        onRevealInFinder={(workdir) =>
          postToHost({ command: "revealInFinder", path: workdir })
        }
      />
    ) : undefined,
    onCloseTab: handleTogglePanel,
    onAddPanel: (kind) => {
      if (assistantVisible && kind === "terminal") {
        openBotTerminal();
        return;
      }
      if (assistantVisible && kind === "preview") {
        openBotPreview();
        return;
      }
      handleAddPanel(kind);
    },
    tools: assistantVisible ? assistantTools : EMPTY_DOCK_TOOLS,
    activeToolId: assistantActiveToolId,
    onSelectTool: focusBotTool,
    onCloseTool: closeBotTool,
    tabOrder: dockTabOrder,
    onTabOrderChange: (order) => {
      const key = assistantVisible ? ASSISTANT_PANEL_GROUP_KEY : groupKey;
      if (!key) return;
      usePanelGroupStore.getState().patchGroup(key, { tabOrder: order });
    },
    onToolPreviewNavigate: (id, url) => {
      focusBotTool(id);
      handlePreviewNavigate(url);
    },
    onPreviewLocationChange: (url) => {
      updatePreviewGroup({ previewUrl: url });
    },
    onPreviewTitleChange: (title) => {
      const next = title || null;
      const key = previewGroupKeyRef.current;
      if (!key) return;
      const current = usePanelGroupStore.getState().groups[key]?.previewTitle ?? null;
      if (current === next) return;
      updatePreviewGroup({ previewTitle: next });
    },
    previewLabel: previewTitle?.trim() || undefined,
    onToolPreviewLocationChange: (id, url) => {
      const store = usePanelGroupStore.getState();
      const tools = store.groups[ASSISTANT_PANEL_GROUP_KEY]?.tools ?? [];
      if (!tools.some((tool) => tool.id === id)) return;
      store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
        tools: patchDockTool(tools, id, { previewUrl: url }),
      });
    },
    onToolPreviewTitle: (id, title) => {
      const store = usePanelGroupStore.getState();
      const tools = store.groups[ASSISTANT_PANEL_GROUP_KEY]?.tools ?? [];
      const tool = tools.find((item) => item.id === id);
      if (!tool || (tool.pageTitle ?? null) === (title || null)) return;
      store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
        tools: patchDockTool(tools, id, { pageTitle: title || null }),
      });
    },
    onToolPreviewRetry: (id) => {
      const tool = assistantTools.find((item) => item.id === id);
      if (!tool?.forward) return;
      focusBotTool(id);
      acquireForward(tool.forward.host, tool.forward.originalUrl);
    },
    onToggleDock: assistantVisible ? toggleAssistantDock : handleToggleDock,
    onToggleFullscreen: handleToggleFullscreen,
    onWidthChange: handleDockWidthChange,
    vscode,
    paneId,
    isStreaming: state.isStreaming,
    sessionId: dockIssueId
      ? dockIssueGroup
        ? issueTabSessionId(dockIssueGroup)
        : undefined
      : state.currentSession?.id,
    workdir: assistantVisible || onSessionsSurface ? dockWorkdir : effectiveWorkdir,
    baseBranch:
      dockIssueId || assistantVisible ? undefined : sessionGitMeta?.baseBranch,
    previewEpoch: shownPreviewEpoch,
    previewUrl: shownPreviewUrl,
    currentForward: shownForward,
    previewForwardError: shownForwardError,
    onRemotePreviewRetry: handleRemotePreviewRetry,
    onPreviewNavigate: handlePreviewNavigate,
    onAddComment: handleAddComment,
    diffView: issueDiffView ?? diffView,
    recentFiles: dockIssueId ? EMPTY_RECENT_DIFF_FILES : recentDiffFiles,
    onOpenFile: handleOpenFile,
    onOpenFilePinned: handleOpenFilePin,
    onRefreshOpenFile: handleRefreshOpenFile,
    onSendMessage: (text) => sendIssueMessage(text),
    fileView,
    fileTabs: shownFileTabs,
    activeFilePath: shownActiveFilePath,
    onSelectFileTab: (path) => {
      if (showIssueDetail) workspace.selectDock("file");
      selectShownFileTab(path);
    },
    onCloseFileTab: closeShownFileTab,
    onPinFileTab: pinShownFileTab,
    fileTree: shownFileTree,
    onFileTreeChange: handleFileTreeChange,
    fileSidebarMode,
    onFileSidebarModeChange: handleFileSidebarModeChange,
    contentSearch: shownContentSearch,
    onContentSearchChange: handleContentSearchChange,
    onOpenInPreview: handleOpenLocalFilePreview,
    onRevealInFinder: handleRevealInFinder,
    openPreviewHandler,
  };

  // Cards follow the pane left of the dock, not the window. matchMedia is
  // only the fallback when that pane has not been measured (jsdom).
  const showWideCards =
    leftPanelWidth > 0 ? botListsWideForPanel(leftPanelWidth) : botListsWide;
  const onBotHome = workspace.active === "bot";
  const showCards = onBotHome && showWideCards && !threeColumns;
  const showBotLists =
    assistantVisible &&
    !dockFullscreen &&
    !(onBotHome && assistantView === "transcript");
  const botColumnMax =
    showCards && showBotLists && leftPanelWidth > 0
      ? Math.min(BOT_MESSAGE_COLUMN_MAX, Math.floor(botListsColumnWidth(leftPanelWidth)))
      : undefined;
  const botLists = showBotLists ? (
    <BotLists
      queue={botQueue}
      issues={botIssues}
      selected={workspace.panel}
      wide={showCards}
      menu={botMenu}
      showQueue={onBotHome}
      onSelect={selectBotPanel}
      onOpenIssue={(issueId) => {
        workspace.openIssueSession(issueId);
        workspace.selectPanel({ kind: "issue", issueId });
        setBotMenu(null);
        clearIssueUnreadRef.current(issueId);
      }}
      onOpenDock={() => setAssistantDockOpen(true)}
      onToggleMenu={(next) => setBotMenu((current) => (current === next ? null : next))}
      onDismissMenu={() => setBotMenu(null)}
    />
  ) : null;

  const shownIssueHeader = shownIssueGroup ? (
    <IssueSessionHeader
      placement="corner"
      title={shownIssueGroup.title}
      activeTab={openIssueViewTab}
      onTabChange={(tab) => {
        if (tab === "execution" && !shownIssueGroup.executionSessionId) return;
        setIssueTabChoice({ issueId: shownIssueGroup.issueId, tab });
      }}
      showTabs={isSplitIssueGroup(shownIssueGroup)}
      executionEnabled={Boolean(shownIssueGroup.executionSessionId)}
    />
  ) : null;

  const columnToggle = (
    <Tooltip text="分栏" position="bottom" wrap={false}>
      <button
        type="button"
        className={`header-button${threeColumns ? " active" : ""}`}
        data-testid="assistant-column-toggle"
        aria-label="三栏"
        aria-pressed={threeColumns}
        disabled={workspace.openIssueIds.length === 0}
        onClick={() => setThreeColumnsOn((on) => !on)}
      >
        <svg className="header-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M1.5 2.5h3v11h-3v-11Zm5 0h3v11h-3v-11Zm5 0h3v11h-3v-11Z"
          />
        </svg>
      </button>
    </Tooltip>
  );
  const dockToggle = assistantDockOpen ? null : (
    <div className="bot-frame-dock-toggle">
      <PanelToggleControl onToggleDock={toggleAssistantDock} />
    </div>
  );

  const assistantFrame = (
    <div
      className={`chat-container assistant-frame${threeColumns ? " assistant-frame--split" : ""}`}
      ref={chatContainerRef}
      data-testid="assistant-frame"
      style={
        {
          ...(botColumnMax != null ? { "--bot-column-max": `${botColumnMax}px` } : {}),
          ...(threeColumns
            ? { "--chat-main-min-width": `${layoutChatMin}px` }
            : {}),
        } as React.CSSProperties
      }
    >
      {threeColumns ? null : (
        <div className="bot-frame-bar">
          <BotTabs
            state={workspace}
            titles={issueTitles}
            presence={issueTabPresence}
            onFocus={workspace.focusTab}
            onClose={workspace.closeIssueTab}
          />
          <div className="bot-frame-switch" ref={setBotSwitchHost}>
            {shownIssueHeader}
          </div>
          {showCards ? null : botLists}
          <div className="bot-frame-end">
            {columnToggle}
            {dockToggle}
          </div>
        </div>
      )}
      <div className="desktop-chat-body">
        <div className="desktop-chat-main">
          {threeColumns ? (
            <div
              className="assistant-split-bot"
              style={{
                flexGrow: splitRatio,
                minWidth: `min(${chatMinWidth}px, 100%)`,
              }}
            >
              <div className="assistant-split-bar">
                <BotTabs
                  state={workspace}
                  titles={issueTitles}
                  presence={issueTabPresence}
                  lockBotTab
                  scope="bot"
                  onFocus={workspace.focusTab}
                  onClose={workspace.closeIssueTab}
                />
                <div className="bot-frame-switch" ref={setBotSwitchHost} />
                {botLists}
              </div>
              <AssistantPage
                api={museApi}
                vscode={vscode}
                showPanelToggle={false}
                onToggleDock={toggleAssistantDock}
                onViewModeChange={onAssistantViewMode}
                onOpenFile={openMessageFile}
                onOpenUrl={handleOpenPreview}
                hideQueue={assistantVisible}
                mentionIssues={(host?.issueGroups ?? []).map((group) => ({
                  id: group.issueId,
                  title: group.title,
                }))}
                onSelectIssue={(issueId) => selectBotPanel({ kind: "issue", issueId })}
                emptyState={<AssistantWelcome />}
                viewSwitchHost={botSwitchHost}
                onComposerFocusChange={setBotComposerFocused}
              />
            </div>
          ) : null}
          {threeColumns ? (
            <div
              className="assistant-split-handle"
              data-testid="assistant-split-handle"
              onMouseDown={(event) => {
                event.preventDefault();
                const main = event.currentTarget.parentElement;
                if (!main) return;
                const rect = main.getBoundingClientRect();
                const move = (ev: MouseEvent) => {
                  const left = clampSplitLeftWidth(
                    rect.width,
                    ev.clientX - rect.left,
                    chatMinWidth,
                  );
                  if (rect.width > 0) setSplitRatio(left / rect.width);
                };
                const up = () => {
                  window.removeEventListener("mousemove", move);
                  window.removeEventListener("mouseup", up);
                  document.body.classList.remove("is-panel-resizing");
                };
                document.body.classList.add("is-panel-resizing");
                window.addEventListener("mousemove", move);
                window.addEventListener("mouseup", up);
              }}
            />
          ) : null}
          {shownIssueGroup ? (
            <div
              className={threeColumns ? "assistant-split-issue" : "assistant-split-passthrough"}
              style={
                threeColumns
                  ? {
                      flexGrow: 1 - splitRatio,
                      minWidth: `${SPLIT_ISSUE_MIN_WIDTH}px`,
                    }
                  : undefined
              }
            >
            {threeColumns ? (
              <div className="assistant-split-bar">
                <BotTabs
                  state={workspace}
                  titles={issueTitles}
                  presence={issueTabPresence}
                  scope="issues"
                  onFocus={workspace.focusTab}
                  onClose={workspace.closeIssueTab}
                />
                <div className="bot-frame-switch">{shownIssueHeader}</div>
                <div className="bot-frame-end">
                  {columnToggle}
                  {dockToggle}
                </div>
              </div>
            ) : null}
            <div className="issue-tab-transcript" data-testid="issue-tab-transcript">
              {issueTranscriptFailed ? (
                <div className="issue-tab-load-error" data-testid="issue-tab-load-error">
                  <span>会话加载失败</span>
                  <button
                    type="button"
                    className="issue-tab-load-retry"
                    onClick={() =>
                      setIssueTranscriptAttempt((attempt) => attempt + 1)
                    }
                  >
                    重试
                  </button>
                </div>
              ) : (
                <ChatBody
                  hideWelcome={!issueShowWelcome}
                  onSelectPrompt={(text) => messageInputRef.current?.setText(text)}
                  isRestoring={false}
                  messages={shownIssueMessages}
                  initialized
                  isAuthenticated={state.isAuthenticated}
                  configurationData={state.configurationData}
                  onLogin={handleLogin}
                  queuedMessages={issueShowsLive ? state.queuedMessages : []}
                  isStreaming={issueStreaming}
                  isCompacting={issueShowsLive && state.isCompacting}
                  vscode={vscode}
                  onRewindToMessage={issueShowsLive ? handleRewindToMessage : () => undefined}
                  workdir={dockWorkdir}
                  onOpenPreview={handleOpenPreview}
                  onOpenFile={openIssueMessageFile}
                  onOpenAgentTranscript={handleOpenAgentTranscript}
                  hasOlderMessages={
                    issueShowsLive
                      ? state.hasOlderMessages
                      : openIssueTranscript?.status === "ready" && openIssueTranscript.hasMore
                  }
                  onLoadOlder={loadOlderIssueMessages}
                  onRevertFileHistory={issueShowsLive ? handleRevertFileHistory : () => undefined}
                  revertingFileHistory={issueShowsLive && revertingFileHistory}
                  onOpenFileHistoryFile={handleOpenFileHistoryDiff}
                  backgroundTasks={issueShowsLive ? state.backgroundTasks : []}
                  isBackgroundTasksCollapsed={state.isBackgroundTasksCollapsed}
                  onToggleBackgroundTasks={() =>
                    dispatch({ type: "TOGGLE_BACKGROUND_TASKS_COLLAPSE" })
                  }
                  onStopTask={(taskId) =>
                    postToHost({ command: "stopBackgroundTask", taskId })
                  }
                  tasks={issueShowsLive ? state.tasks : []}
                  isTaskListCollapsed={state.isTaskListCollapsed}
                  onToggleTaskList={() => dispatch({ type: "TOGGLE_TASK_LIST_COLLAPSE" })}
                  isQueueCollapsed={state.isQueueCollapsed}
                  onToggleQueueCollapse={() => dispatch({ type: "TOGGLE_QUEUE_COLLAPSE" })}
                  onEditQueuedMessage={handleEditQueuedMessage}
                  onDeleteQueuedMessage={handleDeleteQueuedMessage}
                  editingQueuedId={issueShowsLive ? state.editingQueuedId : null}
                  pendingConfirmations={issueShowsLive ? state.pendingConfirmations : []}
                  onConfirm={handleConfirmation}
                  onReject={handleRejection}
                  currentSession={issueShowsLive ? state.currentSession : undefined}
                  composer={composer}
                  onComposerFocus={threeColumns ? focusShownIssueFromSender : undefined}
                />
              )}
            </div>
            </div>
          ) : (
            <AssistantPage
              api={museApi}
              vscode={vscode}
              showPanelToggle={false}
              onToggleDock={toggleAssistantDock}
              onViewModeChange={onAssistantViewMode}
              onOpenFile={openMessageFile}
              onOpenUrl={handleOpenPreview}
              hideQueue={assistantVisible}
              inputRef={messageInputRef}
              mentionIssues={(host?.issueGroups ?? []).map((group) => ({
                id: group.issueId,
                title: group.title,
              }))}
              onSelectIssue={(issueId) => selectBotPanel({ kind: "issue", issueId })}
              emptyState={<AssistantWelcome />}
              viewSwitchHost={botSwitchHost}
            />
          )}
          {showCards ? botLists : null}
        </div>
        {assistantDockOpen ? <DesktopPanelSlots {...dock} /> : null}
      </div>
    </div>
  );

  const chatContainer = (
    <ChatContainer
      chatContainerRef={chatContainerRef}
      queueEditWarning={queueEditWarning}
      onDismissQueueEditWarning={() => patchPane({ queueEditWarning: null })}
      view={view}
      postToHost={postToHost}
      patchPane={patchPane}
      currentSession={state.currentSession}
      initialized={state.initialized}
      effectiveWorkdir={effectiveWorkdir}
      dock={dock}
      vscode={vscode}
      // ChatChrome / ChatBody props
      onNewSession={handleClearChat}
      onAbortMessage={handleAbortMessage}
      messages={state.messages}
      hasOlderMessages={state.hasOlderMessages}
      onLoadOlder={() => {
        const before = state.messages[0]?.id;
        if (before) postToHost({ command: "loadOlderMessages", before });
      }}
      onOpenSettings={handleOpenSettings}
      onLogin={handleLogin}
      onSelectPrompt={(text) => messageInputRef.current?.setText(text)}
      onLogout={handleLogout}
      isAuthenticated={state.isAuthenticated}
      dispatch={dispatch}
      gitBranches={gitBranches}
      isDraftSession={isDraftSession}
      checkedPanels={checkedPanels}
      onToggleDock={handleToggleDock}
      isRestoring={state.isRestoring}
      configurationData={state.configurationData}
      queuedMessages={state.queuedMessages}
      isStreaming={state.isStreaming}
      isCompacting={state.isCompacting}
      onRewindToMessage={handleRewindToMessage}
      workdir={state.workdir}
      onOpenPreview={openPreviewHandler}
      onOpenFile={openMessageFile}
      onOpenAgentTranscript={handleOpenAgentTranscript}
      onRevertFileHistory={handleRevertFileHistory}
      revertingFileHistory={revertingFileHistory}
      onOpenFileHistoryFile={handleOpenFileHistoryDiff}
      backgroundTasks={state.backgroundTasks}
      isBackgroundTasksCollapsed={state.isBackgroundTasksCollapsed}
      onToggleBackgroundTasks={() =>
        dispatch({ type: "TOGGLE_BACKGROUND_TASKS_COLLAPSE" })
      }
      onStopTask={(taskId) =>
        postToHost({ command: "stopBackgroundTask", taskId })
      }
      tasks={state.tasks}
      isTaskListCollapsed={state.isTaskListCollapsed}
      onToggleTaskList={() =>
        dispatch({ type: "TOGGLE_TASK_LIST_COLLAPSE" })
      }
      isQueueCollapsed={state.isQueueCollapsed}
      onToggleQueueCollapse={() =>
        dispatch({ type: "TOGGLE_QUEUE_COLLAPSE" })
      }
      onEditQueuedMessage={handleEditQueuedMessage}
      onDeleteQueuedMessage={handleDeleteQueuedMessage}
      editingQueuedId={state.editingQueuedId}
      pendingConfirmations={state.pendingConfirmations}
      onConfirm={handleConfirmation}
      onReject={handleRejection}
      composer={composer}
      issueSessionHeader={issueSessionHeader}
      hideChatTitle={showIssueChrome}
    />
  );

  if (host?.type === "desktop") {
    const refreshSessionTree = () =>
      postToHost({ command: "desktopRefreshSessionTree" });
    const issueSidebarProps = {
      issueGroups: host.issueGroups,
      closedIssueGroups: host.closedIssueGroups,
      onNewIssue: () => setShowNewIssue(true),
      onSelectIssue: (issueId: string) => {
        setView("chat");
        handleSelectIssue(issueId);
      },
      onOpenPlanning: (issueId: string) => setPlanningIssueId(issueId),
      onCompleteIssue: (issueId: string, note: string) => {
        void museApi
          .completeIssue(issueId, note)
          .then(refreshSessionTree)
          .catch((err) => {
            window.alert(
              err instanceof Error ? err.message : "完成 Issue 失败",
            );
          });
      },
      onCancelIssue: (issueId: string, note: string) => {
        void museApi
          .cancelIssue(issueId, note)
          .then(refreshSessionTree)
          .catch((err) => {
            window.alert(
              err instanceof Error ? err.message : "取消 Issue 失败",
            );
          });
      },
    };
    const newIssueDialog = showNewIssue ? (
      <NewIssueDialog
        api={museApi}
        onCancel={() => setShowNewIssue(false)}
        onCreated={() => {
          setShowNewIssue(false);
          refreshSessionTree();
        }}
      />
    ) : null;
    const openPlanningDialog = planningIssueId ? (
      <OpenPlanningDialog
        issueId={planningIssueId}
        api={museApi}
        postToHost={postToHost}
        recentWorkdirs={host.recentWorkdirs}
        onCancel={() => setPlanningIssueId(null)}
        onOpened={({ sessionId, workdir }) => {
          setPlanningIssueId(null);
          host.onSelectSession(workdir, sessionId);
          refreshSessionTree();
        }}
      />
    ) : null;

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
            workspace={workspace}
            onLogin={handleLogin}
            isAuthenticated={state.isAuthenticated}
            configurationData={state.configurationData}
            configurationLoading={state.configurationLoading}
            configurationError={state.configurationError}
            onConfigurationSave={handleConfigurationSave}
            api={museApi}
            postToHost={postToHost}
            {...issueSidebarProps}
          />
          {newIssueDialog}
          {openPlanningDialog}
          <ChatDialogs {...dialogProps} />
        </>
      );
    }
    // Inside DesktopShell each pane renders only its own chatContainer; the
    // sidebar / preview pane live in the shell / single-pane layout.
    // 助理占中间栏，右侧是助手自己的文件、终端和浏览器。
    const showAssistantInPane =
      paneId !== undefined &&
      providedShellSurface === "assistant" &&
      (host.focusedPaneId ?? paneId) === paneId;
    if (paneId !== undefined) {
      return (
        <>
          {showAssistantInPane ? assistantFrame : chatContainer}
          <ChatDialogs {...dialogProps} />
        </>
      );
    }
    return (
      <div
        className="desktop-layout"
        data-sidebar-collapsed={sidebarCollapsed ? "true" : undefined}
        style={
          {
            "--desktop-sidebar-width": `${contentInset}px`,
            "--desktop-sidebar-drawer-width": `${sidebarWidth}px`,
          } as React.CSSProperties
        }
      >
        <AssistantNotice
          onOpen={() => {
            if (
              settingsPageLeaveBlocked(
                noPaneRail,
                "assistant",
                settingsPageRef.current,
              )
            ) {
              return;
            }
            setNoPaneRail("assistant");
            setView("assistant");
            workspace.focusTab("bot");
          }}
        />
        {noPaneRail === "sessions" ? <DesktopSidebarToggle /> : null}
        <DesktopSidebar
          onNewSession={() => {
            setView("chat");
            handleDesktopNewSession();
          }}
          onNewSessionInPane={() => {
            setView("chat");
            postToHost({ command: "desktopNewSessionInPane" });
          }}
          onNewSessionInWorkdir={handleDesktopNewSessionInWorkdir}
          isStreaming={state.isStreaming}
          disabled={false}
          onOpenSettings={() => {
            setNoPaneRail("settings");
            vscode.postMessage({ command: "getConfiguration" });
          }}
          onLogin={handleLogin}
          isAuthenticated={state.isAuthenticated}
          {...resolveSidebarSessions({ sessionTree: host.sessionTree })}
          {...issueSidebarProps}
          currentSessionId={
            view === "assistant" || view === "automations" || view === "skills"
              ? undefined
              : state.currentSession?.id
          }
          onSelectSession={(workdir, sessionId) => {
            setView("chat");
            host.onSelectSession(workdir, sessionId);
          }}
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
          onRevealInFinder={(workdir) =>
            postToHost({ command: "revealInFinder", path: workdir })
          }
          onOpenSessions={() => {
            if (
              settingsPageLeaveBlocked(
                noPaneRail,
                "sessions",
                settingsPageRef.current,
              )
            ) {
              return;
            }
            setNoPaneRail("sessions");
            setView("chat");
          }}
          onOpenAutomations={() => {
            if (
              settingsPageLeaveBlocked(
                noPaneRail,
                "automations",
                settingsPageRef.current,
              )
            ) {
              return;
            }
            setNoPaneRail("automations");
            setView("automations");
          }}
          onOpenSkills={() => {
            if (
              settingsPageLeaveBlocked(
                noPaneRail,
                "skills",
                settingsPageRef.current,
              )
            ) {
              return;
            }
            setNoPaneRail("skills");
            setView("skills");
          }}
          onOpenAssistant={() => {
            if (
              settingsPageLeaveBlocked(
                noPaneRail,
                "assistant",
                settingsPageRef.current,
              )
            ) {
              return;
            }
            setNoPaneRail("assistant");
            setView("assistant");
          }}
          activeMenu={noPaneRail}
        />
        {noPaneRail === "sessions" ? (
          <DesktopSessionList
            onNewSession={() => {
              setNoPaneRail("sessions");
              setView("chat");
              handleDesktopNewSession();
            }}
            onNewSessionInWorkdir={handleDesktopNewSessionInWorkdir}
            isStreaming={state.isStreaming}
            disabled={false}
            {...resolveSidebarSessions({ sessionTree: host.sessionTree })}
            currentSessionId={
              view === "assistant" || view === "automations" || view === "skills"
                ? undefined
                : state.currentSession?.id
            }
            onSelectSession={(workdir, sessionId) => {
              setView("chat");
              host.onSelectSession(workdir, sessionId);
            }}
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
            onRevealInFinder={(workdir) =>
              postToHost({ command: "revealInFinder", path: workdir })
            }
            width={sessionListWidth}
            onWidthChange={setSessionListWidth}
          />
        ) : null}
        {noPaneRail === "settings" ? (
          <ConfigDialog
            ref={settingsPageRef}
            layout="page"
            vscode={vscode}
            configurationData={state.configurationData || {}}
            isLoading={state.configurationLoading}
            error={state.configurationError}
            onSave={handleConfigurationSave}
            onCancel={() => {}}
            isAuthenticated={state.isAuthenticated}
            onLogin={handleLogin}
          />
        ) : noPaneRail === "skills" ? (
          <SkillsPage
            api={museApi}
            onRunInTerminal={(command) =>
              postToHost({ command: "desktopRunInTerminal", text: command })
            }
          />
        ) : view === "automations" ? (
          <AutomationsPage
            api={museApi}
            postToHost={postToHost}
            recentWorkdirs={host.recentWorkdirs ?? []}
          />
        ) : view === "assistant" ? (
          assistantFrame
        ) : (
          chatContainer
        )}
        {newIssueDialog}
        {openPlanningDialog}
        <ChatDialogs {...dialogProps} />
      </div>
    );
  }

  return (
    <>
      {chatContainer}
      <ChatDialogs {...dialogProps} />
    </>
  );
};
