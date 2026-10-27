import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type { DesktopHostProps, DesktopPanelKind } from "../types";
import {
  matchPanelShortcut,
  matchNewSessionShortcut,
  matchQuickOpenShortcut,
  matchDockFullscreenShortcut,
  matchDockToggleShortcut,
} from "../muse/panelShortcuts";
import { planPanelWidthsForOpen, firstOpenDockWidths } from "../muse/panelFit";
import { PANEL_MIN_WIDTH, clampDockWidth } from "../muse/layout";
import { defaultDockKind, PANEL_TAB_ORDER } from "../muse/panelTabs";
import { collapseDockState, expandDockState } from "../muse/dockActions";
import {
  usePanelGroupStore,
  emptyPanelGroup,
  nextActivePanelAfterClose,
  releasePanelContent,
  PANEL_DEFAULT_WIDTH,
  type RemoteForwardRef,
} from "../stores";
import type { MainView } from "../components/ChatApp";
import type { ChatAppCore } from "./useChatAppCore";

/** Desktop conversation-level panels: tab order in the shared dock. */
const PANEL_ORDER = PANEL_TAB_ORDER;

export interface PanelHandlers {
  tryOpenPanel: (kind: DesktopPanelKind) => boolean;
  handleTogglePanel: (kind: DesktopPanelKind) => void;
  handleToggleDock: () => void;
  handleAddPanel: (kind: DesktopPanelKind) => void;
  handleToggleFullscreen: () => void;
  handleSelectPanel: (kind: DesktopPanelKind) => void;
  handleDockWidthChange: (width: number) => void;
  showPanelHint: (text: string) => void;
  acquireForward: (host: string, url: string) => void;
  panelDisabled: DesktopPanelKind[];
}

interface UsePanelsParams {
  postToHost: ChatAppCore["postToHost"];
  updatePanelGroup: ChatAppCore["updatePanelGroup"];
  /** Dock column width. Muse Bot and 会话 share one width, separate from the directory group. */
  updateWidthGroup?: ChatAppCore["updatePanelGroup"];
  groupKey?: string;
  /** Where the browser forward record and its preview URL are stored. */
  forwardGroupKeyRef?: MutableRefObject<string | undefined>;
  panelWorkdir?: string;
  chatContainerRef: RefObject<HTMLDivElement>;
  togglePanelRef: MutableRefObject<(kind: DesktopPanelKind) => void>;
  toggleFullscreenRef: MutableRefObject<() => void>;
  /** When set, ⌘J uses this instead of the kind-only dock toggle. */
  dockToggleHandlerRef?: MutableRefObject<(() => void) | null>;
  isDraftSession: boolean;
  host?: DesktopHostProps;
  paneId?: string;
  setView: Dispatch<SetStateAction<MainView>>;
  setQuickOpenOpen: Dispatch<SetStateAction<boolean>>;
  checkedPanels: DesktopPanelKind[];
  mountedPanels: DesktopPanelKind[];
  activePanel: DesktopPanelKind | null;
  panelWidths: Record<DesktopPanelKind, number>;
  dockMaxWidth: number;
  /** Conversation min width for this pane (includes overlay-sidebar padding when inset). */
  chatMinWidth: number;
  /** Assistant dock keeps 文件 / 终端 / 浏览器 and drops 变更. */
  hideDiff?: boolean;
  /** Browser can open before a workdir exists (assistant page). */
  previewWithoutWorkdir?: boolean;
  /** When this returns true, the kind toggle is already handled (bot terminals/browsers). */
  beforeToggleRef?: MutableRefObject<((kind: DesktopPanelKind) => boolean) | null>;
  /** When set, a remote preview forward is stored here instead of the group record. */
  placeForwardRef?: MutableRefObject<((fwd: RemoteForwardRef) => void) | null>;
  /** Called when a kind tab is actually added, so it can sit after the current tab. */
  placeKindRef?: MutableRefObject<((kind: DesktopPanelKind) => void) | null>;
}

