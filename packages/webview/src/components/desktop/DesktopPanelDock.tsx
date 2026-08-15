import React, { useState } from "react";
import type { DesktopPanelKind, PanelToggleProps } from "../../types";
import { PANEL_ADD_ORDER, PANEL_TAB_ICONS, PANEL_TAB_LABELS, PANEL_TAB_ORDER } from "../../muse/panelTabs";
import { dockFullscreenShortcutLabel } from "../../muse/panelShortcuts";
import { PanelToggleControl } from "../panels/PanelToggleControl";
import { PanelAddMenu } from "../panels/PanelAddMenu";
import { Tooltip } from "../shared/Tooltip";
import "../../styles/DesktopPanelDock.css";

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
  children,
}) => {
  const dockRef = React.useRef<HTMLElement | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const onDragStart = (e: React.MouseEvent) => {
    if (fullscreen) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.style.background = "var(--accent-9)";
    document.body.classList.add("is-panel-resizing");
    const rect = dockRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, 320), maxWidth));
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

  const tabs = PANEL_TAB_ORDER.filter((kind) => checked.includes(kind));
  const canAdd = PANEL_ADD_ORDER.some(
    (kind) => !checked.includes(kind) && !disabledPanels.includes(kind),
  );
  // Never paint wider than the live max — persisted widths from a larger
  // window would otherwise overflow past the pane edge.
  const clampedWidth = Math.max(
    320,
    Math.min(width, Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : width),
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
        <div className="desktop-panel-dock-tabs">
          {tabs.map((kind) => (
            <div
              key={kind}
              className={`desktop-panel-tab${kind === active ? " desktop-panel-tab--active" : ""}`}
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
          ))}
        </div>
        {canAdd && (
          <div className="desktop-panel-add">
            <button
              type="button"
              className="desktop-panel-add-btn"
              data-testid="desktop-panel-add-btn"
              aria-label="添加面板"
              onClick={(e) => {
                e.stopPropagation();
                setShowAddMenu((v) => !v);
              }}
            >
              <i className="codicon codicon-add" />
            </button>
            {showAddMenu && (
              <PanelAddMenu
                checked={checked}
                disabled={disabledPanels}
                onAdd={onAddPanel}
                onClose={() => setShowAddMenu(false)}
              />
            )}
          </div>
        )}
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
      <div className="desktop-panel-dock-body">{children}</div>
    </aside>
  );
};
