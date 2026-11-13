import { useCallback, useRef } from "react";
import type React from "react";
import type { BotWorkspaceContextValue } from "../components/desktop/BotTabs";
import type { DockChrome } from "../components/desktop/botWorkspace";
import {
  DOCK_TAB_DETAIL_KEY,
  defaultDockTabKeys,
  fileTabKey,
  insertTabAfterCurrent,
  kindTabKey,
  toolTabKey,
} from "../muse/dockTabOrder";
import { DOCK_DETAIL_TAB } from "../muse/panelTabs";
import {
  activePreviewTool,
  appendDockTool,
  botToolTermId,
  createDockToolId,
  nextDockToolId,
  patchDockTool,
  rebuildTerminalTool,
  removeDockTool,
} from "../muse/dockTools";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  EMPTY_DOCK_TOOLS,
  resolvePanelGroup,
  usePanelGroupStore,
  type DockToolInstance,
  type PanelGroupState,
} from "../stores";
import type { DesktopPanelKind, VsCodeApi } from "../types";

type FileTab = { path: string; tabKey?: string };
type ToolTab = { id: string; kind: DesktopPanelKind };

/**
 * Terminal and browser tabs that belong to Muse Bot rather than an issue
 * directory. Opening one also moves the dock chrome off 详情.
 */
