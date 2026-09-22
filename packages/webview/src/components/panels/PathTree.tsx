import React from "react";
import type { PathTreeDir, PathTreeLeaf, PathTreeNode } from "../../utils/pathTree";
import { FileIcon } from "./FileIcon";
import "../../styles/PathTree.css";

export type PathTreeProps<T> = {
  nodes: PathTreeNode<T>[];
  collapsedDirs: ReadonlySet<string>;
  onToggleDir: (dirPath: string) => void;
  onFileClick: (node: PathTreeLeaf<T>) => void;
  /** Highlight the file whose `node.path` matches. */
  selectedPath?: string | null;
  /** When true, file rows show an expand chevron (content search). */
  fileExpandable?: boolean;
  isFileExpanded?: (node: PathTreeLeaf<T>) => boolean;
  renderFileTrailing?: (node: PathTreeLeaf<T>) => React.ReactNode;
  renderDirTrailing?: (node: PathTreeDir<T>) => React.ReactNode;
  /** Extra content under an expanded file row (e.g. search matches). */
  renderFileChildren?: (
    node: PathTreeLeaf<T>,
    depth: number,
  ) => React.ReactNode;
  getDirTestId?: (node: PathTreeDir<T>) => string;
  getFileTestId?: (node: PathTreeLeaf<T>) => string;
  /** Extra class on the file row button (e.g. status-based test hooks). */
  getFileClassName?: (
    node: PathTreeLeaf<T>,
    selected: boolean,
  ) => string | undefined;
  /** Extra data-* attrs on the file row button. */
  getFileDataAttrs?: (
    node: PathTreeLeaf<T>,
  ) => Record<string, string | undefined>;
  indentBase?: number;
  indentStep?: number;
};

const DEFAULT_INDENT_BASE = 8;
const DEFAULT_INDENT_STEP = 12;

export function PathTree<T>({
  nodes,
  collapsedDirs,
  onToggleDir,
  onFileClick,
  selectedPath = null,
  fileExpandable = false,
  isFileExpanded,
  renderFileTrailing,
  renderDirTrailing,
  renderFileChildren,
  getDirTestId,
  getFileTestId,
  getFileClassName,
  getFileDataAttrs,
  indentBase = DEFAULT_INDENT_BASE,
  indentStep = DEFAULT_INDENT_STEP,
}: PathTreeProps<T>): React.ReactElement {
  const renderNode = (
    node: PathTreeNode<T>,
    depth: number,
  ): React.ReactNode => {
    if (node.kind === "dir") {
      const collapsed = collapsedDirs.has(node.path);
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            className="path-tree-row"
            data-testid={getDirTestId?.(node) ?? `path-tree-dir-${node.path}`}
            aria-expanded={!collapsed}
            title={node.path}
            onClick={() => onToggleDir(node.path)}
            style={{ paddingLeft: indentBase + depth * indentStep }}
          >
            <i
              className={`codicon ${
                collapsed ? "codicon-chevron-right" : "codicon-chevron-down"
              } path-tree-chevron`}
              aria-hidden
            />
            <FileIcon
              name={node.name}
              isDirectory
              isOpen={!collapsed}
              className="path-tree-icon"
            />
            <span className="path-tree-name">{node.name}</span>
            {renderDirTrailing?.(node)}
          </button>
          {!collapsed &&
            node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    const selected = selectedPath != null && node.path === selectedPath;
    const expanded = Boolean(isFileExpanded?.(node));
    const extraClass = getFileClassName?.(node, selected);
    const dataAttrs = getFileDataAttrs?.(node) ?? {};
    return (
      <div key={`file:${node.path}`}>
        <button
          type="button"
          className={[
            "path-tree-row",
            selected ? "path-tree-row--selected" : "",
            extraClass ?? "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-testid={getFileTestId?.(node) ?? `path-tree-file-${node.path}`}
          data-path={node.path}
          title={node.path}
          aria-current={selected || undefined}
          onClick={() => onFileClick(node)}
          style={{ paddingLeft: indentBase + depth * indentStep }}
          {...dataAttrs}
        >
          {fileExpandable ? (
            <i
              className={`codicon ${
                expanded ? "codicon-chevron-down" : "codicon-chevron-right"
              } path-tree-chevron`}
              aria-hidden
            />
          ) : (
            <span className="path-tree-chevron-slot" aria-hidden />
          )}
          <FileIcon name={node.name} className="path-tree-icon" />
          <span className="path-tree-name">{node.name}</span>
          {renderFileTrailing?.(node)}
        </button>
        {expanded && renderFileChildren?.(node, depth)}
      </div>
    );
  };

  return (
    <div className="path-tree" data-testid="path-tree">
      {nodes.map((node) => renderNode(node, 0))}
    </div>
  );
}

export default PathTree;
