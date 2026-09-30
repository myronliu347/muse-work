import React from "react";
import { LayoutSidebarRightIcon } from "../shared/HeaderIcons";
import { Tooltip } from "../shared/Tooltip";
import { dockToggleShortcutLabel } from "../../muse/panelShortcuts";
import type { PanelToggleProps } from "../../types";

export const PanelToggleControl: React.FC<PanelToggleProps> = ({
  onToggleDock,
}) => {
  const shortcut = dockToggleShortcutLabel();
  return (
    <div className="panel-toggle-control">
      <Tooltip text={`面板 ${shortcut}`} position="bottom" wrap={false}>
        <button
          className="header-button"
          onClick={onToggleDock}
          data-testid="panel-toggle-btn"
          aria-label={`面板 ${shortcut}`}
        >
          <LayoutSidebarRightIcon />
        </button>
      </Tooltip>
    </div>
  );
};
