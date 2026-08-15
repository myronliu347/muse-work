import React, { useState } from "react";
import {
  getIconForFile,
  getIconForFolder,
  getIconForOpenFolder,
} from "vscode-icons-js";

const ICON_CDN =
  "https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons@12.12.0/icons";

export type FileIconProps = {
  name: string;
  isDirectory?: boolean;
  isOpen?: boolean;
  className?: string;
};

export const FileIcon: React.FC<FileIconProps> = ({
  name,
  isDirectory,
  isOpen,
  className,
}) => {
  const svg = isDirectory
    ? isOpen
      ? getIconForOpenFolder(name)
      : getIconForFolder(name)
    : getIconForFile(name);
  const [failed, setFailed] = useState(false);

  if (failed || !svg) {
    return (
      <i
        className={`codicon ${isDirectory ? "codicon-folder" : "codicon-file"}${className ? ` ${className}` : ""}`}
        aria-hidden
      />
    );
  }

  return (
    <img
      className={className ?? "file-icon"}
      src={`${ICON_CDN}/${svg}`}
      alt=""
      width={16}
      height={16}
      onError={() => setFailed(true)}
    />
  );
};

export default FileIcon;
