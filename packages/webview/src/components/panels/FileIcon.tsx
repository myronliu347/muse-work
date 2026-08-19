import React, { useState } from "react";
import {
  getIconForFile,
  getIconForFolder,
  getIconForOpenFolder,
} from "vscode-icons-js";

// CDN 版本必须与 vscode-icons-js 的数据来源匹配：11.6.1 的映射基于 2021-09
// 的 vscode-icons 仓库，12.x 已删除 file_type_webp.svg 等图标（→404）。11.10.0
// 与映射表 936 个图标全量匹配（已实测）。
const ICON_CDN =
  "https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons@11.10.0/icons";

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
