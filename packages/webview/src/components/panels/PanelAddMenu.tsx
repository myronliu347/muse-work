import React, { useEffect, useRef } from "react";
import type { DesktopPanelKind } from "../../types";
import { panelShortcutLabel } from "../../muse/panelShortcuts";
import { PANEL_ADD_ORDER, PANEL_TAB_LABELS } from "../../muse/panelTabs";
import "../../styles/PanelToggleMenu.css";

export type PanelAddMenuProps = {
  checked: DesktopPanelKind[];
  disabled?: DesktopPanelKind[];
  onAdd: (kind: DesktopPanelKind) => void;
  onClose: () => void;
};

export const PanelAddMenu: React.FC<PanelAddMenuProps> = ({
  checked,
  disabled = [],
  onAdd,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const items = PANEL_ADD_ORDER.filter(
    (kind) => !checked.includes(kind) && !disabled.includes(kind),
  );

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="panel-toggle-menu panel-add-menu"
      data-testid="panel-add-menu"
    >
      {items.map((kind) => (
        <div
          key={kind}
          className="panel-toggle-menu-item"
          role="menuitem"
          data-testid={`panel-add-item-${kind}`}
          onClick={() => {
            onAdd(kind);
            onClose();
          }}
        >
          <span className="panel-toggle-menu-label">
            {PANEL_TAB_LABELS[kind]}
          </span>
          <span className="panel-toggle-menu-shortcut">
            {panelShortcutLabel(kind)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default PanelAddMenu;
