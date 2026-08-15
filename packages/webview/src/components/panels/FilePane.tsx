import React, { useEffect, useRef, useState } from "react";
import type {
  ContentSearchState,
  FileSidebarMode,
  FileTreeState,
  FileViewState,
} from "../../types";
import {
  ensureExpandedForFile,
  emptyFileTreeState,
  emptyContentSearchState,
} from "../../stores/panelGroupStore";
import { FilePathBar } from "./FilePathBar";
import { FilePreview } from "./FilePreview";
import { FileTree } from "./FileTree";
import "../../styles/FilePane.css";

const MIN_WIDTH = 320;

const isMarkdownPath = (path: string) =>
  /\.(md|markdown|mdown|mkd)$/i.test(path);

export interface FilePaneProps {
  fileView: FileViewState | null;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
  onClose: () => void;
  workdir?: string;
  vscode: { postMessage: (msg: unknown) => void };
  fileTree?: FileTreeState;
  onFileTreeChange?: (next: FileTreeState) => void;
  fileSidebarMode?: FileSidebarMode;
  onFileSidebarModeChange?: (mode: FileSidebarMode) => void;
  contentSearch?: ContentSearchState;
  onContentSearchChange?: (next: ContentSearchState) => void;
  onOpenFile: (path: string, startLine?: number, endLine?: number) => void;
  onRevealInFinder?: (path: string) => void;
}

export const FilePane: React.FC<FilePaneProps> = ({
  fileView,
  width,
  onWidthChange,
  maxWidth,
  workdir,
  vscode,
  fileTree = emptyFileTreeState(),
  onFileTreeChange,
  fileSidebarMode = "tree",
  onFileSidebarModeChange,
  contentSearch = emptyContentSearchState(),
  onContentSearchChange,
  onOpenFile,
  onRevealInFinder,
}) => {
  const asideRef = useRef<HTMLElement>(null);
  const [mdMode, setMdMode] = useState<"preview" | "source">("preview");
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!fileView?.path || !workdir || !onFileTreeChange) return;
    if (lastPathRef.current === fileView.path) return;
    lastPathRef.current = fileView.path;
    onFileTreeChange(
      ensureExpandedForFile(fileTree, workdir, fileView.path),
    );
    setMdMode("preview");
    // Only react to path changes; fileTree identity intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileView?.path, workdir]);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.style.background = "var(--accent-9)";
    document.body.classList.add("is-panel-resizing");
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
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

  const isMd = !!(fileView?.content && isMarkdownPath(fileView.path));
  const treeCollapsed = fileTree.collapsed !== false;
  const showTreeToggle = Boolean(onFileTreeChange);

  const toggleTreeCollapsed = () => {
    if (!onFileTreeChange) return;
    onFileTreeChange({ ...fileTree, collapsed: !treeCollapsed });
  };

  return (
    <aside
      ref={asideRef}
      className="preview-pane file-pane"
      style={{ width }}
      data-testid="file-pane"
    >
      <div className="preview-pane-drag-handle" onMouseDown={onDragStart} />
      <div className="preview-pane-inner file-pane-inner">
        <div className="file-pane-left">
          <div className="preview-pane-toolbar">
            {fileView ? (
              <FilePathBar path={fileView.path} workdir={workdir} />
            ) : (
              <span className="preview-pane-url">文件</span>
            )}
            <div className="file-pane-toolbar-actions">
              {isMd && (
                <div className="file-pane-md-toggle" data-testid="file-md-toggle">
                  <button
                    type="button"
                    className="preview-pane-button"
                    aria-pressed={mdMode === "preview"}
                    onClick={() => setMdMode("preview")}
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    className="preview-pane-button"
                    aria-pressed={mdMode === "source"}
                    onClick={() => setMdMode("source")}
                  >
                    源码
                  </button>
                </div>
              )}
              {showTreeToggle && treeCollapsed && (
                <button
                  type="button"
                  className="preview-pane-button"
                  data-testid="file-tree-expand-btn"
                  title="展开文件树"
                  aria-label="展开文件树"
                  aria-pressed={false}
                  onClick={toggleTreeCollapsed}
                >
                  <i className="codicon codicon-list-tree" aria-hidden />
                </button>
              )}
            </div>
          </div>
          <div className="preview-pane-body file-pane-body">
            {!fileView && (
              <div className="desktop-panel-placeholder">
                <i className="codicon codicon-file file-pane-placeholder-icon" />
                <span>从消息或文件树打开文件</span>
              </div>
            )}
            {fileView && (
              <FilePreview
                fileView={fileView}
                workdir={workdir}
                onRevealInFinder={onRevealInFinder}
                markdownMode={mdMode}
              />
            )}
          </div>
        </div>
        {onFileTreeChange && !treeCollapsed && (
          <FileTree
            workdir={workdir}
            vscode={vscode}
            tree={fileTree}
            onTreeChange={onFileTreeChange}
            onOpenFile={(path) => onOpenFile(path)}
            sidebarMode={fileSidebarMode}
            onSidebarModeChange={onFileSidebarModeChange}
            contentSearch={contentSearch}
            onContentSearchChange={onContentSearchChange}
            onOpenMatch={(path, line) => onOpenFile(path, line)}
          />
        )}
      </div>
    </aside>
  );
};

export default FilePane;
