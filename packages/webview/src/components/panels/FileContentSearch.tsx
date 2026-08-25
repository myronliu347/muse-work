import React, { useMemo, useState } from "react";
import type { ContentSearchFileHit, ContentSearchState } from "../../types";
import { FileIcon } from "./FileIcon";

export type FileContentSearchProps = {
  workdir: string | undefined;
  state: ContentSearchState;
  onStateChange: (next: ContentSearchState) => void;
  onOpenMatch: (absPath: string, line: number) => void;
};

type ViewMode = "list" | "tree";

type SearchTreeFile = { kind: "file"; file: ContentSearchFileHit };
type SearchTreeDir = {
  kind: "dir";
  name: string;
  path: string;
  children: SearchTreeNode[];
  fileCount: number;
};
type SearchTreeNode = SearchTreeFile | SearchTreeDir;

function buildSearchTree(results: ContentSearchFileHit[]): SearchTreeNode[] {
  const root: SearchTreeDir = {
    kind: "dir",
    name: "",
    path: "",
    children: [],
    fileCount: 0,
  };
  for (const file of results) {
    const parts = file.relativePath.split("/");
    const fileName = parts.pop() || file.relativePath;
    let node = root;
    let dirPath = "";
    for (const part of parts) {
      dirPath = dirPath ? `${dirPath}/${part}` : part;
      let child = node.children.find(
        (c): c is SearchTreeDir => c.kind === "dir" && c.path === dirPath,
      );
      if (!child) {
        child = {
          kind: "dir",
          name: part,
          path: dirPath,
          children: [],
          fileCount: 0,
        };
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({ kind: "file", file });
  }
  const countFiles = (dir: SearchTreeDir): number => {
    dir.fileCount = dir.children.reduce(
      (n, c) => n + (c.kind === "file" ? 1 : countFiles(c)),
      0,
    );
    return dir.fileCount;
  };
  countFiles(root);
  return compressTree(root.children);
}

// Collapse chains of single-child dirs into one node: src -> components -> ui
// renders as a single "src/components/ui" node instead of three nested empty
// dirs. A dir with file siblings (or multiple children) stays as is.
function compressTree(nodes: SearchTreeNode[]): SearchTreeNode[] {
  const out: SearchTreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === "dir") {
      const children = compressTree(node.children);
      // Single dir child and nothing else: fold the child's name into ours.
      if (children.length === 1 && children[0].kind === "dir") {
        const child = children[0];
        out.push({
          kind: "dir",
          name: `${node.name}/${child.name}`,
          path: child.path,
          children: child.children,
          fileCount: child.fileCount,
        });
      } else {
        out.push({ ...node, children });
      }
    } else {
      out.push(node);
    }
  }
  return out;
}

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
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const matchCount = state.results.reduce((n, f) => n + f.matches.length, 0);
  const fileCount = state.results.length;
  const expanded = new Set(state.expandedFiles);

  const tree = useMemo(() => buildSearchTree(state.results), [state.results]);

  const selectedFile =
    state.results.find((f) => f.path === selectedPath) ?? state.results[0];

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

  const renderTreeDir = (dir: SearchTreeDir, depth: number): React.ReactNode => {
    const collapsed = collapsedDirs.has(dir.path);
    return (
      <div key={dir.path}>
        <button
          type="button"
          className="file-content-search-tree-row"
          style={{ paddingLeft: 4 + depth * 12 }}
          data-testid={`content-search-tree-dir-${dir.path}`}
          onClick={() => toggleDir(dir.path)}
        >
          <i
            className={`codicon ${
              collapsed ? "codicon-chevron-right" : "codicon-chevron-down"
            } file-tree-chevron`}
            aria-hidden
          />
          <FileIcon name="folder" isDirectory className="file-tree-icon" />
          <span className="file-content-search-tree-name">{dir.name}</span>
          <span className="file-content-search-file-count">
            ({dir.fileCount})
          </span>
        </button>
        {!collapsed &&
          dir.children.map((child) =>
            child.kind === "dir"
              ? renderTreeDir(child, depth + 1)
              : renderTreeFile(child.file, depth + 1),
          )}
      </div>
    );
  };

  const renderTreeFile = (
    file: ContentSearchFileHit,
    depth: number,
  ): React.ReactNode => {
    const name = file.relativePath.split("/").pop() || file.relativePath;
    const selected = selectedFile?.path === file.path;
    return (
      <button
        key={file.path}
        type="button"
        className={`file-content-search-tree-row${
          selected ? " file-content-search-tree-row--selected" : ""
        }`}
        style={{ paddingLeft: 4 + depth * 12 }}
        data-testid={`content-search-tree-file-${file.relativePath}`}
        onClick={() => setSelectedPath(file.path)}
      >
        <span className="file-tree-chevron-slot" aria-hidden />
        <FileIcon name={name} className="file-tree-icon" />
        <span className="file-content-search-tree-name">{name}</span>
        <span className="file-content-search-file-count">
          ({file.matches.length})
        </span>
      </button>
    );
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
        <div className="file-content-search-split" data-testid="content-search-tree-panel">
          <div className="file-content-search-detail">
            {selectedFile ? (
              <>
                <div className="file-content-search-detail-header">
                  <FileIcon
                    name={selectedFile.relativePath.split("/").pop() || selectedFile.relativePath}
                    className="file-tree-icon"
                  />
                  <span className="file-content-search-file-path">
                    {selectedFile.relativePath}
                  </span>
                  <span className="file-content-search-file-count">
                    ({selectedFile.matches.length})
                  </span>
                </div>
                <div className="file-content-search-results">
                  {renderMatches(selectedFile)}
                </div>
              </>
            ) : (
              <div className="file-tree-empty">无匹配</div>
            )}
          </div>
          <div className="file-content-search-tree">
            {tree.map((node) =>
              node.kind === "dir"
                ? renderTreeDir(node, 0)
                : renderTreeFile(node.file, 0),
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FileContentSearch;
