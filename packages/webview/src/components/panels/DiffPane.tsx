import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PatchDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation } from "@pierre/diffs";
import type { VsCodeApi, DiffViewState } from "../../types";
import {
  resolveDiffLineText,
  toPierrePatch,
} from "../../utils/toPierrePatch";
import {
  resolveWorkspaceFilePath,
  displayFilePath,
} from "../../utils/filePathDisplay";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import { Tooltip } from "../shared/Tooltip";
import "../../styles/DiffViewer.css";
import "../../styles/DiffPane.css";

type PendingRevert = { scope: "all" } | { scope: "file"; path: string };

export type WorkspaceFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked";

export interface WorkspaceDiffFile {
  path: string;
  status: WorkspaceFileStatus;
  oldPath?: string;
  additions: number;
  deletions: number;
  hunks: string;
  truncated: boolean;
  binary: boolean;
}

type DiffState =
  | { kind: "loading" }
  | { kind: "not-a-repo" }
  | { kind: "ok"; files: WorkspaceDiffFile[] };

const STATUS_LABEL: Record<WorkspaceFileStatus, string> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
  renamed: "重命名",
  untracked: "未跟踪",
};

const STATUS_ICON: Record<WorkspaceFileStatus, string> = {
  added: "codicon-diff-added",
  modified: "codicon-diff-modified",
  deleted: "codicon-diff-removed",
  renamed: "codicon-diff-renamed",
  untracked: "codicon-diff-added",
};

/** One node of the tree view: either a directory (children) or a changed
 *  file (file). Built from the flat diff file list in buildDiffTree. */
export interface DiffTreeNode {
  name: string;
  /** Directory key ("src/sub") for dirs; the original file path for files. */
  path: string;
  isDir: boolean;
  file?: WorkspaceDiffFile;
  children?: DiffTreeNode[];
}

const DIR_PATH_SEP = "/";

/** Split a (relative or absolute) file path into non-empty segments. */
function pathSegments(path: string): string[] {
  return path
    .replace(/\\/g, DIR_PATH_SEP)
    .split(DIR_PATH_SEP)
    .filter((s) => s.length > 0);
}

/** Organize the flat diff file list into a directory tree. Only directories
 *  affected by the changed files are created; each file becomes a leaf node
 *  carrying its WorkspaceDiffFile. Paths under workdir are shown relative to
 *  it (same semantics as the list view); single-child directory chains are
 *  merged into one node so deep "a/b/c" tunnels do not bury the file. */
export function buildDiffTree(
  files: WorkspaceDiffFile[],
  workdir?: string,
): DiffTreeNode[] {
  const dirs = new Map<string, DiffTreeNode>();
  const roots: DiffTreeNode[] = [];
  for (const file of files) {
    const segments = pathSegments(displayFilePath(file.path, workdir));
    if (segments.length === 0) continue;
    let siblings = roots;
    let dirPath = "";
    for (let i = 0; i < segments.length - 1; i++) {
      dirPath = dirPath ? `${dirPath}${DIR_PATH_SEP}${segments[i]}` : segments[i];
      let dirNode = dirs.get(dirPath);
      if (!dirNode) {
        const children: DiffTreeNode[] = [];
        dirNode = { name: segments[i], path: dirPath, isDir: true, children };
        dirs.set(dirPath, dirNode);
        siblings.push(dirNode);
      }
      siblings = dirNode.children!;
    }
    siblings.push({
      name: segments[segments.length - 1],
      path: file.path,
      isDir: false,
      file,
    });
  }
  return mergeSingleDirChains(roots);
}

/** Collapse runs of directories whose only child is another directory into a
 *  single node (GitHub/VS Code compact-folders style): "a/b/c/file.ts"
 *  renders as one "a/b/c" row plus the file, not three nested rows. */
