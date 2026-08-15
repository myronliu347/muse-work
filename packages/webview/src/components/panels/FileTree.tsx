import React, { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileTreeDirEntry, FileTreeState } from "../../types";
import {
  clampFileTreeWidth,
  FILE_TREE_WIDTH_DEFAULT,
} from "../../stores/panelGroupStore";
import { FileIcon } from "./FileIcon";

const ROW_HEIGHT = 22;

export type FileTreeProps = {
  workdir: string | undefined;
  vscode: { postMessage: (msg: unknown) => void };
  tree: FileTreeState;
  onTreeChange: (next: FileTreeState) => void;
  onOpenFile: (absPath: string) => void;
};

type FlatRow = FileTreeDirEntry & { depth: number };

function flatten(
  cache: Record<string, FileTreeDirEntry[]>,
  expanded: Set<string>,
  dir = "",
  depth = 0,
): FlatRow[] {
  const entries = cache[dir] ?? [];
  const out: FlatRow[] = [];
  for (const e of entries) {
    out.push({ ...e, depth });
    if (e.isDirectory && expanded.has(e.relativePath)) {
      out.push(...flatten(cache, expanded, e.relativePath, depth + 1));
    }
  }
  return out;
}

let listReqSeq = 0;

export const FileTree: React.FC<FileTreeProps> = ({
  workdir,
  vscode,
  tree,
  onTreeChange,
  onOpenFile,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [pendingDirs, setPendingDirs] = useState<Set<string>>(new Set());
  const width = tree.width || FILE_TREE_WIDTH_DEFAULT;

  const expandedSet = useMemo(
    () => new Set(tree.expanded),
    [tree.expanded],
  );

  const rows = useMemo(
    () => flatten(tree.childrenCache, expandedSet),
    [tree.childrenCache, expandedSet],
  );

  const requestDir = (dir: string) => {
    if (!workdir) return;
    if (tree.childrenCache[dir] !== undefined) return;
    if (pendingDirs.has(dir)) return;
    setPendingDirs((prev) => new Set(prev).add(dir));
    const requestId = `listdir-${++listReqSeq}`;
    vscode.postMessage({
      command: "desktopListDir",
      requestId,
      dir,
    });
  };

  // Root load — skip post when cache already has root (tests / restore)
  useEffect(() => {
    if (!workdir) return;
    if (tree.childrenCache[""] !== undefined) return;
    requestDir("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-request when workdir changes
  }, [workdir]);

  // Load children for expanded dirs missing from cache
  useEffect(() => {
    if (!workdir) return;
    for (const dir of tree.expanded) {
      requestDir(dir);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workdir, tree.expanded.join("\0")]);

  // Clear pending when cache fills (host result lands via parent)
  useEffect(() => {
    setPendingDirs((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const dir of prev) {
        if (tree.childrenCache[dir] !== undefined) {
          next.delete(dir);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tree.childrenCache]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    initialRect: { width: 280, height: 400 },
  });

  const onWidthDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.style.background = "var(--accent-9)";
    document.body.classList.add("is-panel-resizing");
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      // Tree is on the right; dragging left increases width
      const next = clampFileTreeWidth(startW + (startX - ev.clientX));
      onTreeChange({ ...tree, width: next });
    };
    const onUp = () => {
      handle.style.background = "";
      document.body.classList.remove("is-panel-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const toggleDir = (rel: string) => {
    const set = new Set(tree.expanded);
    if (set.has(rel)) set.delete(rel);
    else set.add(rel);
    onTreeChange({ ...tree, expanded: Array.from(set) });
  };

  if (!workdir) {
    return (
      <div className="file-tree file-tree--empty" style={{ width }}>
        <div className="file-tree-drag-handle" onMouseDown={onWidthDragStart} />
        <div className="file-tree-header">
          <FileIcon name="folder" isDirectory className="file-tree-icon" />
          <span className="file-tree-workdir" title="">
            无工作目录
          </span>
        </div>
        <div className="file-tree-empty">选择工作目录后显示文件</div>
      </div>
    );
  }

  const workdirName =
    workdir.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ||
    workdir;

  return (
    <div className="file-tree" style={{ width }} data-testid="file-tree">
      <div
        className="file-tree-drag-handle"
        onMouseDown={onWidthDragStart}
        data-testid="file-tree-resize"
      />
      <div className="file-tree-header" title={workdir} data-testid="file-tree-workdir">
        <FileIcon
          name={workdirName}
          isDirectory
          isOpen
          className="file-tree-icon"
        />
        <span className="file-tree-workdir">{workdirName}</span>
      </div>
      <div className="file-tree-scroll" ref={parentRef}>
        <div
          className="file-tree-virtual"
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((vRow) => {
            const row = rows[vRow.index];
            const selected = tree.selected === row.path;
            const open = row.isDirectory && expandedSet.has(row.relativePath);
            return (
              <div
                key={row.path}
                className={`file-tree-row${selected ? " file-tree-row--selected" : ""}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${vRow.size}px`,
                  transform: `translateY(${vRow.start}px)`,
                  paddingLeft: 8 + row.depth * 12,
                }}
                data-testid={`file-tree-row-${row.relativePath}`}
                onClick={() => {
                  if (row.isDirectory) toggleDir(row.relativePath);
                  else onOpenFile(row.path);
                }}
              >
                <FileIcon
                  name={row.name}
                  isDirectory={row.isDirectory}
                  isOpen={open}
                  className="file-tree-icon"
                />
                <span className="file-tree-name">{row.name}</span>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && (
          <div className="file-tree-empty">
            {pendingDirs.has("") ? "加载中…" : "空目录"}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileTree;
