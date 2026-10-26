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
import { firstOpenDockWidths } from "../muse/panelFit";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  PANEL_DEFAULT_WIDTH,
  emptyContentSearchState,
  resolvePanelGroup,
  usePanelGroup,
  usePanelGroupStore,
  usePaneUi,
  type PanelGroupState,
} from "../stores";
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
export type MainView = "newChat" | "chat" | "automations" | "assistant";

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
  const ownedWorkspace = useBotWorkspaceController(
    props.host?.issueGroups?.[0]?.issueId ?? null,
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
        if (!cancelled && info.workdir) setAssistantWorkdir(info.workdir);
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
  // the same dock as sessions in that directory. On Muse Bot and 会话 the
  // dock is that directory's group: which tabs are open, files, terminal,
  // browser, and diff. A queue row keeps the previous issue. Switching
  // issues switches directories, so the tab set switches with them, the same
  // way switching sessions does. With no issue, Muse Bot stays on the
  // assistant group and 会话 stays on the open session. The column width
  // and open flag stay on the assistant key, so Muse Bot and 会话 share
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
  } = usePanelGroup(groupKey);
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
  const shownFileTabs = issueFileTabs ?? fileTabs;
  const shownActiveFilePath =
    issueActiveFilePath !== undefined ? issueActiveFilePath : activeFilePath;
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
  const seenPanelKind = useRef(activePanel);
  const seenPanelGroupKey = useRef(groupKey);
  const seenCheckedPanels = useRef(checkedPanels);
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
    seenPanelKind.current = activePanel;
    seenPanelGroupKey.current = groupKey;
    seenCheckedPanels.current = checkedPanels;
    dockWasOnScreen.current = onScreen;
    dockWriteWasAllowed.current = dockWriteAllowed;
    if (!dockWriteAllowed) return;
    const checkedUnchanged =
      previousChecked.length === checkedPanels.length &&
      previousChecked.every((kind, index) => kind === checkedPanels[index]);
    const gainedWrite = !wasWriter;
    if (
      !gainedWrite &&
      previousGroupKey === groupKey &&
      previousKind === activePanel &&
      checkedUnchanged
    ) {
      return;
    }
    const dock = dockChromeRef.current;
    const selectDock = selectDockRef.current;
    const chromeKindMissing =
      dock !== DOCK_DETAIL_TAB && !checkedPanels.includes(dock);
    if (gainedWrite) {
      if (chromeKindMissing) selectDock(DOCK_DETAIL_TAB);
      return;
    }
    if (previousGroupKey !== groupKey || !wasOnScreen) {
      if (chromeKindMissing) selectDock(DOCK_DETAIL_TAB);
      return;
    }
    if (previousGroupKey === groupKey && previousKind === activePanel) {
      if (chromeKindMissing) {
        const nextKind = PANEL_ADD_ORDER.find((kind) =>
          checkedPanels.includes(kind),
        );
        selectDock(nextKind ?? DOCK_DETAIL_TAB);
      }
      return;
    }
    const closedPreviousKind =
      previousGroupKey === groupKey &&
      previousKind != null &&
      !checkedPanels.includes(previousKind);
    if (dock === DOCK_DETAIL_TAB && closedPreviousKind && activePanel) {
      return;
    }
    if (activePanel && dock !== activePanel) {
      selectDock(activePanel);
    } else if (!activePanel && dock !== DOCK_DETAIL_TAB) {
      selectDock(DOCK_DETAIL_TAB);
    }
  }, [activePanel, assistantVisible, checkedPanels, dockWriteAllowed, groupKey, host?.type]);
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
      if (noPaneRail === "assistant") return;
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

  useEffect(() => {
    previewUrlRef.current = shownPreviewUrl;
  }, [shownPreviewUrl]);

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
      const key = previewGroupKeyRef.current;
      if (!key) return;
      usePanelGroupStore.getState().patchGroup(key, patch);
    },
    [],
  );

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

  const preview = usePreview({
    updatePanelGroup: updatePreviewGroup,
    tryOpenPanel,
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
  });
  const {
    handleOpenFile,
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
  const issueClosed =
    activeIssueGroup?.status === "completed" ||
    activeIssueGroup?.status === "cancelled";
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

  const composer = (
    <ChatComposer
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
    !checkedPanels.includes(workspace.dock);
  const issueDiffView = useMemo<DiffViewState | null>(
    () => (dockIssueId ? { mode: "unstaged" } : null),
    [dockIssueId],
  );
  // 详情只属于 Muse Bot / Issue。会话页用自己目录里正在打开的那种面板，
  // 不因为这边停在详情就把那边也打开。
  const showIssueDetail = assistantVisible;
  const sessionChromeKind =
    workspace.dock !== DOCK_DETAIL_TAB && checkedPanels.includes(workspace.dock)
      ? workspace.dock
      : activePanel;
  const dock: DesktopPanelSlotsProps = {
    checked: checkedPanels,
    active: showIssueDetail
      ? workspace.dock === DOCK_DETAIL_TAB
        ? activePanel
        : workspace.dock
      : sessionChromeKind,
    mounted: mountedPanels,
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
    onAddPanel: handleAddPanel,
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
    onSendMessage: (text) => handleSendMessage(text),
    fileView,
    fileTabs: shownFileTabs,
    activeFilePath: shownActiveFilePath,
    onSelectFileTab: (path) => {
      if (showIssueDetail) workspace.selectDock("file");
      handleSelectFileTab(path);
    },
    onCloseFileTab: handleCloseFileTab,
    onPinFileTab: handlePinFileTab,
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
                onOpenFile={handleOpenFile}
                onOpenUrl={handleOpenPreview}
                hideQueue={assistantVisible}
                mentionIssues={(host?.issueGroups ?? []).map((group) => ({
                  id: group.issueId,
                  title: group.title,
                }))}
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
                  onOpenFile={handleOpenFile}
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
              onOpenFile={handleOpenFile}
              onOpenUrl={handleOpenPreview}
              hideQueue={assistantVisible}
              inputRef={messageInputRef}
              mentionIssues={(host?.issueGroups ?? []).map((group) => ({
                id: group.issueId,
                title: group.title,
              }))}
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
      onOpenFile={handleOpenFile}
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
            view === "assistant" || view === "automations"
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
              view === "assistant" || view === "automations"
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