function mergeSingleDirChains(nodes: DiffTreeNode[]): DiffTreeNode[] {
  return nodes.map((node) => {
    if (!node.isDir) return node;
    let dir = node;
    while (
      dir.children !== undefined &&
      dir.children.length === 1 &&
      dir.children[0].isDir
    ) {
      const only = dir.children[0];
      dir = { ...only, name: `${dir.name}${DIR_PATH_SEP}${only.name}` };
    }
    return {
      ...dir,
      children: mergeSingleDirChains(dir.children ?? []),
    };
  });
}

/** Total number of changed files under a tree node (directories recurse). */
export function countDiffTreeFiles(node: DiffTreeNode): number {
  if (!node.isDir) return 1;
  return (node.children ?? []).reduce(
    (sum, child) => sum + countDiffTreeFiles(child),
    0,
  );
}

export interface DiffComment {
  path?: string;
  prefix?: string;
  text?: string;
  comment?: string;
}

/** User-visible markdown for a diff-line comment — appended to the chat input. */
export function formatDiffComment(msg: DiffComment): string {
  const prefixLabel =
    msg.prefix && msg.prefix !== " " ? `\`${msg.prefix}\`` : "";
  const location = [prefixLabel, msg.text ? `「${msg.text}」` : ""]
    .filter(Boolean)
    .join("");
  const lines = [
    `**差异评论** · ${msg.path ?? ""}`,
    location,
    "",
    msg.comment ?? "",
  ];
  return lines.join("\n");
}

const MIN_WIDTH = 320;

const PATCH_DIFF_OPTIONS = {
  diffStyle: "unified" as const,
  disableFileHeader: true,
  lineDiffType: "word" as const,
  overflow: "scroll" as const,
  enableGutterUtility: true,
  theme: { dark: "pierre-dark" as const, light: "pierre-light" as const },
  // Pierre defaults the utility slot to the right edge of the gutter (between
  // line numbers and code). GitHub-style comments put "+" on the far left.
  unsafeCSS: `
    [data-gutter-utility-slot] {
      right: unset;
      left: 0;
      justify-content: flex-start;
    }
    [data-gutter-utility-slot] button {
      margin-left: calc(-1lh + 2px);
    }
  `,
};

export interface DiffPaneProps {
  vscode: VsCodeApi;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
  onClose: () => void;
  /** Split-view pane this diff panel belongs to; filters host responses. */
  paneId?: string;
  /** Hidden panels stay mounted; a re-show triggers a fresh load. */
  visible: boolean;
  /** True→false edge while visible triggers a refresh (generation ended). */
  isStreaming: boolean;
  /** Session identity / workdir changes re-point the panel while visible. */
  sessionId?: string;
  workdir?: string;
  /** Receives a formatted diff-line comment; appended to this pane's chat input. */
  onAddComment?: (text: string) => void;
  /** Opens a workspace file in the desktop file panel. */
  onOpenFile?: (path: string) => void;
  /** Sends text as a real chat message (not append-to-input). */
  onSendMessage?: (text: string) => void;
  /** Per-session target state: recent mode renders the last message's
   *  file_history snapshot diff; unstaged renders the workspace git diff. */
  diffView?: DiffViewState | null;
  /** "最近一次修改" source: last assistant message's enriched file_history
   *  snapshots mapped to diff files. Survives session switches (derived from
   *  the live transcript in ChatApp). */
  recentFiles?: WorkspaceDiffFile[];
}

interface CommentTarget {
  file: WorkspaceDiffFile;
  side: "additions" | "deletions";
  lineNumber: number;
  prefix: string;
  text: string;
}

