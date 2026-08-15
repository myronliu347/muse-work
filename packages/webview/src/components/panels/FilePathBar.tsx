import React from "react";
import { FileIcon } from "./FileIcon";
import {
  displayFilePath,
  middleEllipsis,
} from "../../utils/filePathDisplay";

export type FilePathBarProps = {
  path: string;
  workdir?: string;
};

export const FilePathBar: React.FC<FilePathBarProps> = ({ path, workdir }) => {
  const display = displayFilePath(path, workdir);
  const name = path.split(/[/\\]/).pop() || path;
  return (
    <div className="file-path-bar" data-testid="file-path-bar">
      <FileIcon name={name} className="file-icon" />
      <span className="file-path-bar-text" title={path}>
        {middleEllipsis(display)}
      </span>
    </div>
  );
};

export default FilePathBar;
