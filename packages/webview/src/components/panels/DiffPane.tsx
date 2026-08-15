import React, { useCallback, useEffect, useRef, useState } from "react";
import { PatchDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation } from "@pierre/diffs";
import type { VsCodeApi } from "../../types";
import {
  resolveDiffLineText,
  toPierrePatch,
} from "../../utils/toPierrePatch";
import { resolveWorkspaceFilePath } from "../../utils/filePathDisplay";
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
  /** Opens a workspace file in the file panel (desktop) or IDE. */
  onOpenFile?: (path: string) => void;
  /** Sends text as a real chat message (not append-to-input). */
  onSendMessage?: (text: string) => void;
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
}) => {
  const [state, setState] = useState<DiffState>({ kind: "loading" });
  // Mutual-exclusion accordion: at most one file is expanded at a time, so the
  // DOM holds every file header but only one file's hunks (bounded rendering
  // for large workspace diffs — data is still loaded once for all files).
  // The expanded path survives refreshes; defaults to the first file.
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
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
  const prevRef = useRef({ visible: false, sessionId, workdir, isStreaming });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { visible, sessionId, workdir, isStreaming };
    const becameVisible = visible && !prev.visible;
    const contextChanged =
      visible && (prev.sessionId !== sessionId || prev.workdir !== workdir);
    const generationEnded = visible && prev.isStreaming && !isStreaming;
    if (contextChanged) refresh(true);
    else if (becameVisible || generationEnded) refresh();
  }, [visible, sessionId, workdir, isStreaming, refresh]);

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

  const renderFile = (file: WorkspaceDiffFile) => {
    const isExpanded = expandedPath === file.path;
    return (
      <div
        className="diff-file"
        key={file.path}
        data-testid={`diff-file-${file.status}`}
      >
        <div className="diff-file-header-row">
          <button
            className="diff-file-header"
            aria-expanded={isExpanded}
            onClick={() => toggleFile(file.path)}
          >
            <i
              className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
            />
            <span
              className={`diff-file-status diff-file-status-${file.status}`}
              title={STATUS_LABEL[file.status]}
              aria-label={STATUS_LABEL[file.status]}
            >
              <i className={`codicon ${STATUS_ICON[file.status]}`} />
            </span>
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
              {file.path}
            </span>
          </button>
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
          <span className="diff-file-stats">
            <span className="diff-file-stats-add">+{file.additions}</span>
            <span className="diff-file-stats-del">-{file.deletions}</span>
          </span>
        </div>
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
          <span className="preview-pane-url">变更</span>
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
          <button
            className="preview-pane-button"
            title="刷新"
            data-testid="diff-refresh"
            onClick={() => refresh()}
          >
            <i
              className={`codicon codicon-refresh${refreshing ? " codicon-modifier-spin" : ""}`}
            />
          </button>
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
          {state.kind === "ok" && state.files.length === 0 && (
            <div className="desktop-panel-placeholder">无改动</div>
          )}
          {state.kind === "ok" && state.files.map(renderFile)}
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