export function useBotDockTools({
  assistantVisible,
  workspace,
  chromeChecked,
  activePanel,
  shownFileTabs,
  shownActiveFilePath,
  assistantActiveToolId,
  assistantTools,
  slotCheckedWithFile,
  groupKey,
  selectDockRef,
  dockWorkdirRef,
  vscodeRef,
  dockChromeRef,
  assistantVisibleRef,
  dockIssueIdRef,
  onSessionsSurface,
  groupKeyRef,
  setAssistantDockOpen,
}: {
  assistantVisible: boolean;
  workspace: BotWorkspaceContextValue;
  chromeChecked: readonly string[];
  activePanel: DesktopPanelKind | null;
  shownFileTabs: readonly FileTab[];
  shownActiveFilePath: string | null;
  assistantActiveToolId: string | null;
  assistantTools: readonly ToolTab[];
  slotCheckedWithFile: readonly string[];
  groupKey: string | undefined;
  selectDockRef: React.MutableRefObject<(kind: DockChrome) => void>;
  dockWorkdirRef: React.MutableRefObject<string | null | undefined>;
  vscodeRef: React.MutableRefObject<VsCodeApi>;
  dockChromeRef: React.MutableRefObject<DockChrome>;
  assistantVisibleRef: React.MutableRefObject<boolean>;
  dockIssueIdRef: React.MutableRefObject<string | null | undefined>;
  onSessionsSurface: boolean;
  groupKeyRef: React.MutableRefObject<string | undefined>;
  setAssistantDockOpen: (open: boolean) => void;
}) {
  const beforeToggleRef = useRef<((kind: DesktopPanelKind) => boolean) | null>(null);
  const panelShortcutRef = useRef<((kind: DesktopPanelKind) => boolean) | null>(null);
  const placeKindRef = useRef<
    ((kind: DesktopPanelKind, atEnd?: boolean) => void) | null
  >(null);
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
  const activeShownFile = shownFileTabs.find((tab) => tab.path === shownActiveFilePath);
  const currentFileKey =
    visibleKind === "file" && activeShownFile
      ? fileTabKey(activeShownFile.tabKey ?? activeShownFile.path)
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
      filePaths: shownFileTabs.map((tab) => tab.tabKey ?? tab.path),
      tools: assistantVisible ? assistantTools : [],
    }),
    current: showingDetail
      ? DOCK_TAB_DETAIL_KEY
      : (currentToolKey ?? currentFileKey ?? (visibleKind ? kindTabKey(visibleKind) : null)),
  };

  // Stable action bag: callers keep the same function identity across renders so
  // React fibers / effects do not retain a fresh closure (and its ChatState
  // sibling scope) on every dock interaction.
  const onSessionsSurfaceRef = useRef(onSessionsSurface);
  onSessionsSurfaceRef.current = onSessionsSurface;
  const setAssistantDockOpenRef = useRef(setAssistantDockOpen);
  setAssistantDockOpenRef.current = setAssistantDockOpen;
  const assistantVisibleForForwardRef = useRef(assistantVisible);
  assistantVisibleForForwardRef.current = assistantVisible;

  const placeForwardRef = useRef<
    ((fwd: NonNullable<PanelGroupState["forward"]>) => void) | null
  >(null);
  const focusOrOpenBotPreviewRef = useRef<() => boolean>(() => false);
  const handleAddPanelRef = useRef<(kind: DesktopPanelKind) => void>(() => {});
  const tryOpenPanelRef = useRef<(kind: DesktopPanelKind) => boolean>(() => false);

  const actionsRef = useRef({
    readAssistantTools: () => {
      const store = usePanelGroupStore.getState();
      const group = resolvePanelGroup(store.groups, ASSISTANT_PANEL_GROUP_KEY);
      return { store, group, tools: group.tools ?? EMPTY_DOCK_TOOLS };
    },
    placeDockTab: (_newKey: string, _atEnd?: boolean) => {},
    focusBotTool: (_id: string) => {},
    openBotTerminal: (_placeAtEnd?: boolean): boolean => false,
    openBotPreview: (_placeAtEnd?: boolean): boolean => false,
    focusOrOpenBotPreview: (): boolean => false,
    closeBotTool: (_id: string) => {},
    restartBotTerminal: (_id: string) => {},
  });

  actionsRef.current.placeDockTab = (newKey: string, atEnd = false) => {
    const placed = dockTabPlaceRef.current;
    if (!placed.orderKey) return;
    const store = usePanelGroupStore.getState();
    store.patchGroup(placed.orderKey, {
      tabOrder: insertTabAfterCurrent(
        store.groups[placed.orderKey]?.tabOrder,
        placed.present,
        atEnd ? null : placed.current,
        newKey,
      ),
    });
  };
  actionsRef.current.focusBotTool = (id: string) => {
    const { store, tools } = actionsRef.current.readAssistantTools();
    const tool = tools.find((item) => item.id === id);
    if (!tool) return;
    store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, { activeToolId: id });
    selectDockRef.current(tool.kind);
  };
  actionsRef.current.openBotTerminal = (placeAtEnd = false): boolean => {
    const cwd = dockWorkdirRef.current?.trim();
    if (!cwd) return false;
    const tool: DockToolInstance = {
      id: createDockToolId("terminal"),
      kind: "terminal",
      workdir: cwd,
    };
    const { store, group, tools } = actionsRef.current.readAssistantTools();
    const placed = dockTabPlaceRef.current;
    store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      tools: appendDockTool(tools, tool),
      activeToolId: tool.id,
      tabOrder: insertTabAfterCurrent(
        group.tabOrder,
        placed.present,
        placeAtEnd ? null : placed.current,
        toolTabKey(tool.id),
      ),
    });
    selectDockRef.current("terminal");
    return true;
  };
  actionsRef.current.openBotPreview = (placeAtEnd = false): boolean => {
    const tool: DockToolInstance = {
      id: createDockToolId("preview"),
      kind: "preview",
      previewUrl: null,
      forward: null,
      forwardError: null,
      epoch: 0,
    };
    const { store, group, tools } = actionsRef.current.readAssistantTools();
    const placed = dockTabPlaceRef.current;
    store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      tools: appendDockTool(tools, tool),
      activeToolId: tool.id,
      tabOrder: insertTabAfterCurrent(
        group.tabOrder,
        placed.present,
        placeAtEnd ? null : placed.current,
        toolTabKey(tool.id),
      ),
    });
    selectDockRef.current("preview");
    return true;
  };
  actionsRef.current.focusOrOpenBotPreview = (): boolean => {
    const { tools, group } = actionsRef.current.readAssistantTools();
    const existing = activePreviewTool(tools, group.activeToolId);
    if (existing) {
      actionsRef.current.focusBotTool(existing.id);
      return true;
    }
    return actionsRef.current.openBotPreview();
  };
  actionsRef.current.closeBotTool = (id: string) => {
    const { store, tools, group } = actionsRef.current.readAssistantTools();
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

  actionsRef.current.restartBotTerminal = (id: string) => {
    const { store, tools, group } = actionsRef.current.readAssistantTools();
    const closed = tools.find((tool) => tool.id === id && tool.kind === "terminal");
    if (!closed) return;
    // 重建的终端按“当前事项 / 助手”的目录来：Muse Bot 选着事项时是事项目录，
    // 没选事项时是助手自己的目录。dockWorkdir 为空才退回这个标签原来的目录。
    const workdir = dockWorkdirRef.current?.trim() || closed.workdir;
    if (!workdir) return;
    // 关掉旧终端：新标签有自己的 id 和 PTY，旧进程必须显式收掉。
    vscodeRef.current.postMessage({
      command: "desktopTerminalKill",
      termId: botToolTermId(id),
    });
    const nextId = createDockToolId("terminal");
    const tabOrder = group.tabOrder?.map((key) =>
      key === toolTabKey(id) ? toolTabKey(nextId) : key,
    );
    store.patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
      tools: rebuildTerminalTool(tools, id, workdir, nextId),
      activeToolId: group.activeToolId === id ? nextId : group.activeToolId,
      ...(tabOrder ? { tabOrder } : {}),
    });
    setAssistantDockOpenRef.current(true);
    selectDockRef.current("terminal");
  };

  placeKindRef.current = (kind, atEnd = false) =>
    actionsRef.current.placeDockTab(kindTabKey(kind), atEnd);
  focusOrOpenBotPreviewRef.current = () =>
    actionsRef.current.focusOrOpenBotPreview();
  beforeToggleRef.current = (kind) => {
    if (!assistantVisibleRef.current) return false;
    if (kind !== "terminal" && kind !== "preview") return false;
    const { tools, group } = actionsRef.current.readAssistantTools();
    const ofKind = tools.filter((tool) => tool.kind === kind);
    if (ofKind.length === 0) {
      if (!dockIssueIdRef.current && group.checked.includes(kind)) return false;
      if (kind === "terminal") {
        actionsRef.current.openBotTerminal();
        return true;
      }
      actionsRef.current.openBotPreview();
      return true;
    }
    const active =
      ofKind.find((tool) => tool.id === group.activeToolId) ?? ofKind[ofKind.length - 1];
    if (dockChromeRef.current === kind && group.activeToolId === active.id) {
      actionsRef.current.closeBotTool(active.id);
      return true;
    }
    actionsRef.current.focusBotTool(active.id);
    return true;
  };
  panelShortcutRef.current = (kind) => {
    if (!assistantVisibleRef.current) {
      // 会话页的选中项和 Muse Bot 共用。快捷键只改目录里的 active 时，
      // 开过浏览器之后界面仍停在原来的那种面板上。
      if (onSessionsSurfaceRef.current) selectDockRef.current(kind);
      return false;
    }
    if (kind === "terminal" || kind === "preview") {
      const { tools, group } = actionsRef.current.readAssistantTools();
      const ofKind = tools.filter((tool) => tool.kind === kind);
      if (ofKind.length === 0) {
        if (!dockIssueIdRef.current && group.checked.includes(kind)) return false;
        setAssistantDockOpenRef.current(true);
        if (kind === "terminal") actionsRef.current.openBotTerminal();
        else actionsRef.current.openBotPreview();
        return true;
      }
      const active =
        ofKind.find((tool) => tool.id === group.activeToolId) ?? ofKind[ofKind.length - 1];
      setAssistantDockOpenRef.current(true);
      actionsRef.current.focusBotTool(active.id);
      return true;
    }
    handleAddPanelRef.current(kind);
    const key = groupKeyRef.current;
    const group = key ? usePanelGroupStore.getState().groups[key] : undefined;
    if (!group?.checked.includes(kind) && group?.active !== kind) return true;
    setAssistantDockOpenRef.current(true);
    selectDockRef.current(kind);
    return true;
  };
  const tryOpenForPreview = useCallback((kind: DesktopPanelKind) => {
    if (assistantVisibleRef.current && kind === "preview") {
      return focusOrOpenBotPreviewRef.current();
    }
    return tryOpenPanelRef.current(kind);
  }, []);
  placeForwardRef.current = assistantVisibleForForwardRef.current
    ? (fwd) => {
        const { store, tools, group } = actionsRef.current.readAssistantTools();
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

  const openBotTerminal = useCallback(
    (placeAtEnd?: boolean) => actionsRef.current.openBotTerminal(placeAtEnd),
    [],
  );
  const openBotPreview = useCallback(
    (placeAtEnd?: boolean) => actionsRef.current.openBotPreview(placeAtEnd),
    [],
  );
  const focusBotTool = useCallback(
    (id: string) => actionsRef.current.focusBotTool(id),
    [],
  );
  const closeBotTool = useCallback(
    (id: string) => actionsRef.current.closeBotTool(id),
    [],
  );
  const restartBotTerminal = useCallback(
    (id: string) => actionsRef.current.restartBotTerminal(id),
    [],
  );
  const readAssistantTools = useCallback(
    () => actionsRef.current.readAssistantTools(),
    [],
  );

  return {
    beforeToggleRef,
    panelShortcutRef,
    placeKindRef,
    placeForwardRef,
    focusOrOpenBotPreviewRef,
    tryOpenPanelRef,
    tryOpenForPreview,
    handleAddPanelRef,
    openBotTerminal,
    openBotPreview,
    focusBotTool,
    closeBotTool,
    restartBotTerminal,
    readAssistantTools,
  };
}
