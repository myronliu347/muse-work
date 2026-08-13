import React, { useEffect, useRef } from "react";
import { FileSuggestionDropdownProps, FileItem } from "../types";
import { breadcrumbCrumbs } from "../utils/fileMentionBrowse";
import "../styles/FileSuggestionDropdown.css";

export const FileSuggestionDropdown: React.FC<FileSuggestionDropdownProps> = ({
  suggestions,
  isVisible,
  selectedIndex,
  onSelect,
  onClose,
  position,
  filterText,
  isLoading = false,
  browsePath = "",
  onEnterDirectory,
  onBrowseTo,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isBrowse = filterText === "";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isVisible, onClose]);

  useEffect(() => {
    if (!dropdownRef.current || selectedIndex < 0) return;
    const items = dropdownRef.current.querySelectorAll(
      ".suggestion-item:not(.suggestion-empty)",
    );
    const selectedElement = items[selectedIndex] as HTMLElement | undefined;
    selectedElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  if (!isVisible) {
    return null;
  }

  const highlightMatch = (text: string, filter: string): React.ReactNode => {
    if (!filter) return text;
    const lowerText = text.toLowerCase();
    const lowerFilter = filter.toLowerCase();
    const index = lowerText.indexOf(lowerFilter);
    if (index === -1) return text;
    return (
      <>
        {text.slice(0, index)}
        <span className="suggestion-highlight">
          {text.slice(index, index + filter.length)}
        </span>
        {text.slice(index + filter.length)}
      </>
    );
  };

  return (
    <div
      ref={dropdownRef}
      className={`file-suggestion-dropdown${isBrowse ? " is-browse" : " is-search"}`}
      style={{
        position: "absolute",
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {isBrowse && (
        <div className="suggestion-breadcrumb" data-testid="suggestion-breadcrumb">
          {breadcrumbCrumbs(browsePath).map((crumb, i) => (
            <span key={`${crumb.path}-${i}`} className="suggestion-crumb">
              {i > 0 && (
                <span className="suggestion-crumb-sep codicon codicon-chevron-right" />
              )}
              <button
                type="button"
                className="suggestion-crumb-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onBrowseTo?.(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
      )}

      {suggestions.map((file: FileItem, index: number) => (
        <div
          key={file.path}
          className={`suggestion-item${isBrowse ? "" : " search-row"}${
            index === selectedIndex ? " selected" : ""
          }`}
          onClick={() => onSelect(file)}
        >
          <span className={`suggestion-icon codicon ${file.icon}`}></span>
          <div className="suggestion-content">
            <div className="suggestion-name">
              {highlightMatch(file.name, filterText)}
            </div>
            {!isBrowse && (
              <div className="suggestion-path">{file.relativePath}</div>
            )}
          </div>
          {isBrowse && file.isDirectory && (
            <button
              type="button"
              className="suggestion-enter"
              data-testid={`suggestion-enter-${file.name}`}
              aria-label={`进入 ${file.name}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onEnterDirectory?.(file);
              }}
            >
              <span className="codicon codicon-chevron-right" />
            </button>
          )}
        </div>
      ))}

      {isLoading && suggestions.length === 0 && (
        <div className="suggestion-item suggestion-empty">
          <span className="codicon codicon-loading"></span>
          <div className="suggestion-content">
            <div className="suggestion-name">正在搜索文件...</div>
          </div>
        </div>
      )}
      {!isLoading && suggestions.length === 0 && !isBrowse && (
        <div className="suggestion-item suggestion-empty">
          <span className="codicon codicon-search"></span>
          <div className="suggestion-content">
            <div className="suggestion-name">未找到匹配的文件</div>
          </div>
        </div>
      )}
      {!isLoading && suggestions.length === 0 && isBrowse && (
        <div className="suggestion-item suggestion-empty">
          <span className="codicon codicon-folder"></span>
          <div className="suggestion-content">
            <div className="suggestion-name">此目录为空</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileSuggestionDropdown;
