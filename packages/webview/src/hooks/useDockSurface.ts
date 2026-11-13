import { useEffect, useMemo, useRef } from "react";
import type { BotWorkspaceContextValue } from "../components/desktop/BotTabs";
import type { ShellSurface } from "../components/desktop/shellSurface";
import { issueTabSessionId } from "../components/desktop/botWorkspace";
import type { MainView } from "../components/ChatApp";
import { DOCK_DETAIL_TAB, PANEL_ADD_ORDER } from "../muse/panelTabs";
import { botDockChromeChecked } from "../muse/dockTools";
import { uniqueFileTabs } from "../muse/fileTabs";
import { issueGroupSessionWorkdir } from "../utils/issueGroups";
import { uniqueWorkdirs, workdirForFile } from "../utils/workdirScope";
import type { DesktopHostProps, DesktopIssueGroup, VsCodeApi } from "../types";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  EMPTY_DOCK_TOOLS,
  EMPTY_TAB_ORDER,
  resolvePanelGroup,
  usePanelGroup,
  usePanelGroupStore,
  type PanelGroupState,
} from "../stores";

const EMPTY_LISTING_CACHE: PanelGroupState["fileTree"]["childrenCache"] = {};
const EMPTY_FILE_TABS: PanelGroupState["fileTabs"] = [];
const EMPTY_EXPANDED: string[] = [];

/**
 * Which directory, file tabs, preview, and chrome kind the dock is showing.
 * Muse Bot, the sessions page, and an issue transcript each keep their own
 * panel group; this hook is the only place that chooses among them.
 */