/** Workspace git-diff panel: accordion of per-file collapsible diff blocks. */
export const DiffPane: React.FC<DiffPaneProps> = ({
  vscode,
  width,
  onWidthChange,
  maxWidth,
  paneId,
  visible,
  isStreaming,
  sessionId,
  workdir,
  onAddComment,
  onOpenFile,
  onSendMessage,
  diffView,
  recentFiles,
}) => {
  const [state, setState] = useState<DiffState>({ kind: "loading" });
  // "最近一次修改" (file_history snapshot) vs "未提交文件" (workspace git diff).
  // Recent is the default; a diffView target (card row click) or an explicit
  // unstaged target switches modes.
  const [mode, setMode] = useState<"recent" | "unstaged">(
    diffView?.mode === "unstaged" ? "unstaged" : "recent",
  );
  // Mutual-exclusion accordion: at most one file is expanded at a time, so the
  // DOM holds every file header but only one file's hunks (bounded rendering
  // for large workspace diffs — data is still loaded once for all files).
  // The expanded path survives refreshes; defaults to the first file.
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  // Tree view (列表/树视图切换): list is the default and behaves exactly as
  // before; tree view splits the panel into a selected-file diff (left) and a
  // directory-organized change tree (right). Selection and dir collapse are
  // local UI state, never persisted.
  const [viewMode, setViewMode] = useState<"list" | "tree">("list");
  const [treeSelected, setTreeSelected] = useState<string | null>(null);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  // True while a refresh request is in flight; drives the toolbar spinner.
  const [refreshing, setRefreshing] = useState(false);
  const [pendingRevert, setPendingRevert] = useState<PendingRevert | null>(
    null,
  );
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);

  // Inline diff-line comment box (GitHub/GitLab style): hovering a line shows a
  // "+" button; clicking opens a comment box under that line whose contents
  // are appended to the chat input (not sent) so several can be batched.
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(
    null,
  );
  const [commentDraft, setCommentDraft] = useState("");
  const onAddCommentRef = useRef(onAddComment);
  onAddCommentRef.current = onAddComment;
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  const clearComment = useCallback(() => {
    setCommentTarget(null);
    setCommentDraft("");
  }, []);

  const submitComment = useCallback(() => {
    const target = commentTarget;
    const comment = commentDraft.trim();
    if (!target || !comment) return;
    onAddCommentRef.current?.(
      formatDiffComment({
        path: target.file.path,
        prefix: target.prefix,
        text: target.text,
        comment,
      }),
    );
    clearComment();
  }, [commentTarget, commentDraft, clearComment]);

  const cancelComment = useCallback(() => {
    clearComment();
  }, [clearComment]);

  // Auto-focus the textarea when a comment box opens.
  useEffect(() => {
    if (commentTarget) commentInputRef.current?.focus();
  }, [commentTarget]);

  // Hard refresh clears current content to the loading placeholder (used when
  // the session/workdir context changes); soft refresh keeps showing the old
  // content until the new diff arrives, so auto-refreshes don't flicker.
  const refresh = useCallback(
    (hard = false) => {
      if (hard) setState({ kind: "loading" });
      setRefreshing(true);
      // Refresh rewrites the hunks, so any open comment box + draft is stale.
      clearComment();
      vscode.postMessage({
        command: "desktopGetWorkspaceDiff",
        ...(paneId ? { paneId } : {}),
        ...(workdir ? { workdir } : {}),
      });
    },
    [vscode, paneId, workdir, clearComment],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (paneId !== undefined && msg.paneId !== paneId) return;
      if (msg?.command === "desktopWorkspaceDiffReverted") {
        setReverting(false);
        if (msg.ok) {
          refresh();
        } else {
          setRevertError(msg.error ?? "丢弃失败");
        }
        return;
      }
      if (msg?.command !== "desktopWorkspaceDiff") return;
      const result = msg.result;
      setRefreshing(false);
      setState(
        result?.kind === "ok"
          ? { kind: "ok", files: result.files }
          : { kind: "not-a-repo" },
      );
      // Default the first file to expanded on the first diff; keep the
      // currently expanded file across refreshes once the user has chosen one.
      setExpandedPath((prev) => prev ?? result?.files?.[0]?.path ?? null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [paneId, refresh]);

  // Refresh triggers: first mount (prev.visible starts false), re-show,
  // session/workdir change while visible, generation end while visible.
  // Only the unstaged (workspace git) mode issues a desktop request — recent
  // mode renders the transcript-derived recentFiles prop. A session/workdir
  // change also resets the mode back to recent (per-group diffView targets do
  // not survive a switch), so the new session's last-changed files show up.
  const prevRef = useRef({ visible: false, sessionId, workdir, isStreaming });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { visible, sessionId, workdir, isStreaming };
    const becameVisible = visible && !prev.visible;
    const becameHidden = !visible && prev.visible;
    const contextChanged =
      visible && (prev.sessionId !== sessionId || prev.workdir !== workdir);
    const generationEnded = visible && prev.isStreaming && !isStreaming;
    if (contextChanged) {
      // A new session/workdir: default back to 最近一次修改 so the reloaded
      // transcript's file_history card data is visible immediately.
      setMode((m) => (m === "recent" ? m : "recent"));
      const files = recentFiles ?? [];
      setState({ kind: "ok", files });
      if (files.length > 0) setExpandedPath(files[0].path);
    } else if (becameHidden) {
      // The panel stays mounted while hidden (display:none) — release the held
      // diff content so a closed panel does not pin the workspace diff in
      // memory forever. Re-shown it is rebuilt (recent) or re-fetched
      // (unstaged) below.
      setState({ kind: "ok", files: [] });
      setExpandedPath(null);
    } else if (becameVisible) {
      if (mode === "unstaged") {
        refresh();
      } else {
        const files = recentFiles ?? [];
        setState({ kind: "ok", files });
        if (files.length > 0) {
          setExpandedPath((prev) => prev ?? files[0].path);
        }
      }
    } else if (mode === "unstaged" && generationEnded) {
      refresh();
    }
  }, [visible, sessionId, workdir, isStreaming, refresh, mode, recentFiles]);

  // Recent mode renders the live recentFiles prop; keep state in sync when the
  // transcript reloads (session switch, generation end, revert broadcast).
  // Guard against a setState feedback loop: if the parent hands us a fresh
  // recentFiles array on every render (e.g. it re-maps messages), setState
  // would re-render → new array → setState… ("Maximum update depth exceeded").
  // Compare the rendered file paths instead; identical content is a no-op.
  const prevRecentRef = useRef<{ files: WorkspaceDiffFile[]; mode: "recent" | "unstaged" }>({ files: [], mode: "recent" });
  useEffect(() => {
    if (mode !== "recent") return;
    const files = recentFiles ?? [];
    const prev = prevRecentRef.current;
    const samePaths =
      prev.mode === "recent" &&
      prev.files.length === files.length &&
      prev.files.every((f, i) => f.path === files[i]?.path);
    if (samePaths) return;
    prevRecentRef.current = { files, mode };
    setState({ kind: "ok", files });
    if (files.length > 0) {
      setExpandedPath((prev2) => prev2 ?? files[0].path);
    }
  }, [recentFiles, mode]);

  // A fresh diffView target (card row click) switches mode; the file target is
  // resolved against recentFiles (path may be relative vs absolute).
  const prevDiffViewRef = useRef(diffView);
  useEffect(() => {
    if (!diffView || diffView === prevDiffViewRef.current) return;
    prevDiffViewRef.current = diffView;
    if (diffView.mode === "unstaged") {
      setMode("unstaged");
      refresh(true);
    } else {
      setMode("recent");
      if (diffView.file?.path) {
        const files = recentFiles ?? [];
        const hit = files.find((f) => f.path === diffView.file!.path);
        if (hit) {
          setExpandedPath(hit.path);
          setTreeSelected(hit.path);
        }
      }
    }
  }, [diffView, refresh, recentFiles]);

  const switchMode = (next: "recent" | "unstaged") => {
    if (next === mode) return;
    setMode(next);
    if (next === "recent") {
      const files = recentFiles ?? [];
      setState({ kind: "ok", files });
      if (files.length > 0) setExpandedPath(files[0].path);
    } else {
      refresh(true);
    }
  };

  const confirmRevert = () => {
    if (!pendingRevert || state.kind !== "ok") {
      setPendingRevert(null);
      return;
    }
    const paths =
      pendingRevert.scope === "all"
        ? state.files.map((f) => f.path)
        : [pendingRevert.path];
    setPendingRevert(null);
    setReverting(true);
    setRevertError(null);
    vscode.postMessage({
      command: "desktopRevertWorkspaceDiff",
      ...(paneId ? { paneId } : {}),
      ...(workdir ? { workdir } : {}),
      paths,
    });
  };

  const toggleFile = (path: string) => {
    // Mutual exclusion: expanding one file collapses every other.
    setExpandedPath((prev) => (prev === path ? null : path));
    clearComment();
  };

  // Tree view data derived from the current ok-state files.
  const diffTree = useMemo(
    () => (state.kind === "ok" ? buildDiffTree(state.files, workdir) : []),
    [state, workdir],
  );
  const treeFiles = state.kind === "ok" ? state.files : [];
  // The file shown on the tree view's left side: the tree selection when set,
  // else the list view's expanded file, else the first file. Falls back to the
  // first file whenever the picked path is no longer among the files.
  const activeFile =
    treeFiles.find((f) => f.path === (treeSelected ?? expandedPath)) ??
    treeFiles[0] ??
    null;
  const activePath = activeFile?.path ?? null;

  // Drop a stale tree selection once its file disappears from the diff.
  useEffect(() => {
    if (treeSelected == null || state.kind !== "ok") return;
    if (!state.files.some((f) => f.path === treeSelected)) {
      setTreeSelected(null);
    }
  }, [state, treeSelected]);

  const toggleDir = (dirPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    // Keep the handle lit + cursor locked for the whole drag — :hover and the
    // 6px-only col-resize cursor both flicker as the pointer outruns the handle.
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

  const renderCommentBox = (file: WorkspaceDiffFile) => (
    <div className="diff-comment-box" data-testid="diff-comment-box">
      <textarea
        ref={commentInputRef}
        className="diff-comment-input"
        data-testid="diff-comment-input"
        placeholder="评论这行改动…"
        value={commentDraft}
        onChange={(e) => setCommentDraft(e.target.value)}
        onKeyDown={(e) => {
          // IME composing (e.g. Chinese pinyin): Enter confirms the
          // candidate, not a submit. keyCode 229 covers older engines
          // where isComposing is unset.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submitComment();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelComment();
          }
        }}
      />
      <div className="diff-comment-box-footer">
        <span className="diff-comment-box-tag" title={file.path}>
          {file.path}
        </span>
        <button
          className="diff-comment-box-cancel"
          data-testid="diff-comment-cancel"
          onClick={cancelComment}
        >
          取消
        </button>
        <button
          className="diff-comment-box-send"
          title="添加到输入框"
          data-testid="diff-comment-submit"
          disabled={commentDraft.trim() === ""}
          onClick={submitComment}
        >
          添加
        </button>
      </div>
    </div>
  );

  const renderFileBody = (file: WorkspaceDiffFile) => {
    if (file.binary) {
      return <div className="diff-line-ellipsis">二进制文件，不显示差异</div>;
    }
    const patch = toPierrePatch(file);
    if (!patch) {
      return (
        <div className="diff-line-ellipsis">
          {file.status === "renamed" && file.oldPath
            ? `重命名自 ${file.oldPath}`
            : "无内容差异"}
        </div>
      );
    }

    const lineAnnotations: DiffLineAnnotation[] =
      commentTarget?.file.path === file.path
        ? [
            {
              side: commentTarget.side,
              lineNumber: commentTarget.lineNumber,
            },
          ]
        : [];

    return (
      <PatchDiff
        patch={patch}
        disableWorkerPool
        options={PATCH_DIFF_OPTIONS}
        lineAnnotations={lineAnnotations}
        renderGutterUtility={(getHoveredLine) => (
          <button
            type="button"
            className="diff-pierre-comment-btn"
            data-testid="diff-comment-add"
            title="评论这行"
            aria-label={`评论 ${file.path}`}
            onClick={() => {
              const hovered = getHoveredLine();
              if (!hovered) return;
              const prefix = hovered.side === "additions" ? "+" : "-";
              const text = resolveDiffLineText(
                patch,
                hovered.side,
                hovered.lineNumber,
              ).slice(0, 30);
              setCommentTarget({
                file,
                side: hovered.side,
                lineNumber: hovered.lineNumber,
                prefix,
                text,
              });
            }}
          >
            <i className="codicon codicon-add" />
          </button>
        )}
        renderAnnotation={() =>
          commentTarget?.file.path === file.path
            ? renderCommentBox(file)
            : null
        }
      />
    );
  };

  const renderFilePath = (file: WorkspaceDiffFile) => (
    <span
      className="diff-file-path"
      data-testid="diff-file-path"
      role="link"
      tabIndex={0}
      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      onClick={(e) => {
        e.stopPropagation();
        onOpenFile?.(resolveWorkspaceFilePath(file.path, workdir));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onOpenFile?.(resolveWorkspaceFilePath(file.path, workdir));
        }
      }}
    >
      {displayFilePath(file.path, workdir)}
    </span>
  );

  const renderFileStats = (file: WorkspaceDiffFile) => (
    <span className="diff-file-stats">
      <span className="diff-file-stats-add">+{file.additions}</span>
      <span className="diff-file-stats-del">-{file.deletions}</span>
    </span>
  );

  /** Shared per-file header row: status icon + clickable path + revert +
   *  +/- stats. The accordion chevron only renders in list view (onToggle
   *  given); the tree view's selected-file detail renders the same row. */
  const renderFileHeader = (
    file: WorkspaceDiffFile,
    opts: { expanded: boolean; onToggle?: () => void },
  ) => {
    const { expanded, onToggle } = opts;
    const headerContent = (
      <>
        {onToggle && (
          <i
            className={`codicon codicon-chevron-${expanded ? "down" : "right"}`}
          />
        )}
        <span
          className={`diff-file-status diff-file-status-${file.status}`}
          title={STATUS_LABEL[file.status]}
          aria-label={STATUS_LABEL[file.status]}
        >
          <i className={`codicon ${STATUS_ICON[file.status]}`} />
        </span>
        {renderFilePath(file)}
      </>
    );
    return (
      <div className="diff-file-header-row">
        {onToggle ? (
          <button
            className="diff-file-header"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {headerContent}
          </button>
        ) : (
          <div className="diff-file-header">{headerContent}</div>
        )}
        <button
          type="button"
          className="diff-file-revert preview-pane-button"
          data-testid="diff-revert-file"
          data-path={file.path}
          title="丢弃此文件的改动"
          aria-label={`丢弃 ${file.path} 的改动`}
          disabled={reverting}
          onClick={() => setPendingRevert({ scope: "file", path: file.path })}
        >
          <i className="codicon codicon-discard" />
        </button>
        {renderFileStats(file)}
      </div>
    );
  };

  const renderFile = (file: WorkspaceDiffFile) => {
    const isExpanded = expandedPath === file.path;
    return (
      <div
        className="diff-file"
        key={file.path}
        data-testid={`diff-file-${file.status}`}
      >
        {renderFileHeader(file, {
          expanded: isExpanded,
          onToggle: () => toggleFile(file.path),
        })}
        {isExpanded && (
          <div className="diff-file-body">
            {renderFileBody(file)}
            {file.truncated && (
              <div className="diff-line-ellipsis">差异过大，已截断…</div>
            )}
          </div>
        )}
      </div>
    );
  };

  /** Tree view's left side: the selected file's full diff (always expanded),
   *  keeping every list-view interaction (line comments, open file, revert). */
  const renderFileDetail = (file: WorkspaceDiffFile) => (
    <div
      className="diff-file"
      key={file.path}
      data-testid={`diff-file-${file.status}`}
    >
      {renderFileHeader(file, { expanded: true })}
      <div className="diff-file-body">
        {renderFileBody(file)}
        {file.truncated && (
          <div className="diff-line-ellipsis">差异过大，已截断…</div>
        )}
      </div>
    </div>
  );

  const renderDiffTreeNode = (
    node: DiffTreeNode,
    depth: number,
  ): React.ReactNode => {
    if (node.isDir) {
      const collapsed = collapsedDirs.has(node.path);
      return (
        <div key={node.path}>
          <button
            type="button"
            className="diff-tree-dir"
            data-testid={`diff-tree-dir-${node.path}`}
            aria-expanded={!collapsed}
            title={node.path}
            onClick={() => toggleDir(node.path)}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <i
              className={`codicon ${collapsed ? "codicon-chevron-right" : "codicon-chevron-down"} diff-tree-chevron`}
              aria-hidden
            />
            <i
              className="codicon codicon-folder diff-tree-folder-icon"
              aria-hidden
            />
            <span className="diff-tree-dir-name">{node.name}</span>
            <span className="diff-tree-dir-count">
              {countDiffTreeFiles(node)}
            </span>
          </button>
          {!collapsed &&
            (node.children ?? []).map((child) =>
              renderDiffTreeNode(child, depth + 1),
            )}
        </div>
      );
    }
    const file = node.file!;
    const isActive = node.path === activePath;
    return (
      <button
        type="button"
        key={node.path}
        className={`diff-tree-file${isActive ? " diff-tree-file--active" : ""}`}
        data-testid={`diff-tree-file-${file.status}`}
        data-path={node.path}
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        aria-current={isActive}
        onClick={() => {
          setTreeSelected(node.path);
          clearComment();
        }}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span
          className={`diff-tree-file-status diff-tree-file-status-${file.status}`}
          title={STATUS_LABEL[file.status]}
        >
          <i className={`codicon ${STATUS_ICON[file.status]}`} aria-hidden />
        </span>
        <span className="diff-tree-file-name">{node.name}</span>
        <span className="diff-tree-file-stats">
          <span className="diff-tree-file-stats-add">+{file.additions}</span>
          <span className="diff-tree-file-stats-del">-{file.deletions}</span>
        </span>
      </button>
    );
  };

  const renderTreeView = () => (
    <div className="diff-pane-tree-view" data-testid="diff-tree-view">
      <div className="diff-pane-tree-content">
        {activeFile ? renderFileDetail(activeFile) : null}
      </div>
      <nav className="diff-pane-tree-nav" data-testid="diff-tree-nav">
        <div className="diff-pane-tree-header">变更文件</div>
        <div className="diff-pane-tree-scroll">
          {diffTree.map((node) => renderDiffTreeNode(node, 0))}
        </div>
      </nav>
    </div>
  );

  const toolbarActionsDisabled =
    state.kind !== "ok" || state.files.length === 0 || reverting;
  const toolbarActionsTip =
    reverting
      ? "正在丢弃改动…"
      : state.kind === "loading"
        ? "加载中…"
        : state.kind === "not-a-repo"
          ? "非 git 仓库"
          : state.kind === "ok" && state.files.length === 0
            ? "无改动"
            : null;

  return (
    <aside
      ref={asideRef}
      className="preview-pane diff-pane"
      style={{ width }}
      data-testid="diff-pane"
    >
      <div className="preview-pane-drag-handle" onMouseDown={onDragStart} />
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
        <select
          className="diff-pane-mode-select"
          aria-label="变更范围"
          data-testid="diff-mode-select"
          value={mode}
          onChange={(e) => switchMode(e.target.value as "recent" | "unstaged")}
        >
          <option value="recent" data-testid="diff-mode-recent">
            最近一次修改
          </option>
          <option value="unstaged" data-testid="diff-mode-unstaged">
            未提交文件
          </option>
        </select>
        <div className="diff-pane-toolbar-actions">
        {state.kind === "ok" && state.files.length > 0 && (
          <div className="diff-view-mode-toggle" role="group" aria-label="视图切换">
            <button
              type="button"
              className="diff-view-mode-btn"
              data-testid="diff-view-list"
              aria-pressed={viewMode === "list"}
              title="列表视图"
              onClick={() => setViewMode("list")}
            >
              <i className="codicon codicon-list-flat" aria-hidden />
            </button>
            <button
              type="button"
              className="diff-view-mode-btn"
              data-testid="diff-view-tree"
              aria-pressed={viewMode === "tree"}
              title="树视图"
              onClick={() => setViewMode("tree")}
            >
              <i className="codicon codicon-list-tree" aria-hidden />
            </button>
          </div>
        )}
        {mode === "unstaged" && (
          <>
            <Tooltip
              text={toolbarActionsTip ?? "提交改动"}
              position="bottom"
            >
              <button
                type="button"
                className="preview-pane-button"
                aria-label="提交改动"
                data-testid="diff-commit"
                disabled={toolbarActionsDisabled}
                onClick={() => onSendMessage?.("git commit")}
              >
                <i className="codicon codicon-git-commit" />
              </button>
            </Tooltip>
            <Tooltip
              text={toolbarActionsTip ?? "丢弃全部改动"}
              position="bottom"
            >
              <button
                type="button"
                className="preview-pane-button"
                aria-label="丢弃全部改动"
                data-testid="diff-revert-all"
                disabled={toolbarActionsDisabled}
                onClick={() => setPendingRevert({ scope: "all" })}
              >
                <i className="codicon codicon-discard" />
              </button>
            </Tooltip>
          </>
        )}
        <button
          className="preview-pane-button"
          title="刷新"
          data-testid="diff-refresh"
          onClick={() => (mode === "recent" ? switchMode("recent") : refresh())}
        >
          <i
            className={`codicon codicon-refresh${refreshing ? " codicon-modifier-spin" : ""}`}
          />
        </button>
        </div>
      </div>
        <div className="diff-pane-body">
          {revertError && (
            <div className="diff-revert-error" data-testid="diff-revert-error">
              <span>{revertError}</span>
              <button
                type="button"
                className="preview-pane-button"
                aria-label="关闭"
                onClick={() => setRevertError(null)}
              >
                <i className="codicon codicon-close" />
              </button>
            </div>
          )}
          {state.kind === "loading" && (
            <div className="desktop-panel-placeholder">加载中…</div>
          )}
          {state.kind === "not-a-repo" && (
            <div className="desktop-panel-placeholder">非 git 仓库</div>
          )}
          {state.kind === "ok" && mode === "recent" && isStreaming && (
            <div className="desktop-panel-placeholder">响应中…</div>
          )}
          {state.kind === "ok" && state.files.length === 0 && (
            <div className="desktop-panel-placeholder">无改动</div>
          )}
          {state.kind === "ok" &&
            !(mode === "recent" && isStreaming) &&
            (viewMode === "tree" ? renderTreeView() : state.files.map(renderFile))}
        </div>
      </div>
      {pendingRevert && (
        <ConfirmDialog
          title={
            pendingRevert.scope === "all"
              ? "丢弃全部改动？"
              : `丢弃「${pendingRevert.path}」的改动？`
          }
          description={
            pendingRevert.scope === "all"
              ? "将恢复已跟踪文件到 HEAD，并删除未跟踪文件。此操作不可撤销。"
              : "将恢复该已跟踪文件到 HEAD；若为未跟踪则删除该文件。此操作不可撤销。"
          }
          confirmText="丢弃"
          onConfirm={confirmRevert}
          onCancel={() => setPendingRevert(null)}
        />
      )}
    </aside>
  );
};

export default DiffPane;
