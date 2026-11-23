import React from "react";
import { FileIcon } from "../panels/FileIcon";
import { fileBaseName, fileLinkKind } from "../../utils/fileLinkKind";
import "../../styles/FileChip.css";

/**
 * One local file, one chip. Message attachments and issue artifacts share it
 * so a picture looks and opens the same way wherever it is listed.
 */
export function FileChip({
  path,
  closed = false,
  onOpen,
}: {
  path: string;
  /** The file is gone: show it greyed out and inert. */
  closed?: boolean;
  onOpen: (path: string) => void;
}): React.ReactElement {
  const name = fileBaseName(path);
  const kind = fileLinkKind(path);
  const icon = <FileIcon name={name} className="file-chip-icon" />;
  if (closed) {
    return (
      <span className="file-chip file-chip-closed" title={path}>
        {icon}
        <span className="file-chip-name">{name}</span>
      </span>
    );
  }
  const label =
    kind === "image"
      ? `预览 ${name}`
      : kind === "browser"
        ? `在内置浏览器中打开 ${name}`
        : `打开 ${name}`;
  return (
    <button
      type="button"
      className="file-chip"
      data-testid="file-chip"
      data-path={path}
      title={path}
      aria-label={label}
      onClick={() => onOpen(path)}
    >
      {icon}
      <span className="file-chip-name">{name}</span>
    </button>
  );
}
