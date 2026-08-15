import React, { useRef } from "react";
import type { DesktopPanelKind, PanelToggleProps } from "../types";
import { PANEL_TAB_ICONS, PANEL_TAB_LABELS, PANEL_TAB_ORDER } from "../muse/panelTabs";
import { PanelToggleControl } from "./PanelToggleControl";
import "../styles/DesktopPanelDock.css";

export interface DesktopPanelDockProps {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind;
  onSelect: (kind: DesktopPanelKind) => void;
  onCloseTab: (kind: DesktopPanelKind) => void;
  panelToggle: PanelToggleProps;
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
  panelToggle,
  width,
  onWidthChange,
  maxWidth,
  children,
}) => {
  const dockRef = useRef<HTMLElement | null>(null);

  const onDragStart = (e: React.MouseEvent) => {
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

  return (
    <aside
      ref={dockRef}
      className="desktop-panel-dock"
      style={{ width }}
      data-testid="desktop-panel-dock"
    >
      <div
        className="preview-pane-drag-handle"
        onMouseDown={onDragStart}
        data-testid="desktop-panel-dock-resize"
      />
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
        <PanelToggleControl {...panelToggle} />
      </div>
      <div className="desktop-panel-dock-body">{children}</div>
    </aside>
  );
};
