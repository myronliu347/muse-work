import React from "react";
import type { DesktopPanelKind, FileViewState, PanelToggleProps } from "../../types";
import {
  DOCK_DETAIL_TAB,
  PANEL_ADD_ORDER,
  PANEL_TAB_ICONS,
  PANEL_TAB_LABELS,
} from "../../muse/panelTabs";
import {
  DOCK_TAB_DETAIL_KEY,
  activeDockTabKey,
  defaultDockTabKeys,
  filePathFromTabKey,
  moveDockTab,
  reconcileTabOrder,
  toolIdFromTabKey,
} from "../../muse/dockTabOrder";
import { dockFullscreenShortcutLabel, stepTab } from "../../muse/panelShortcuts";
import { registerSidePanel } from "../../muse/sidePanelTabs";
import { PanelToggleControl } from "../panels/PanelToggleControl";
import { PanelAddMenu } from "../panels/PanelAddMenu";
import { FileIcon } from "../panels/FileIcon";
import { IssuePresenceMark, type IssuePresence } from "../session/SessionStatusGlyph";
import { Tooltip } from "../shared/Tooltip";
import "../../styles/DesktopPanelDock.css";
import { clampDockWidth } from "../../muse/layout";
import { PANEL_MOTION_MS } from "../../hooks/useExitHold";
import { useScrollOverflow } from "../../hooks/useScrollOverflow";

export interface DockToolTab {
  id: string;
  kind: "terminal" | "preview";
  label: string;
  title: string;
}

/** Bring a dock tab into view (详情, 变更, 浏览器, a tool, or a file). The
 * strip scrolls horizontally, so a tab past the edge is otherwise only partly
 * reachable. Nearest alignment — no centering. scroll-behavior on the strip
 * eases the move. */
function scrollDockTabIntoView(container: HTMLElement, tab: HTMLElement) {
  const { scrollLeft, clientWidth } = container;
  const left = tab.offsetLeft;
  const right = left + tab.offsetWidth;
  if (left < scrollLeft) {
    container.scrollLeft = left;
  } else if (right > scrollLeft + clientWidth) {
    container.scrollLeft = right - clientWidth;
  }
}

export interface DesktopPanelDockProps {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind;
  onSelect: (kind: DesktopPanelKind) => void;
  onCloseTab: (kind: DesktopPanelKind) => void;
  onAddPanel: (kind: DesktopPanelKind) => void;
  disabledPanels?: DesktopPanelKind[];
  panelToggle: PanelToggleProps;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
  /** Open file tabs — top-level tabs in the dock's tab bar (VS Code style).
   * While any files are open the "文件" kind tab yields its place to them. */
  fileTabs?: FileViewState[];
  activeFilePath?: string | null;
  onSelectFileTab?: (path: string) => void;
  onCloseFileTab?: (path: string) => void;
  onPinFileTab?: (path: string) => void;
  /** 详情 is the first tab and is not a DesktopPanelKind. */
  detailActive?: boolean;
  onSelectDetail?: () => void;
  /** Selected issue or queue title. The tab shows this, truncated; the tooltip keeps the full text. */
  detailTitle?: string;
  /** 当前事项正在跑或等确认时，详情图标换成对应状态。 */
  detailPresence?: IssuePresence | null;
  detail?: React.ReactNode;
  /** Page title for the 浏览器 kind tab. Tools carry their own label. */
  previewLabel?: string;
  /** Extra terminal and browser tabs. These stay available even when that kind is already open. */
  toolTabs?: DockToolTab[];
  activeToolId?: string | null;
  onSelectTool?: (id: string) => void;
  onCloseTool?: (id: string) => void;
  /** Saved visual order. Empty keeps the default kind order. */
  tabOrder?: readonly string[];
  onTabOrderChange?: (order: string[]) => void;
  children: React.ReactNode;
}

let draggingDockTabKey: string | null = null;

