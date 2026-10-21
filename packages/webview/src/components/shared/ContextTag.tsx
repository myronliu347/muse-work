import React from "react";
import { Tooltip } from "./Tooltip";
import "./ContextTag.css";

interface ContextTagProps {
  name: string;
  path: string;
  isImage?: boolean;
  onClick?: () => void;
  /** Hover text. Defaults to the path, or "点击查看 {name}" when clickable. */
  tooltip?: string;
}

export const ContextTag: React.FC<ContextTagProps> = ({
  name,
  path,
  isImage,
  onClick,
  tooltip,
}) => {
  const isClickable = onClick !== undefined;
  const tip = tooltip ?? (isClickable ? `点击查看 ${name}` : path);

  const handlePreview = (e: React.MouseEvent) => {
    if (isClickable) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }
  };

  return (
    <Tooltip text={tip} position="top">
      <span
        className={`context-tag ${isClickable ? "clickable" : ""} ${isImage ? "is-image" : ""}`}
        onClick={handlePreview}
        aria-label={tip}
        data-path={path}
      >
        <span className="tag-at">@</span>
        <span className="tag-name">{name}</span>
      </span>
    </Tooltip>
  );
};