export function useDockSurface({
  assistantVisible,
  workspace,
  host,
  paneId,
  providedShellSurface,
  noPaneRail,
  currentSession,
  effectiveWorkdir,
  assistantWorkdir,
  vscode,
  view,
  isDraftSession,
}: {
  assistantVisible: boolean;
  workspace: BotWorkspaceContextValue;
  host: DesktopHostProps | undefined;
  paneId: string | undefined;
  providedShellSurface: ShellSurface | null;
  noPaneRail: ShellSurface;
  currentSession: { id?: string; workdir?: string } | undefined;
  effectiveWorkdir: string | undefined;
  assistantWorkdir: string | undefined;
  vscode: VsCodeApi;
  view: MainView;
  isDraftSession: boolean;
}) {
  const state = { currentSession };
  // Desktop only: panel group is keyed by absolute workdir (not session).
  // Fall back to host.workdir so a draft with a selected folder still shares
  // the same dock as sessions in that directory. On Muse Bot, 变更 follows
  // the selected issue. 文件预览 opened on this page stays on the bot's own
  // bar and survives an issue switch. A file opened from the issue transcript
  // stays with that issue. The file tree still shows the current issue's
  // directory. 终端 and 浏览器 are bot-level tabs: switching issues does not
  // swap or close them, and each one can be opened more than once. A new
  // terminal starts in the current issue workdir. 会话用这条会话自己的目录，
  // 不沿用 Muse Bot 上次打开的事项。栏宽仍跟 Muse Bot 共用。
  const dockIssueId = assistantVisible
    ? workspace.panel.kind === "issue"
      ? workspace.panel.issueId
      : workspace.lastIssueId
    : undefined;
  const dockIssueGroup = dockIssueId
    ? (host?.issueGroups ?? []).find((group) => group.issueId === dockIssueId)
    : undefined;
  const onSessionsSurface =
    host?.type === "desktop" &&
    (paneId !== undefined
      ? providedShellSurface === "sessions"
      : noPaneRail === "sessions");
  // 会话页的目录以这条会话自己的 workdir 为准。state.workdir 还停留在上一页时，
  // 不能拿它去画右侧面板。
  const sessionOwnWorkdir =
    state.currentSession?.id && state.currentSession.id !== "__draft__"
      ? state.currentSession.workdir
      : undefined;
  const sessionPanelWorkdir =
    sessionOwnWorkdir || effectiveWorkdir || host?.workdir || undefined;
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
  // Tabs belong to the assistant, not to the selected issue. Detail and
  // diff still read the issue below, but the tab strip/checked/file tabs stay
  // on one group so an issue switch cannot add, remove or swap tabs.
  const groupKey = assistantVisible
    ? ASSISTANT_PANEL_GROUP_KEY
    : panelWorkdir
      ? panelWorkdir
      : undefined;
  const groupKeyRef = useRef(groupKey);
  groupKeyRef.current = groupKey;
  const assistantVisibleRef = useRef(assistantVisible);
  assistantVisibleRef.current = assistantVisible;
  const onSessionsSurfaceRef = useRef(onSessionsSurface);
  onSessionsSurfaceRef.current = onSessionsSurface;
  const dockIssueIdRef = useRef(dockIssueId);
  dockIssueIdRef.current = dockIssueId;
  const vscodeRef = useRef(vscode);
  vscodeRef.current = vscode;
  const previewGroupKeyRef = useRef<string | undefined>(undefined);
  previewGroupKeyRef.current = assistantVisible
    ? ASSISTANT_PANEL_GROUP_KEY
    : followIssueTools && dockWorkdir
      ? dockWorkdir
      : groupKey;
  // The assistant's file replies go to its own tab group now, not to a group
  // keyed by the issue.
  const fileContentGroupKeyRef = useRef<string | undefined>(undefined);
  fileContentGroupKeyRef.current = previewGroupKeyRef.current;
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
  const residentFileOpen = assistantVisible && assistantFileTabs.length > 0;
  const chromeChecked = useMemo(() => {
    const kinds = assistantVisible
      ? botDockChromeChecked(false, checkedPanels, assistantTools)
      : checkedPanels;
    if (!residentFileOpen || kinds.includes("file")) return kinds;
    return [...kinds, "file"];
  }, [assistantVisible, checkedPanels, assistantTools, residentFileOpen]);
  const chromeActive = activePanel;
  const slotChecked = checkedPanels;
  const slotMounted = mountedPanels;
  const slotCheckedWithFile = useMemo(
    () =>
      residentFileOpen && !slotChecked.includes("file")
        ? [...slotChecked, "file" as const]
        : slotChecked,
    [residentFileOpen, slotChecked],
  );
  const slotMountedWithFile = useMemo(
    () =>
      residentFileOpen && !slotMounted.includes("file")
        ? [...slotMounted, "file" as const]
        : slotMounted,
    [residentFileOpen, slotMounted],
  );
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
  const usingIssuePreview = Boolean(
    !assistantVisible && followIssueTools && dockWorkdir,
  );
  const shownFileTabs = useMemo(
    () =>
      assistantVisible
        ? uniqueFileTabs(assistantFileTabs)
        : uniqueFileTabs(fileTabs ?? []),
    [assistantVisible, assistantFileTabs, fileTabs],
  );
  const shownActiveFilePath = assistantVisible
    ? assistantActiveFilePath
    : activeFilePath;
  // The assistant's file tree follows the open file, not the selected issue:
  // resolve the file's workdir from the issue workdirs + recent workdirs. A
  // file outside every known directory has no tree to show.
  const knownWorkdirs = useMemo(
    () =>
      assistantVisible
        ? uniqueWorkdirs([
            ...(host?.issueGroups ?? []).map((group) =>
              issueGroupSessionWorkdir(
                group,
                issueTabSessionId(group) ?? "",
                host?.workdir,
              ),
            ),
            ...(host?.recentWorkdirs ?? []),
          ])
        : [],
    [
      assistantVisible,
      host?.issueGroups,
      host?.recentWorkdirs,
      host?.workdir,
    ],
  );
  const fileTreeWorkdir = assistantVisible
    ? workdirForFile(shownActiveFilePath, knownWorkdirs)
    : dockWorkdir;
  // A new terminal starts where the file tree points; without a tree (no file
  // open, or the file is outside known dirs) fall back to the issue directory.
  const terminalWorkdir = fileTreeWorkdir ?? dockWorkdir;
  const terminalWorkdirRef = useRef(terminalWorkdir);
  terminalWorkdirRef.current = terminalWorkdir;
  const fileTreeGroup = usePanelGroupStore((state) =>
    fileTreeWorkdir ? state.groups[fileTreeWorkdir] : undefined,
  );
  const treeContentSearch = fileTreeGroup?.contentSearch;
  const shownFileTree = fileTreeWorkdir
    ? {
        ...fileTree,
        expanded: fileTreeGroup?.fileTree?.expanded ?? EMPTY_EXPANDED,
        selected: fileTreeGroup?.fileTree?.selected,
        childrenCache:
          fileTreeGroup?.fileTree?.childrenCache ?? EMPTY_LISTING_CACHE,
      }
    : fileTree;
  const shownContentSearch = treeContentSearch ?? contentSearch;
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
  // directory has its own dock. Muse Bot shows the selected issue's directory.
  // 会话 shows the open session's directory. 设置, 自动化, and the draft page do not
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

  return {
    dockIssueId,
    dockIssueGroup,
    onSessionsSurface,
    dockWorkdir,
    fileTreeWorkdir,
    knownWorkdirs,
    panelWorkdir,
    followIssueTools,
    groupKey,
    groupKeyRef,
    assistantVisibleRef,
    onSessionsSurfaceRef,
    terminalWorkdirRef,
    dockIssueIdRef,
    vscodeRef,
    previewGroupKeyRef,
    fileContentGroupKeyRef,
    checkedPanels,
    mountedPanels,
    activePanel,
    dockFullscreen,
    previewUrl,
    diffView,
    fileSidebarMode,
    previewTitle,
    assistantTools,
    assistantActiveFilePath,
    assistantActiveToolId,
    dockTabOrder,
    chromeChecked,
    chromeActive,
    slotCheckedWithFile,
    slotMountedWithFile,
    assistantWidths,
    shownWidths,
    shownFileTabs,
    shownActiveFilePath,
    shownFileTree,
    shownContentSearch,
    shownPreviewUrl,
    shownForward,
    shownForwardError,
    shownPreviewEpoch,
    fileView,
    selectDockRef,
    dockChromeRef,
  };
}

export type DockSurface = ReturnType<typeof useDockSurface>;