export const DesktopPanelDock: React.FC<DesktopPanelDockProps> = ({
  checked,
  active,
  onSelect,
  onCloseTab,
  onAddPanel,
  disabledPanels = [],
  panelToggle,
  fullscreen,
  onToggleFullscreen,
  width,
  onWidthChange,
  maxWidth,
  fileTabs = [],
  activeFilePath = null,
  onSelectFileTab,
  onCloseFileTab,
  onPinFileTab,
  detailActive = false,
  onSelectDetail,
  detailTitle,
  detailPresence,
  detail,
  previewLabel,
  toolTabs = [],
  activeToolId = null,
  onSelectTool,
  onCloseTool,
  tabOrder,
  onTabOrderChange,
  children,
}) => {
  const dockRef = React.useRef<HTMLElement | null>(null);
  const tabsRef = React.useRef<HTMLDivElement | null>(null);
  const tabOverflow = useScrollOverflow(tabsRef);
  const [entering, setEntering] = React.useState(true);
  React.useEffect(() => {
    const id = window.setTimeout(() => setEntering(false), PANEL_MOTION_MS + 50);
    return () => window.clearTimeout(id);
  }, []);
  const suppressDrag = React.useRef(false);
  const [dropHint, setDropHint] = React.useState<{ key: string; after: boolean } | null>(
    null,
  );
  // The tab bar starts scrolled to the left, so the initially active tab is
  // always visible; scrolling only makes sense on later activation changes.
  const mountedRef = React.useRef(false);
  const revealTab = React.useCallback((target: EventTarget | null) => {
    const container = tabsRef.current;
    const tab =
      target instanceof HTMLElement
        ? target.closest<HTMLElement>(".desktop-panel-tab, .file-tab")
        : null;
    if (!container || !tab) return;
    scrollDockTabIntoView(container, tab);
  }, []);

  const selectTab = React.useCallback(
    (key: string) => {
      if (key === DOCK_TAB_DETAIL_KEY) {
        onSelectDetail?.();
        return;
      }
      const toolId = toolIdFromTabKey(key);
      if (toolId) {
        onSelectTool?.(toolId);
        return;
      }
      const path = filePathFromTabKey(key);
      if (path) {
        onSelectFileTab?.(path);
        return;
      }
      if (key.startsWith("kind:")) {
        onSelect(key.slice("kind:".length) as DesktopPanelKind);
      }
    },
    [onSelect, onSelectDetail, onSelectFileTab, onSelectTool],
  );

  React.useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    return registerSidePanel(
      dock,
      (direction) => {
        const keys = reconcileTabOrder(
          tabOrder,
          defaultDockTabKeys({
            detail: Boolean(onSelectDetail),
            checked,
            filePaths: fileTabs.map((tab) => tab.path),
            tools: toolTabs,
          }),
        );
        const current = activeDockTabKey({
          orderedKeys: keys,
          detailActive,
          activeKind: active,
          activeFilePath,
          activeToolId,
        });
        const next = stepTab(keys, current, direction);
        if (next) selectTab(next);
      },
      () => {
        const keys = reconcileTabOrder(
          tabOrder,
          defaultDockTabKeys({
            detail: Boolean(onSelectDetail),
            checked,
            filePaths: fileTabs.map((tab) => tab.path),
            tools: toolTabs,
          }),
        );
        const current = activeDockTabKey({
          orderedKeys: keys,
          detailActive,
          activeKind: active,
          activeFilePath,
          activeToolId,
        });
        if (!current || current === DOCK_TAB_DETAIL_KEY) return false;
        const toolId = toolIdFromTabKey(current);
        if (toolId) {
          if (!onCloseTool) return false;
          onCloseTool(toolId);
          return true;
        }
        const path = filePathFromTabKey(current);
        if (path) {
          if (!onCloseFileTab) return false;
          onCloseFileTab(path);
          return true;
        }
        if (current.startsWith("kind:")) {
          onCloseTab(current.slice("kind:".length) as DesktopPanelKind);
          return true;
        }
        return false;
      },
    );
  }, [
    active,
    activeFilePath,
    activeToolId,
    checked,
    detailActive,
    fileTabs,
    onCloseFileTab,
    onCloseTab,
    onCloseTool,
    onSelectDetail,
    selectTab,
    tabOrder,
    toolTabs,
  ]);

  React.useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const container = tabsRef.current;
    const tab = container?.querySelector<HTMLElement>(
      ".desktop-panel-tab--active, .file-tab--active",
    );
    if (!container || !tab) return;
    scrollDockTabIntoView(container, tab);
  }, [active, activeFilePath, activeToolId, checked, detailActive, fileTabs, tabOrder, toolTabs]);

  const onDragStart = (e: React.MouseEvent) => {
    if (fullscreen) return;
    e.preventDefault();
    dockRef.current?.classList.remove("desktop-panel-dock--enter");
    setEntering(false);
    const handle = e.currentTarget as HTMLElement;
    handle.style.background = "var(--accent-9)";
    document.body.classList.add("is-panel-resizing");
    const rect = dockRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = (rect?.right ?? 0) - ev.clientX;
      onWidthChange(clampDockWidth(next, maxWidth));
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

  // Open files live in the dock's top tab bar regardless of which panel is
  // active. Their place in the bar follows the saved order, not the kind list.
  const presentKeys = defaultDockTabKeys({
    detail: Boolean(onSelectDetail),
    checked,
    filePaths: fileTabs.map((tab) => tab.path),
    tools: toolTabs,
  });
  const orderedKeys = reconcileTabOrder(tabOrder, presentKeys);
  const dropAfter = (event: React.DragEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientX > rect.left + rect.width / 2;
  };
  const finishDrag = () => {
    draggingDockTabKey = null;
    suppressDrag.current = false;
    setDropHint(null);
  };
  const beginDrag = (event: React.DragEvent, key: string) => {
    if (suppressDrag.current) {
      event.preventDefault();
      return;
    }
    draggingDockTabKey = key;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", key);
    }
  };
  const bindTab = (key: string) => ({
    draggable: true,
    onMouseDown: (event: React.MouseEvent) => {
      const el = event.target as HTMLElement;
      suppressDrag.current = Boolean(
        el.closest(".desktop-panel-tab-close, .file-tab-close"),
      );
    },
    onDragStart: (event: React.DragEvent) => beginDrag(event, key),
    onDragOver: (event: React.DragEvent) => {
      if (!draggingDockTabKey) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const after = dropAfter(event);
      setDropHint((prev) =>
        prev?.key === key && prev.after === after ? prev : { key, after },
      );
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      const from = draggingDockTabKey;
      const after = dropAfter(event);
      finishDrag();
      if (!from || from === key || !onTabOrderChange) return;
      onTabOrderChange(moveDockTab(orderedKeys, from, key, after));
    },
    onDragEnd: finishDrag,
  });
  const dragSource = (key: string) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.stopPropagation();
      beginDrag(event, key);
    },
    onDragEnd: finishDrag,
  });
  const dropClass = (key: string) => {
    if (dropHint?.key !== key) return "";
    return dropHint.after ? " dock-tab-drop-after" : " dock-tab-drop-before";
  };
  // 详情 is not a kind, so a detail-only dock still needs + to open
  // 文件、终端、浏览器、变更.
  const canAdd = PANEL_ADD_ORDER.some(
    (kind) => !checked.includes(kind) && !disabledPanels.includes(kind),
  );
  const detailLabel = detailTitle?.trim() || "详情";
  // Never paint wider than the live max — persisted widths from a larger
  // window would otherwise overflow past the pane edge.
  const clampedWidth = clampDockWidth(
    width,
    Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : width,
  );

  const addButton = (
    <button
      type="button"
      className="desktop-panel-add-btn"
      data-testid="desktop-panel-add-btn"
      aria-label="添加面板"
    >
      <i className="codicon codicon-add" />
    </button>
  );

  return (
    <aside
      ref={dockRef}
      className={`desktop-panel-dock${fullscreen ? " desktop-panel-dock--fullscreen" : ""}${entering ? " desktop-panel-dock--enter" : ""}`}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (
          event.animationName !== "desktop-panel-dock-in" &&
          event.animationName !== "desktop-panel-dock-full-in"
        ) {
          return;
        }
        setEntering(false);
      }}
      style={
        {
          "--dock-width": `${clampedWidth}px`,
        } as React.CSSProperties
      }
      data-testid="desktop-panel-dock"
    >
      {!fullscreen && (
        <div
          className="preview-pane-drag-handle"
          onMouseDown={onDragStart}
          data-testid="desktop-panel-dock-resize"
        />
      )}
      <div className="desktop-panel-dock-header">
        <div
          className={`desktop-panel-dock-tabs${tabOverflow.start ? " is-overflow-start" : ""}${tabOverflow.end ? " is-overflow-end" : ""}`}
          ref={tabsRef}
        >
          {orderedKeys.map((key) => {
            if (key === DOCK_TAB_DETAIL_KEY) {
              if (!onSelectDetail) return null;
              return (
                <div
                  key={key}
                  className={`desktop-panel-tab${detailActive ? " desktop-panel-tab--active" : ""}${dropClass(key)}`}
                  data-testid={`desktop-panel-tab-${DOCK_DETAIL_TAB}`}
                  {...bindTab(key)}
                >
                  <Tooltip
                    text={detailLabel}
                    position="bottom"
                    wrap={false}
                    className="desktop-panel-tab-tip"
                    disabled={!detailTitle?.trim()}
                  >
                    <button
                      type="button"
                      className="desktop-panel-tab-label"
                      onClick={(event) => {
                        onSelectDetail();
                        revealTab(event.currentTarget);
                      }}
                      {...dragSource(key)}
                    >
                      {detailPresence === "running" || detailPresence === "waiting" ? (
                        <span className="desktop-panel-tab-icon" data-testid="desktop-panel-tab-detail-status">
                          <IssuePresenceMark presence={detailPresence} />
                        </span>
                      ) : (
                        <i
                          className="codicon codicon-note desktop-panel-tab-icon"
                          aria-hidden
                        />
                      )}
                      <span className="desktop-panel-tab-text">{detailLabel}</span>
                    </button>
                  </Tooltip>
                </div>
              );
            }
            const toolId = toolIdFromTabKey(key);
            if (toolId) {
              const tool = toolTabs.find((item) => item.id === toolId);
              if (!tool) return null;
              const selected =
                !detailActive && tool.id === activeToolId && tool.kind === active;
              return (
                <div
                  key={key}
                  className={`desktop-panel-tab${selected ? " desktop-panel-tab--active" : ""}${dropClass(key)}`}
                  data-testid={`desktop-panel-tool-${tool.id}`}
                  title={tool.title}
                  {...bindTab(key)}
                >
                  <Tooltip
                    text={tool.title}
                    position="bottom"
                    wrap={false}
                    className="desktop-panel-tab-tip"
                  >
                    <button
                      type="button"
                      className="desktop-panel-tab-label"
                      onClick={(event) => {
                        onSelectTool?.(tool.id);
                        revealTab(event.currentTarget);
                      }}
                      {...dragSource(key)}
                    >
                      <i
                        className={`codicon ${PANEL_TAB_ICONS[tool.kind]} desktop-panel-tab-icon`}
                        aria-hidden
                      />
                      <span className="desktop-panel-tab-text">{tool.label}</span>
                    </button>
                  </Tooltip>
                  <button
                    type="button"
                    className="desktop-panel-tab-close"
                    data-testid={`desktop-panel-tool-close-${tool.id}`}
                    aria-label={`关闭${PANEL_TAB_LABELS[tool.kind]}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTool?.(tool.id);
                    }}
                  >
                    <i className="codicon codicon-close" />
                  </button>
                </div>
              );
            }
            const path = filePathFromTabKey(key);
            if (path) {
              const tab = fileTabs.find((item) => item.path === path);
              if (!tab) return null;
              const isActive =
                !detailActive && active === "file" && tab.path === activeFilePath;
              const name = tab.path.replace(/\\/g, "/").split("/").pop() || tab.path;
              return (
                <div
                  key={key}
                  className={`file-tab${isActive ? " file-tab--active" : ""}${tab.pinned ? "" : " file-tab--preview"}${dropClass(key)}`}
                  data-testid="file-tab"
                  data-path={tab.path}
                  data-active={isActive ? "true" : "false"}
                  title={tab.path}
                  onClick={(event) => {
                    onSelectFileTab?.(tab.path);
                    revealTab(event.currentTarget);
                  }}
                  onDoubleClick={() => onPinFileTab?.(tab.path)}
                  {...bindTab(key)}
                >
                  <FileIcon name={name} className="file-tab-icon" />
                  <span className="file-tab-label">{name}</span>
                  <button
                    type="button"
                    className="file-tab-close"
                    data-testid="file-tab-close"
                    title="关闭"
                    aria-label="关闭"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseFileTab?.(tab.path);
                    }}
                  >
                    <i className="codicon codicon-close" aria-hidden />
                  </button>
                </div>
              );
            }
            if (!key.startsWith("kind:")) return null;
            const kind = key.slice("kind:".length) as DesktopPanelKind;
            const selected = !detailActive && kind === active;
            const label =
              kind === "preview" && previewLabel ? previewLabel : PANEL_TAB_LABELS[kind];
            return (
              <div
                key={key}
                className={`desktop-panel-tab${selected ? " desktop-panel-tab--active" : ""}${dropClass(key)}`}
                data-testid={`desktop-panel-tab-${kind}`}
                {...bindTab(key)}
              >
                <button
                  type="button"
                  className="desktop-panel-tab-label"
                  onClick={(event) => {
                    onSelect(kind);
                    revealTab(event.currentTarget);
                  }}
                  {...dragSource(key)}
                >
                  <i
                    className={`codicon ${PANEL_TAB_ICONS[kind]} desktop-panel-tab-icon`}
                    aria-hidden
                  />
                  <span className="desktop-panel-tab-text">{label}</span>
                </button>
                <button
                  type="button"
                  className="desktop-panel-tab-close"
                  data-testid={`desktop-panel-tab-close-${kind}`}
                  aria-label={`关闭${PANEL_TAB_LABELS[kind]}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(kind);
                  }}
                >
                  <i className="codicon codicon-close" />
                </button>
              </div>
            );
          })}
          {canAdd && (
            <div className="desktop-panel-add">
              <PanelAddMenu
                checked={checked}
                disabled={disabledPanels}
                onAdd={onAddPanel}
                trigger={addButton}
              />
            </div>
          )}
        </div>
        <div className="desktop-panel-dock-actions">
          <Tooltip
            text={`${fullscreen ? "退出全屏" : "全屏"} (${dockFullscreenShortcutLabel()})`}
            position="bottom"
          >
            <button
              type="button"
              className="header-button"
              data-testid="desktop-panel-fullscreen-btn"
              aria-label={fullscreen ? "退出全屏" : "全屏"}
              onClick={onToggleFullscreen}
            >
              <i
                className={`codicon ${fullscreen ? "codicon-screen-normal" : "codicon-screen-full"}`}
              />
            </button>
          </Tooltip>
          <PanelToggleControl {...panelToggle} />
        </div>
      </div>
      <div className="desktop-panel-dock-body">
        <div className="desktop-panel-dock-layer" hidden={!detailActive}>
          {detail}
        </div>
        <div className="desktop-panel-dock-layer" hidden={detailActive}>
          {children}
        </div>
      </div>
    </aside>
  );
};
