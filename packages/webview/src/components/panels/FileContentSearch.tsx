import React, { useMemo, useState } from "react";
import type { ContentSearchFileHit, ContentSearchState } from "../../types";
import { buildPathTree, pathSegments } from "../../utils/pathTree";
import { FileIcon } from "./FileIcon";
import { PathTree } from "./PathTree";

export type FileContentSearchProps = {
  workdir: string | undefined;
  state: ContentSearchState;
  onStateChange: (next: ContentSearchState) => void;
  onOpenMatch: (absPath: string, line: number) => void;
};

type ViewMode = "list" | "tree";

function highlightLine(
  text: string,
  startCol: number,
  endCol: number,
): React.ReactNode {
  const start = Math.max(0, Math.min(startCol, text.length));
  const end = Math.max(start, Math.min(endCol, text.length));
  if (end <= start) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark className="file-content-search-mark">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

export const FileContentSearch: React.FC<FileContentSearchProps> = ({
  workdir,
  state,
  onStateChange,
  onOpenMatch,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const matchCount = state.results.reduce((n, f) => n + f.matches.length, 0);
  const fileCount = state.results.length;
  const expanded = new Set(state.expandedFiles);

  const tree = useMemo(
    () =>
      buildPathTree(
        state.results.map((file) => ({
          segments: pathSegments(file.relativePath),
          path: file.path,
          data: file,
        })),
      ),
    [state.results],
  );

  const toggleExpanded = (rel: string) => {
    const next = new Set(state.expandedFiles);
    if (next.has(rel)) next.delete(rel);
    else next.add(rel);
    onStateChange({ ...state, expandedFiles: Array.from(next) });
  };

  const toggleFlag = (
    key: "caseSensitive" | "wholeWord" | "regex",
  ) => {
    onStateChange({ ...state, [key]: !state[key] });
  };

  const toggleDir = (dirPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const viewToggles = (
    <div className="file-content-search-view-toggle">
      <button
        type="button"
        className="file-tree-mode-btn"
        data-testid="content-search-view-list"
        aria-pressed={viewMode === "list"}
        title="列表视图"
        onClick={() => setViewMode("list")}
      >
        <i className="codicon codicon-list-flat" aria-hidden />
      </button>
      <button
        type="button"
        className="file-tree-mode-btn"
        data-testid="content-search-view-tree"
        aria-pressed={viewMode === "tree"}
        title="树视图"
        onClick={() => setViewMode("tree")}
      >
        <i className="codicon codicon-list-tree" aria-hidden />
      </button>
    </div>
  );

  const renderMatches = (file: ContentSearchFileHit) =>
    file.matches.map((m, idx) => (
      <button
        // startCol is the *clipped* column (long lines truncate the
        // match window); two matches on one line can clip to the
        // same column, so the index keeps keys unique.
        key={`${file.path}-${m.line}-${m.startCol}-${idx}`}
        type="button"
        className="file-content-search-match"
        data-testid={`content-search-match-${file.relativePath}-${m.line}`}
        onClick={() => onOpenMatch(file.path, m.line)}
      >
        <span className="file-content-search-match-line">{m.line}</span>
        <span className="file-content-search-match-text">
          {highlightLine(m.text, m.startCol, m.endCol)}
        </span>
      </button>
    ));

  if (!workdir) {
    return (
      <div className="file-content-search" data-testid="file-content-search">
        <div className="file-tree-empty">选择工作目录后搜索</div>
      </div>
    );
  }

  return (
    <div className="file-content-search" data-testid="file-content-search">
      <div className="file-content-search-bar">
        <input
          type="text"
          className="file-content-search-input"
          data-testid="content-search-input"
          placeholder="搜索文件内容"
          value={state.query}
          onChange={(e) =>
            onStateChange({ ...state, query: e.target.value })
          }
        />
        <div className="file-content-search-options">
          <div className="file-content-search-toggles">
            <button
              type="button"
              className="file-content-search-toggle"
              data-testid="content-search-case"
              aria-pressed={state.caseSensitive}
              title="区分大小写"
              onClick={() => toggleFlag("caseSensitive")}
            >
              Aa
            </button>
            <button
              type="button"
              className="file-content-search-toggle"
              data-testid="content-search-word"
              aria-pressed={state.wholeWord}
              title="全词匹配"
              onClick={() => toggleFlag("wholeWord")}
            >
              W
            </button>
            <button
              type="button"
              className="file-content-search-toggle"
              data-testid="content-search-regex"
              aria-pressed={state.regex}
              title="正则表达式"
              onClick={() => toggleFlag("regex")}
            >
              .*
            </button>
          </div>
          {viewToggles}
        </div>
      </div>
      <div className="file-content-search-status">
        {state.loading
          ? "搜索中…"
          : state.error
            ? state.error
            : state.query.trim()
              ? `${matchCount} results in ${fileCount} files${
                  state.truncated ? "（已截断）" : ""
                }`
              : "输入关键词搜索"}
      </div>
      {viewMode === "list" ? (
        <div className="file-content-search-results">
          {state.results.map((file) => {
            const open = expanded.has(file.relativePath);
            const name =
              file.relativePath.split("/").pop() || file.relativePath;
            return (
              <div
                key={file.path}
                className="file-content-search-file"
                data-testid={`content-search-file-${file.relativePath}`}
              >
                <button
                  type="button"
                  className="file-content-search-file-header"
                  onClick={() => toggleExpanded(file.relativePath)}
                >
                  <i
                    className={`codicon ${
                      open ? "codicon-chevron-down" : "codicon-chevron-right"
                    } file-tree-chevron`}
                    aria-hidden
                  />
                  <FileIcon name={name} className="file-tree-icon" />
                  <span className="file-content-search-file-path">
                    {file.relativePath}
                  </span>
                  <span className="file-content-search-file-count">
                    ({file.matches.length})
                  </span>
                </button>
                {open && renderMatches(file)}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className="file-content-search-tree"
          data-testid="content-search-tree-panel"
        >
          <PathTree
            nodes={tree}
            collapsedDirs={collapsedDirs}
            onToggleDir={toggleDir}
            fileExpandable
            isFileExpanded={(node) => expanded.has(node.data.relativePath)}
            onFileClick={(node) => toggleExpanded(node.data.relativePath)}
            getDirTestId={(node) => `content-search-tree-dir-${node.path}`}
            getFileTestId={(node) =>
              `content-search-tree-file-${node.data.relativePath}`
            }
            renderDirTrailing={(node) => (
              <span className="file-content-search-file-count">
                ({node.fileCount})
              </span>
            )}
            renderFileTrailing={(node) => (
              <span className="file-content-search-file-count">
                ({node.data.matches.length})
              </span>
            )}
            renderFileChildren={(node, depth) => (
              <div
                className="file-content-search-tree-matches"
                style={{ paddingLeft: 8 + (depth + 1) * 12 }}
              >
                {renderMatches(node.data)}
              </div>
            )}
          />
        </div>
      )}
    </div>
  );
};

export default FileContentSearch;
