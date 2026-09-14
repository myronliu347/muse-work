import React from "react";
import { CloseIcon } from "../shared/HeaderIcons";

export const ConfigurationDialogClose: React.FC<{
  onClick: () => void;
  disabled?: boolean;
}> = ({ onClick, disabled }) => (
  <button
    type="button"
    className="configuration-close-btn"
    aria-label="关闭"
    onClick={onClick}
    disabled={disabled}
  >
    <CloseIcon className="configuration-close-icon" />
  </button>
);
