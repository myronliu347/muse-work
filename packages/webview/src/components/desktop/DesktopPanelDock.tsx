import React from "react";
import type { DesktopPanelKind, FileViewState, PanelToggleProps } from "../../types";
import {
  DOCK_DETAIL_TAB,
  PANEL_ADD_ORDER,
  PANEL_TAB_ICONS,
  PANEL_TAB_LABELS,
} from "../../muse/panelTabs";
import { dockFullscreenShortcutLabel } from "../../muse/panelShortcuts";
import { PanelToggleControl } from "../panels/PanelToggleControl";
import { PanelAddMenu } from "../panels/PanelAddMenu";
import { FileIcon } from "../panels/FileIcon";
import { Tooltip } from "../shared/Tooltip";
import "../../styles/DesktopPanelDock.css";
import { clampDockWidth } from "../../muse/layout";

export interface DockToolTab {
  id: string;
  kind: "terminal" | "preview";
  label: string;
  title: string;
}

/** Bring the active file tab into view whenever it changes (opening a tab,
 * clicking one, or activating the left/right neighbor after a close). The
 * tab bar scrolls horizontally (overflow-x: auto), so a tab outside the
 * visible area is otherwise unreachable. Nearest alignment — no centering,
 * so the current reading position is preserved. */
function scrollActiveTabIntoView(
  container: HTMLElement,
  activeFilePath: string,
) {
  const activeEl = container.querySelector<HTMLElement>(
    '[data-testid="file-tab"][data-active="true"]',
  );
  if (!activeEl) return;
  const { scrollLeft, clientWidth } = container;
  const left = activeEl.offsetLeft;
  const right = left + activeEl.offsetWidth;
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
  detail?: React.ReactNode;
  /** Extra terminal and browser tabs. These stay available even when that kind is already open. */
  toolTabs?: DockToolTab[];
  activeToolId?: string | null;
  onSelectTool?: (id: string) => void;
  onCloseTool?: (id: string) => void;
  children: React.ReactNode;
}

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
  detail,
  toolTabs = [],
  activeToolId = null,
  onSelectTool,
  onCloseTool,
  children,
}) => {
  const dockRef = React.useRef<HTMLElement | null>(null);
  const tabsRef = React.useRef<HTMLDivElement | null>(null);
  // The tab bar starts scrolled to the left, so the initially active tab is
  // always visible; scrolling only makes sense on later activation changes.
  const mountedRef = React.useRef(false);

  React.useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!tabsRef.current || !activeFilePath) return;
    scrollActiveTabIntoView(tabsRef.current, activeFilePath);
  }, [activeFilePath, fileTabs]);

  const onDragStart = (e: React.MouseEvent) => {
    if (fullscreen) return;
    e.preventDefault();
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
  // active (switching to the diff/preview panel keeps the file tabs visible).
  // While files are open the "文件" kind tab yields its place to them.
  const showFileTabs = fileTabs.length > 0;
  type HeaderItem =
    | { type: "kind"; kind: DesktopPanelKind }
    | { type: "tool"; tool: DockToolTab };
  const headerItems: HeaderItem[] = [];
  for (const kind of PANEL_ADD_ORDER) {
    const mine = toolTabs.filter((tool) => tool.kind === kind);
    if (mine.length > 0) {
      for (const tool of mine) headerItems.push({ type: "tool", tool });
      continue;
    }
    if (checked.includes(kind) || (showFileTabs && kind === "file")) {
      headerItems.push({ type: "kind", kind });
    }
  }
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
      className={`desktop-panel-dock${fullscreen ? " desktop-panel-dock--fullscreen" : ""}`}
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
        <div className="desktop-panel-dock-tabs" ref={tabsRef}>
          {onSelectDetail ? (
            <div
              className={`desktop-panel-tab${detailActive ? " desktop-panel-tab--active" : ""}`}
              data-testid={`desktop-panel-tab-${DOCK_DETAIL_TAB}`}
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
                  onClick={() => onSelectDetail()}
                >
                  <i
                    className="codicon codicon-note desktop-panel-tab-icon"
                    aria-hidden
                  />
                  <span className="desktop-panel-tab-text">{detailLabel}</span>
                </button>
              </Tooltip>
            </div>
          ) : null}
          {headerItems.map((item) => {
            if (item.type === "tool") {
              const tool = item.tool;
              const selected =
                !detailActive && tool.id === activeToolId && tool.kind === active;
              return (
                <div
                  key={tool.id}
                  className={`desktop-panel-tab${selected ? " desktop-panel-tab--active" : ""}`}
                  data-testid={`desktop-panel-tool-${tool.id}`}
                  title={tool.title}
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
                      onClick={() => onSelectTool?.(tool.id)}
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
            const kind = item.kind;
            if (kind === "file" && showFileTabs) {
              return fileTabs.map((tab) => {
                const isActive =
                  !detailActive &&
                  active === "file" &&
                  tab.path === activeFilePath;
                const name =
                  tab.path.replace(/\\/g, "/").split("/").pop() || tab.path;
                return (
                  <div
                    key={tab.path}
                    className={`file-tab${isActive ? " file-tab--active" : ""}${tab.pinned ? "" : " file-tab--preview"}`}
                    data-testid="file-tab"
                    data-path={tab.path}
                    data-active={isActive ? "true" : "false"}
                    title={tab.path}
                    onClick={() => onSelectFileTab?.(tab.path)}
                    onDoubleClick={() => onPinFileTab?.(tab.path)}
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
              });
            }
            const selected = !detailActive && kind === active;
            return (
              <div
                key={kind}
                className={`desktop-panel-tab${selected ? " desktop-panel-tab--active" : ""}`}
                data-testid={`desktop-panel-tab-${kind}`}
              >
                <button
                  type="button"
                  className="desktop-panel-tab-label"
                  onClick={() => onSelect(kind)}
                >
                  <i
                    className={`codicon ${PANEL_TAB_ICONS[kind]} desktop-panel-tab-icon`}
                    aria-hidden
                  />
                  {PANEL_TAB_LABELS[kind]}
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