export function usePanels({
  postToHost,
  updatePanelGroup,
  updateWidthGroup,
  groupKey,
  forwardGroupKeyRef,
  panelWorkdir,
  chatContainerRef,
  togglePanelRef,
  toggleFullscreenRef,
  dockToggleHandlerRef,
  isDraftSession,
  host,
  paneId,
  setView,
  setQuickOpenOpen,
  checkedPanels,
  mountedPanels,
  activePanel,
  panelWidths,
  dockMaxWidth,
  chatMinWidth,
  hideDiff = false,
  previewWithoutWorkdir = false,
  beforeToggleRef,
  placeForwardRef,
  placeKindRef,
}: UsePanelsParams): PanelHandlers {
  // Mirrors so the stable message listener / shortcut handler can reach the
  // panel toggle logic without re-subscribing.
  const checkedPanelsRef = useRef(checkedPanels);
  const mountedPanelsRef = useRef(mountedPanels);
  const panelWidthsRef = useRef(panelWidths);
  const panelDisabledRef = useRef<DesktopPanelKind[]>([]);
  const forwardSeqRef = useRef(0);

  useEffect(() => {
    checkedPanelsRef.current = checkedPanels;
  }, [checkedPanels]);

  useEffect(() => {
    mountedPanelsRef.current = mountedPanels;
  }, [mountedPanels]);

  useEffect(() => {
    panelWidthsRef.current = panelWidths;
  }, [panelWidths]);

  const writeWidths = updateWidthGroup ?? updatePanelGroup;

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
      const storeKey = forwardGroupKeyRef?.current || groupKey;
      if (placeForwardRef?.current) placeForwardRef.current(fwd);
      else usePanelGroupStore.getState().patchGroup(storeKey, { forward: fwd });
      // The session id scopes the tunnel's lifetime on the host — it stays alive
      // across UI actions and is only released when the session is deleted
      // (scenario 18). The forward record itself follows the issue directory
      // so the reply writes that directory's preview URL.
      postToHost({
        command: "desktopForwardPort",
        host,
        url,
        requestId,
        sessionId: groupKey,
      });
    },
    [postToHost, showPanelHint, groupKey, forwardGroupKeyRef],
  );

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
          const leftover = containerW - chatMinWidth;
          const panelMin =
            leftover > 0 ? Math.min(PANEL_MIN_WIDTH, leftover) : PANEL_MIN_WIDTH;
          // 详情 isn't a kind. If it already sized the column (or the user
          // dragged it), keep that width. Only a still-untouched dock takes
          // the first-open default here.
          const untouched =
            mountedPanelsRef.current.length === 0 &&
            PANEL_ORDER.every(
              (k) => panelWidthsRef.current[k] === PANEL_DEFAULT_WIDTH,
            );
          const seeded = untouched
            ? firstOpenDockWidths(containerW, chatMinWidth)
            : null;
          const baseWidths = seeded ?? panelWidthsRef.current;
          const planned = planPanelWidthsForOpen(
            containerW,
            [],
            baseWidths,
            kind,
            { panelMin, chatMin: chatMinWidth },
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
            writeWidths({ widths: planned.widths });
          }
        }
      }
      placeKindRef?.current?.(kind);
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
    [showPanelHint, updatePanelGroup, writeWidths, chatMinWidth],
  );

  const handleTogglePanel = useCallback(
    (kind: DesktopPanelKind) => {
      if (beforeToggleRef?.current?.(kind)) return;
      if (panelDisabledRef.current.includes(kind)) return;
      if (checkedPanelsRef.current.includes(kind)) {
        updatePanelGroup((group) => {
          const nextChecked = group.checked.filter((k) => k !== kind);
          // Release the closed panel's large payloads (file content up to 2MB,
          // search results, diff snapshots). Without this they'd stay pinned
          // for the whole workdir lifetime (groups are keyed by workdir).
          const released = releasePanelContent(group, kind);
          if (nextChecked.length === 0) {
            return {
              ...collapseDockState({
                checked: group.checked,
                active: group.active,
              }),
              ...released,
            };
          }
          return {
            active: nextActivePanelAfterClose(
              group.checked,
              kind,
              group.active,
            ),
            checked: nextChecked,
            ...released,
          };
        });
        // Closing the preview hides the pane but never releases a remote tunnel
        // (scenario 18): the URL stays cached so re-checking shows the same page,
        // and the host keeps the ssh forward alive until the session is deleted.
      } else {
        tryOpenPanel(kind);
      }
    },
    [beforeToggleRef, tryOpenPanel, updatePanelGroup],
  );

  const handleToggleDock = useCallback(() => {
    if (!groupKey) return;
    const group =
      usePanelGroupStore.getState().groups[groupKey] ??
      emptyPanelGroup();
    if (group.checked.length > 0) {
      updatePanelGroup(collapseDockState(group));
      return;
    }
    if (group.collapsedTabs?.checked.length) {
      const next = expandDockState(group.collapsedTabs);
      updatePanelGroup({
        ...next,
        mounted: Array.from(new Set([...group.mounted, ...next.checked])),
      });
      return;
    }
    const kind = defaultDockKind(panelDisabledRef.current);
    if (kind) tryOpenPanel(kind);
  }, [groupKey, tryOpenPanel, updatePanelGroup]);

  const toggleDockRef = useRef(handleToggleDock);
  toggleDockRef.current = handleToggleDock;

  const handleAddPanel = useCallback(
    (kind: DesktopPanelKind) => {
      if (panelDisabledRef.current.includes(kind)) return;
      if (checkedPanelsRef.current.includes(kind)) {
        updatePanelGroup({ active: kind });
        return;
      }
      tryOpenPanel(kind);
    },
    [tryOpenPanel, updatePanelGroup],
  );

  const handleToggleFullscreen = useCallback(() => {
    updatePanelGroup((group) => {
      if (group.checked.length === 0) return { dockFullscreen: false };
      return { dockFullscreen: !group.dockFullscreen };
    });
  }, [updatePanelGroup]);

  const handleSelectPanel = useCallback(
    (kind: DesktopPanelKind) => {
      updatePanelGroup({ active: kind });
    },
    [updatePanelGroup],
  );

  useEffect(() => {
    togglePanelRef.current = handleTogglePanel;
  }, [handleTogglePanel]);

  useEffect(() => {
    toggleFullscreenRef.current = handleToggleFullscreen;
  }, [handleToggleFullscreen]);

  // Desktop panel shortcuts (labels in PanelAddMenu). Shell host instance
  // must not bind — only the focused pane ChatApp (or single-pane layout).
  useEffect(() => {
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
        // 与侧栏新对话按钮一致：同步退出机器人页等其它视图。
        setView("chat");
        postToHost({ command: "newSession" });
        return;
      }
      if (!isDraftSession && matchQuickOpenShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        setQuickOpenOpen(true);
        return;
      }
      if (matchDockToggleShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        (dockToggleHandlerRef?.current ?? toggleDockRef.current)();
        return;
      }
      if (matchDockFullscreenShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        toggleFullscreenRef.current();
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
  }, [
    isDraftSession,
    host?.panes?.length,
    host?.focusedPaneId,
    paneId,
    postToHost,
  ]);

  // Authoritative clamp at drag time: keep the panel within [320, container -
  // other checked panels - conversation minimum].
  const handleDockWidthChange = useCallback((width: number) => {
    let clamped = width;
    const containerW =
      chatContainerRef.current?.clientWidth ||
      chatContainerRef.current?.getBoundingClientRect().width;
    if (containerW) {
      clamped = clampDockWidth(width, containerW - chatMinWidth);
    } else {
      clamped = clampDockWidth(width, dockMaxWidth);
    }
    const next = {
      preview: clamped,
      diff: clamped,
      terminal: clamped,
      file: clamped,
    };
    panelWidthsRef.current = next;
    writeWidths({ widths: next });
  }, [writeWidths, chatMinWidth, dockMaxWidth]);

  // No workdir: all panels disabled. With a workdir (incl. draft + host
  // folder): all panel kinds available; state is shared per workdir.
  // The assistant dock always hides 变更, and can open the browser before
  // its workdir has loaded.
  const panelDisabled: DesktopPanelKind[] = useMemo(() => {
    const hidden = new Set<DesktopPanelKind>(hideDiff ? ["diff"] : []);
    if (!panelWorkdir) {
      for (const kind of PANEL_ORDER) {
        if (kind === "preview" && previewWithoutWorkdir) continue;
        hidden.add(kind);
      }
    }
    return PANEL_ORDER.filter((kind) => hidden.has(kind));
  }, [panelWorkdir, hideDiff, previewWithoutWorkdir]);

  useEffect(() => {
    panelDisabledRef.current = panelDisabled;
  }, [panelDisabled]);

  // Report this pane's toggle state so the desktop app menu's 面板 checkboxes
  // reflect the focused pane.
  useEffect(() => {
    postToHost({ command: "desktopPanelState", checked: checkedPanels });
  }, [checkedPanels, postToHost]);

  // Persist a clamp when the pane shrinks (window resize / split) so the next
  // drag/open starts from a width that still fits beside the conversation.
  useEffect(() => {
    if (checkedPanels.length === 0) return;
    if (!(dockMaxWidth > 0)) return;
    const current = panelWidthsRef.current[activePanel ?? "preview"];
    if (!(current > dockMaxWidth)) return;
    const clamped = clampDockWidth(current, dockMaxWidth);
    const next = {
      preview: clamped,
      diff: clamped,
      terminal: clamped,
      file: clamped,
    };
    panelWidthsRef.current = next;
    writeWidths({ widths: next });
  }, [
    checkedPanels.length,
    activePanel,
    dockMaxWidth,
    writeWidths,
  ]);

  return {
    tryOpenPanel,
    handleTogglePanel,
    handleToggleDock,
    handleAddPanel,
    handleToggleFullscreen,
    handleSelectPanel,
    handleDockWidthChange,
    showPanelHint,
    acquireForward,
    panelDisabled,
  };
}
