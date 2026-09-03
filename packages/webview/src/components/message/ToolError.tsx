import React, { type ReactElement } from "react";
import { Tooltip } from "../shared/Tooltip";

export const ToolError: React.FC<{
  message: string;
  children: ReactElement;
}> = ({ message, children }) => (
  <Tooltip
    text={message}
    position="bottom"
    className="tool-error"
    content={
      <span className="tool-error-tooltip-text" data-testid="tool-error-detail">
        {message}
      </span>
    }
  >
    {children}
  </Tooltip>
);
