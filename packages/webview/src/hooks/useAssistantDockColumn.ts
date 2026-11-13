import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { restoredDockAlreadyOpen } from "../muse/botPageState";
import { clampDockWidth } from "../muse/layout";
import { firstOpenDockWidths } from "../muse/panelFit";
import {
  ASSISTANT_PANEL_GROUP_KEY,
  PANEL_DEFAULT_WIDTH,
  usePanelGroupStore,
  type PanelGroupState,
} from "../stores";
import type { DesktopPanelKind } from "../types";

/** Muse Bot dock column: open flag, first-open widths, and the pinned chat width. */
export function useAssistantDockColumn({
  assistantVisible,
  dockIssueId,
  dockWorkdir,
  checkedPanels,
  workspaceActive,
  assistantWidths,
  chatColumnWidth,
  chatContainerRef,
  layoutChatMin,
  dockMaxWidth,
  dockFullscreen,
}: {
  assistantVisible: boolean;
  dockIssueId: string | null | undefined;
  dockWorkdir: string | null | undefined;
  checkedPanels: readonly string[];
  workspaceActive: string;
  assistantWidths: Record<DesktopPanelKind, number>;
  chatColumnWidth: number;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  layoutChatMin: number;
  dockMaxWidth: number;
  dockFullscreen: boolean;
}) {
  const workspace = { active: workspaceActive };
  const assistantDockToggleRef = useRef<(() => void) | null>(null);
  const restoreAssistantToolsRef = useRef(false);
  const assistantDockSeenOpen = useRef(restoredDockAlreadyOpen());
  const [assistantDockOpen, setAssistantDockOpenState] = useState(
    () =>
      usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY]?.dockColumnOpen ===
      true,
  );
  // Pixel width of the chat column while the dock is open. Window resize
  // leaves this alone so the dock absorbs the change.
  const [chatPaneWidth, setChatPaneWidth] = useState<number | null>(null);
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
    const group = usePanelGroupStore.getState().groups[ASSISTANT_PANEL_GROUP_KEY];
    const checked = group?.checked ?? [];
    if (checked.includes("diff")) return;
    const untouched = checked.length === 0 && !group?.collapsedTabs;
    if (!justOpened && !untouched) return;
    usePanelGroupStore.getState().patchGroup(ASSISTANT_PANEL_GROUP_KEY, {
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
  useLayoutEffect(() => {
    if (!assistantVisible || !assistantDockOpen || dockFullscreen) {
      setChatPaneWidth(null);
      return;
    }
    // Let the first-open width land before the chat column is pinned to it.
    const waitingForFirstWidth =
      checkedPanels.length === 0 &&
      assistantWidths.preview === PANEL_DEFAULT_WIDTH &&
      assistantWidths.diff === PANEL_DEFAULT_WIDTH &&
      assistantWidths.terminal === PANEL_DEFAULT_WIDTH &&
      assistantWidths.file === PANEL_DEFAULT_WIDTH;
    if (waitingForFirstWidth) return;
    setChatPaneWidth((current) => {
      if (current != null) return current;
      const dockPx = clampDockWidth(
        assistantWidths.preview,
        Math.max(0, dockMaxWidth),
      );
      if (!(chatColumnWidth > 0) || !(dockPx > 0)) return null;
      return Math.max(0, Math.round(chatColumnWidth - dockPx));
    });
  }, [
    assistantVisible,
    assistantDockOpen,
    dockFullscreen,
    checkedPanels.length,
    assistantWidths,
    chatColumnWidth,
    dockMaxWidth,
  ]);

  const handleToggleDockRef = useRef<(() => void) | null>(null);
  const toggleAssistantDock = useCallback(() => {
    const handleToggleDock = handleToggleDockRef.current;
    if (!handleToggleDock) return;
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
    setAssistantDockOpen,
  ]);
  const pinChatPaneAfterDrag = useCallback((width: number) => {
    const frame = chatContainerRef.current?.clientWidth ?? 0;
    if (!(frame > 0)) return;
    setChatPaneWidth(Math.max(0, Math.round(frame - width)));
  }, []);

  return {
    assistantDockOpen,
    setAssistantDockOpen,
    chatPaneWidth,
    setChatPaneWidth,
    assistantDockToggleRef,
    restoreAssistantToolsRef,
    updateMuseWidthGroup,
    assistantView,
    onAssistantViewMode,
    toggleAssistantDock,
    pinChatPaneAfterDrag,
    handleToggleDockRef,
  };
}
