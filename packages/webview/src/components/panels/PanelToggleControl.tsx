import React from "react";
import { Tooltip } from "../shared/Tooltip";
import type { PanelToggleProps } from "../../types";

export const PanelToggleControl: React.FC<PanelToggleProps> = ({
  onToggleDock,
}) => (
  <div className="panel-toggle-control">
    <Tooltip text="面板" position="bottom">
      <button
        className="header-button header-panel-toggle"
        onClick={onToggleDock}
        data-testid="panel-toggle-btn"
        aria-label="面板"
      >
        <i className="codicon codicon-layout-sidebar-right" />
      </button>
    </Tooltip>
  </div>
);
