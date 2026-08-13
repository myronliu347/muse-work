import React, { useState } from "react";
import { Tooltip } from "./Tooltip";
import { PanelToggleMenu } from "./PanelToggleMenu";
import type { PanelToggleProps } from "../types";

export const PanelToggleControl: React.FC<PanelToggleProps> = ({
  checked,
  onToggle,
  disabled,
}) => {
  const [showPanelMenu, setShowPanelMenu] = useState(false);

  return (
    <div className="panel-toggle-control">
      <Tooltip text="面板" position="bottom">
        <button
          className="header-button header-panel-toggle"
          onClick={() => setShowPanelMenu((prev) => !prev)}
          data-testid="panel-toggle-btn"
          aria-label="面板"
        >
          <i className="codicon codicon-layout-sidebar-right" />
          <i className="codicon codicon-chevron-down header-panel-toggle-caret" />
        </button>
      </Tooltip>
      {showPanelMenu && (
        <PanelToggleMenu
          checked={checked}
          onToggle={onToggle}
          disabled={disabled}
          onClose={() => setShowPanelMenu(false)}
        />
      )}
    </div>
  );
};
