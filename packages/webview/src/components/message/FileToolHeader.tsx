import React from "react";
import type { ToolBlock } from "../../types";
import { ToolError } from "./ToolError";

interface FileToolHeaderProps {
  toolBlock: ToolBlock;
  filePath: string;
  onOpenFile: () => void;
}

export const FileToolHeader: React.FC<FileToolHeaderProps> = ({
  toolBlock,
  filePath,
  onOpenFile,
}) => {
  const toolStatusColor =
    toolBlock.stage === "running" || toolBlock.stage === "streaming"
      ? "var(--amber-11)"
      : toolBlock.success === true
        ? "var(--green-11)"
        : toolBlock.error || toolBlock.success === false
          ? "var(--red-11)"
          : "var(--gray-11)";

  const header = (
    <div className="write-tool-header">
      <span className="tool-status-dot" style={{ color: toolStatusColor }}>
        ●
      </span>
      <span
        className={
          toolBlock.stage === "running" || toolBlock.stage === "streaming"
            ? "write-tool-label text-shimmer"
            : "write-tool-label"
        }
        data-testid="tool-name"
      >
        {toolBlock.name || "Tool"}
      </span>
      {filePath && (
        <span className="write-tool-path" onClick={onOpenFile}>
          {filePath}
        </span>
      )}
    </div>
  );

  const errorText = toolBlock.error ? String(toolBlock.error) : "";
  return errorText ? <ToolError message={errorText}>{header}</ToolError> : header;
};
