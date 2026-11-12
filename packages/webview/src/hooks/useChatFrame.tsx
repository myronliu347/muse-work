import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { MessageInputHandle } from "../components/chat/MessageInput";
import { activePreviewTool } from "../muse/dockTools";
import { isSplitDragging, onSplitDragEnd } from "../muse/splitDrag";
import type { MuseApiClient } from "../muse/apiClient";
import { useScenarioModelsStore } from "../stores/scenarioModelsStore";
import { createMessageHandler } from "../muse/messageRouter";
import type { ChatAction, ChatState, DesktopHostProps, DesktopPanelKind, VsCodeApi } from "../types";
import type { ShellSurface } from "../components/desktop/shellSurface";
import type { MainView } from "../components/ChatApp";

/** Column measurement, quick-open state, and the host message listener. */
export function useChatFrame({
  previewUrl,
  assistantVisible,
  assistantTools,
  assistantActiveToolId,
  shownPreviewUrl,
  paneId,
  host,
  view,
  shellSurface,
  state,
  dispatch,
  vscode,
  groupKeyRef,
  previewGroupKeyRef,
  fileContentGroupKeyRef,
  noPaneDesktop,
  noPaneRail,
  setView,
  providedShellSurface,
  museApi,
}: {
  previewUrl: string | null;
  assistantVisible: boolean;
  assistantTools: Parameters<typeof activePreviewTool>[0];
  assistantActiveToolId: string | null;
  shownPreviewUrl: string | null;
  paneId: string | undefined;
  host: DesktopHostProps | undefined;
  view: MainView;
  shellSurface: ShellSurface;
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  vscode: VsCodeApi;
  groupKeyRef: MutableRefObject<string | undefined>;
  previewGroupKeyRef: MutableRefObject<string | undefined>;
  fileContentGroupKeyRef: MutableRefObject<string | undefined>;
  noPaneDesktop: boolean;
  noPaneRail: ShellSurface;
  setView: Dispatch<SetStateAction<MainView>>;
  providedShellSurface: ShellSurface | null;
  museApi: MuseApiClient;
}) {
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
  const assistantInputRef = useRef<MessageInputHandle>(null);
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
  // Do not measure in a layout effect with no deps: the measured width is
  // written back into the layout, so every commit saw a new clientWidth and
  // setState never settled.
  const measureFrame = useCallback(() => {
    // During a split drag the columns move every frame; measuring here would
    // re-render per frame and feed the new width back into the layout. The
    // drag notifies once when it ends.
    if (isSplitDragging()) return;
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
  }, [measureFrame, paneId, host?.panes?.length, view, shellSurface]);
  useEffect(() => onSplitDragEnd(measureFrame), [measureFrame]);
  useEffect(() => {
    window.addEventListener("resize", measureFrame);
    window.visualViewport?.addEventListener("resize", measureFrame);
    const el = chatContainerRef.current;
    let ro: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => measureFrame());
      ro.observe(el);
      const main = el.querySelector(".desktop-chat-main");
      if (main) ro.observe(main);
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
          fileContentGroupKeyRef,
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

  return {
    previewUrlRef,
    chatContainerRef,
    chatColumnWidth,
    leftPanelWidth,
    quickOpenOpen,
    setQuickOpenOpen,
    quickOpenQuery,
    setQuickOpenQuery,
    showNewIssue,
    setShowNewIssue,
    planningIssueId,
    setPlanningIssueId,
    togglePanelRef,
    toggleFullscreenRef,
    messageInputRef,
    assistantInputRef,
    messageListRef,
    stateRef,
    paneIdRef,
    hostRef,
  };
}
