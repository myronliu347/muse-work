import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@radix-ui/themes";
import { PatchDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation, FileDiffLoadedFiles, FileDiffMetadata } from "@pierre/diffs";
import type { VsCodeApi, DiffViewState } from "../../types";
import {
  resolveDiffLineText,
  toPierrePatch,
} from "../../utils/toPierrePatch";
import {
  resolveWorkspaceFilePath,
  displayFilePath,
} from "../../utils/filePathDisplay";
import { buildPathTree, pathSegments } from "../../utils/pathTree";
import {
  clampFileTreeWidth,
  FILE_TREE_WIDTH_DEFAULT,
} from "../../stores/panelGroupStore";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import { Tooltip } from "../shared/Tooltip";
import { PathTree } from "./PathTree";
import { getOverlayHost } from "../../utils/bodyPortal";
import { localizeDiffHost } from "../../utils/diffSeparatorLabel";
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
  /** Pre-edit snapshot, present for 最近一次修改. */
  snapshotPath?: string;
}

type DiffMode = "recent" | "unstaged" | "patch" | "branch";

type DiffState =
  | { kind: "loading" }
  | { kind: "not-a-repo" }
  | { kind: "error"; message: string }
  | { kind: "ok"; files: WorkspaceDiffFile[] };

function DiffSelect({
  label,
  testId,
  value,
  disabled,
  placeholder,
  className,
  contentClassName,
  options,
  onChange,
}: {
  label: string;
  testId: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  options: { value: string; label: React.ReactNode; testId?: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger
        variant="ghost"
        color="gray"
        size="1"
        aria-label={label}
        data-testid={testId}
        placeholder={placeholder}
        className={className}
      />
      <Select.Content
        position="popper"
        side="bottom"
        align="start"
        sideOffset={4}
        container={getOverlayHost()}
        className={["diff-pane-select-content", contentClassName]
          .filter(Boolean)
          .join(" ")}
      >
        {options.map((option) => (
          <Select.Item
            key={option.value}
            value={option.value}
            data-testid={option.testId}
          >
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

function stripPatchPrefix(name: string | undefined): string {
  if (!name || name === "/dev/null") return "";
  if (name.startsWith("a/") || name.startsWith("b/")) return name.slice(2);
  return name;
}

const DIFF_MODE_OPTIONS: { value: DiffMode; label: string; testId: string }[] = [
  { value: "recent", label: "最近一次修改", testId: "diff-mode-recent" },
  { value: "unstaged", label: "未提交", testId: "diff-mode-unstaged" },
  { value: "patch", label: "某次提交的改动", testId: "diff-mode-patch" },
  { value: "branch", label: "当前分支所有改动", testId: "diff-mode-branch" },
];

interface GitCommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

function CommitOptionLabel({ commit }: { commit: GitCommitSummary }) {
  const day = commit.date.slice(0, 10);
  const meta = [commit.author, day].filter(Boolean).join(" · ");
  return (
    <span className="diff-commit-option">
      <span className="diff-commit-hash">{commit.shortHash}</span>
      <span className="diff-commit-subject">{commit.subject}</span>
      {meta ? <span className="diff-commit-meta">{meta}</span> : null}
    </span>
  );
}

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
  // One click on a collapsed gap reveals that gap, including large ones.
  expansionLineCount: 100000,
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
  /** Branch this session's worktree was cut from, when the reflog is gone. */
  baseBranch?: string;
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
  baseBranch,
}) => {
  const [state, setState] = useState<DiffState>({ kind: "loading" });
  // recent: last assistant turn. unstaged: uncommitted worktree vs HEAD.
  // patch: one commit's own change. branch: worktree vs the branch fork point.
  const [mode, setMode] = useState<DiffMode>(
    diffView?.mode === "unstaged" ? "unstaged" : "recent",
  );
  const [commits, setCommits] = useState<GitCommitSummary[]>([]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [commitListReady, setCommitListReady] = useState(false);
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
  /** Right-side change-tree column width (tree view only); session-local. */
  const [treeNavWidth, setTreeNavWidth] = useState(FILE_TREE_WIDTH_DEFAULT);
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
  const requestSeq = useRef(0);
  const latestRequestRef = useRef<string | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const selectedHashRef = useRef(selectedHash);
  selectedHashRef.current = selectedHash;
  // The pane is shared across sessions. Remember each session's range so
  // switching away and back does not fall back to 最近一次修改.
  const sessionViewRef = useRef(
    new Map<string, { mode: DiffMode; hash: string | null }>(),
  );
  const filesRef = useRef<WorkspaceDiffFile[]>([]);
  const baseBranchRef = useRef(baseBranch);
  baseBranchRef.current = baseBranch;
  const workdirRef = useRef(workdir);
  workdirRef.current = workdir;
  const sideLoadsRef = useRef(
    new Map<
      string,
      (result: { oldContent?: string; newContent?: string; error?: string }) => void
    >(),
  );
  const sideSeqRef = useRef(0);

  const nextRequestId = useCallback(() => {
    const requestId = String(++requestSeq.current);
    latestRequestRef.current = requestId;
    return requestId;
  }, []);

  const refresh = useCallback(
    (hard = false) => {
      if (hard) setState({ kind: "loading" });
      setRefreshing(true);
      // Refresh rewrites the hunks, so any open comment box + draft is stale.
      clearComment();
      vscode.postMessage({
        command: "desktopGetWorkspaceDiff",
        requestId: nextRequestId(),
        ...(paneId ? { paneId } : {}),
        ...(workdir ? { workdir } : {}),
      });
    },
    [vscode, paneId, workdir, clearComment, nextRequestId],
  );

  const requestBranchDiff = useCallback(
    (hard = false) => {
      if (hard) setState({ kind: "loading" });
      setRefreshing(true);
      clearComment();
      vscode.postMessage({
        command: "desktopGetBranchDiff",
        requestId: nextRequestId(),
        ...(paneId ? { paneId } : {}),
        ...(workdir ? { workdir } : {}),
        ...(baseBranch ? { baseBranch } : {}),
      });
    },
    [vscode, paneId, workdir, baseBranch, clearComment, nextRequestId],
  );

  const requestCommitDiff = useCallback(
    (rev: string, hard = false) => {
      if (hard) setState({ kind: "loading" });
      setRefreshing(true);
      clearComment();
      vscode.postMessage({
        command: "desktopGetCommitDiff",
        requestId: nextRequestId(),
        rev,
        ...(paneId ? { paneId } : {}),
        ...(workdir ? { workdir } : {}),
      });
    },
    [vscode, paneId, workdir, clearComment, nextRequestId],
  );

  const loadCommits = useCallback(() => {
    setCommitListReady(false);
    setState({ kind: "loading" });
    setRefreshing(true);
    clearComment();
    vscode.postMessage({
      command: "desktopListCommits",
      ...(paneId ? { paneId } : {}),
      ...(workdir ? { workdir } : {}),
    });
  }, [vscode, paneId, workdir, clearComment]);

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
      if (msg?.command === "desktopCommits") {
        if (modeRef.current !== "patch") return;
        setRefreshing(false);
        setCommitListReady(true);
        if (msg.result?.kind !== "ok") {
          setCommits([]);
          setSelectedHash(null);
          selectedHashRef.current = null;
          setState({ kind: "not-a-repo" });
          return;
        }
        const list: GitCommitSummary[] = Array.isArray(msg.result.commits)
          ? msg.result.commits
          : [];
        setCommits(list);
        const prevHash = selectedHashRef.current;
        const hash =
          prevHash && list.some((c) => c.hash === prevHash)
            ? prevHash
            : (list[0]?.hash ?? null);
        setSelectedHash(hash);
        selectedHashRef.current = hash;
        if (hash) requestCommitDiff(hash, true);
        else setState({ kind: "ok", files: [] });
        return;
      }
      if (msg?.command === "desktopDiffFileSides") {
        const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
        const pending = sideLoadsRef.current.get(requestId);
        if (pending) {
          sideLoadsRef.current.delete(requestId);
          pending(msg);
        }
        return;
      }
      if (msg?.command !== "desktopWorkspaceDiff") return;
      if (
        typeof msg.requestId === "string" &&
        msg.requestId !== latestRequestRef.current
      ) {
        return;
      }
      const result = msg.result;
      setRefreshing(false);
      setState(
        result?.kind === "ok"
          ? { kind: "ok", files: result.files }
          : result?.kind === "error"
            ? { kind: "error", message: result.message || "无法读取差异" }
            : { kind: "not-a-repo" },
      );
      // Default the first file to expanded on the first diff; keep the
      // currently expanded file across refreshes once the user has chosen one.
      setExpandedPath((prev) => prev ?? result?.files?.[0]?.path ?? null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [paneId, refresh, requestCommitDiff]);

  const requestDiffSides = useCallback(
    (input: {
      path: string;
      oldPath?: string;
      oldRev: string;
      newRev?: string;
      snapshotPath?: string;
    }) =>
      new Promise<{ oldContent: string; newContent: string }>((resolve, reject) => {
        const requestId = `sides-${++sideSeqRef.current}`;
        const timer = window.setTimeout(() => {
          sideLoadsRef.current.delete(requestId);
          reject(new Error("读取文件超时"));
        }, 20000);
        sideLoadsRef.current.set(requestId, (result) => {
          window.clearTimeout(timer);
          if (result.error || result.oldContent === undefined || result.newContent === undefined) {
            reject(new Error(result.error || "无法读取文件"));
            return;
          }
          resolve({ oldContent: result.oldContent, newContent: result.newContent });
        });
        vscode.postMessage({
          command: "desktopReadDiffSides",
          requestId,
          ...(paneId ? { paneId } : {}),
          ...(workdirRef.current ? { workdir: workdirRef.current } : {}),
          path: input.path,
          ...(input.oldPath ? { oldPath: input.oldPath } : {}),
          ...(input.snapshotPath ? { snapshotPath: input.snapshotPath } : {}),
          oldRev: input.oldRev,
          ...(input.newRev ? { newRev: input.newRev } : {}),
        });
      }),
    [paneId, vscode],
  );

  const loadDiffFiles = useCallback(
    async (meta: FileDiffMetadata): Promise<FileDiffLoadedFiles> => {
      const named = stripPatchPrefix(meta.name);
      const file = filesRef.current.find(
        (item) => item.path === named || item.path === meta.name,
      );
      const rel = file?.path ?? named;
      const oldPath = file?.oldPath ?? stripPatchPrefix(meta.prevName);
      const current = modeRef.current;
      if (current === "recent") {
        if (!file?.snapshotPath) throw new Error("无法展开");
        const sides = await requestDiffSides({
          path: rel,
          oldRev: "HEAD",
          snapshotPath: file.snapshotPath,
        });
        return {
          oldFile: { name: rel, contents: sides.oldContent },
          newFile: { name: rel, contents: sides.newContent },
        };
      }
      let oldRev = "HEAD";
      let newRev: string | undefined;
      if (current === "branch") {
        const base = baseBranchRef.current?.trim();
        if (!base) throw new Error("没有对比分支");
        oldRev = base;
      } else if (current === "patch") {
        const hash = selectedHashRef.current;
        if (!hash) throw new Error("没有选中提交");
        oldRev = `${hash}^`;
        newRev = hash;
      }
      const sides = await requestDiffSides({
        path: rel,
        oldPath: oldPath && oldPath !== rel ? oldPath : undefined,
        oldRev,
        newRev,
      });
      return {
        oldFile: { name: oldPath ?? rel, contents: sides.oldContent },
        newFile: { name: rel, contents: sides.newContent },
      };
    },
    [requestDiffSides],
  );

  const patchDiffOptions = useMemo(
    () => ({
      ...PATCH_DIFF_OPTIONS,
      onPostRender: (node: HTMLElement) => localizeDiffHost(node),
      loadDiffFiles,
    }),
    [loadDiffFiles],
  );

  // Refresh triggers: first mount (prev.visible starts false), re-show,
  // session/workdir change while visible, generation end while visible.
  // Only the unstaged (workspace git) mode issues a desktop request — recent
  // mode renders the transcript-derived recentFiles prop. Switching sessions
  // restores that session's last range; a workdir change inside one session
  // drops back to 最近一次修改 because the previous branch base no longer applies.
  const prevRef = useRef({ visible: false, sessionId, workdir, isStreaming, baseBranch });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { visible, sessionId, workdir, isStreaming, baseBranch };
    const becameVisible = visible && !prev.visible;
    const becameHidden = !visible && prev.visible;
    const sessionChanged = prev.sessionId !== sessionId;
    const workdirChanged = prev.workdir !== workdir;
    const contextChanged = visible && (sessionChanged || workdirChanged);
    const generationEnded = visible && prev.isStreaming && !isStreaming;
    const baseChanged = prev.baseBranch !== baseBranch;
    if (contextChanged) {
      if (sessionChanged && prev.sessionId) {
        sessionViewRef.current.set(prev.sessionId, {
          mode: modeRef.current,
          hash: selectedHashRef.current,
        });
      }
      if (!sessionChanged && workdirChanged && sessionId) {
        sessionViewRef.current.delete(sessionId);
      }
      const saved =
        sessionChanged && sessionId
          ? sessionViewRef.current.get(sessionId)
          : undefined;
      const nextMode = saved?.mode ?? "recent";
      const nextHash = saved?.hash ?? null;
      setMode(nextMode);
      modeRef.current = nextMode;
      setSelectedHash(nextHash);
      selectedHashRef.current = nextHash;
      setCommits([]);
      setCommitListReady(false);
      if (nextMode === "unstaged") {
        refresh(true);
      } else if (nextMode === "branch") {
        requestBranchDiff(true);
      } else if (nextMode === "patch") {
        loadCommits();
      } else {
        const files = recentFiles ?? [];
        setState({ kind: "ok", files });
        if (files.length > 0) setExpandedPath(files[0].path);
      }
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
      } else if (mode === "branch") {
        requestBranchDiff();
      } else if (mode === "patch") {
        loadCommits();
      } else {
        const files = recentFiles ?? [];
        setState({ kind: "ok", files });
        if (files.length > 0) {
          setExpandedPath((prev) => prev ?? files[0].path);
        }
      }
    } else if (mode === "unstaged" && generationEnded) {
      refresh();
    } else if (mode === "branch" && (generationEnded || baseChanged)) {
      requestBranchDiff();
    }
  }, [
    visible,
    sessionId,
    workdir,
    isStreaming,
    refresh,
    mode,
    recentFiles,
    requestBranchDiff,
    loadCommits,
    baseBranch,
  ]);

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
      modeRef.current = "unstaged";
      refresh(true);
    } else {
      setMode("recent");
      modeRef.current = "recent";
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

  const switchMode = (next: DiffMode) => {
    if (next === mode) return;
    setMode(next);
    modeRef.current = next;
    if (next === "recent") {
      const files = recentFiles ?? [];
      setState({ kind: "ok", files });
      if (files.length > 0) setExpandedPath(files[0].path);
    } else if (next === "branch") {
      requestBranchDiff(true);
    } else if (next === "patch") {
      loadCommits();
    } else {
      refresh(true);
    }
  };

  const onCommitChange = (hash: string) => {
    setSelectedHash(hash);
    selectedHashRef.current = hash;
    requestCommitDiff(hash, true);
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
  const diffTree = useMemo(() => {
    if (state.kind !== "ok") return [];
    return buildPathTree(
      state.files.map((file) => ({
        segments: pathSegments(displayFilePath(file.path, workdir)),
        path: file.path,
        data: file,
      })),
    );
  }, [state, workdir]);
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

  const onTreeNavDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.style.background = "var(--accent-9)";
    document.body.classList.add("is-panel-resizing");
    const startX = e.clientX;
    const startW = treeNavWidth;
    const onMove = (ev: MouseEvent) => {
      // Nav is on the right; dragging left increases width (same as FileTree).
      setTreeNavWidth(clampFileTreeWidth(startW + (startX - ev.clientX)));
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

  filesRef.current = state.kind === "ok" ? state.files : [];

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
        options={patchDiffOptions}
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
        {mode === "branch" || mode === "patch" ? null : (
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
        )}
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

  const renderTreeView = () => (
    <div className="diff-pane-tree-view" data-testid="diff-tree-view">
      <div className="diff-pane-tree-content">
        {activeFile ? renderFileDetail(activeFile) : null}
      </div>
      <nav
        className="diff-pane-tree-nav"
        data-testid="diff-tree-nav"
        style={{ width: treeNavWidth }}
      >
        <div
          className="diff-pane-tree-drag-handle"
          data-testid="diff-tree-resize"
          onMouseDown={onTreeNavDragStart}
        />
        <div className="diff-pane-tree-header">变更文件</div>
        <div className="diff-pane-tree-scroll">
          <PathTree
            nodes={diffTree}
            collapsedDirs={collapsedDirs}
            onToggleDir={toggleDir}
            selectedPath={activePath}
            onFileClick={(node) => {
              setTreeSelected(node.path);
              clearComment();
            }}
            getDirTestId={(node) => `diff-tree-dir-${node.path}`}
            getFileTestId={(node) => `diff-tree-file-${node.data.status}`}
            getFileClassName={(_node, selected) =>
              selected ? "diff-tree-file--active" : undefined
            }
            getFileDataAttrs={(node) => ({
              title: node.data.oldPath
                ? `${node.data.oldPath} → ${node.data.path}`
                : node.data.path,
            })}
            renderDirTrailing={(node) => (
              <span className="path-tree-trailing">{node.fileCount}</span>
            )}
            renderFileTrailing={(node) => {
              const file = node.data;
              return (
                <span className="path-tree-trailing">
                  <span
                    className={`diff-tree-file-status diff-tree-file-status-${file.status}`}
                    title={STATUS_LABEL[file.status]}
                  >
                    <i
                      className={`codicon ${STATUS_ICON[file.status]}`}
                      aria-hidden
                    />
                  </span>
                  <span className="diff-tree-file-stats">
                    <span className="diff-tree-file-stats-add">
                      +{file.additions}
                    </span>
                    <span className="diff-tree-file-stats-del">
                      -{file.deletions}
                    </span>
                  </span>
                </span>
              );
            }}
          />
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
            : state.kind === "error"
              ? state.message
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
        <DiffSelect
          label="变更范围"
          testId="diff-mode-select"
          className="diff-pane-mode-select"
          value={mode}
          options={DIFF_MODE_OPTIONS}
          onChange={(value) => switchMode(value as DiffMode)}
        />
        {mode === "patch" && (
          <DiffSelect
            label="提交"
            testId="diff-commit-select"
            className="diff-pane-mode-select diff-pane-commit-select"
            contentClassName="diff-pane-commit-content"
            value={selectedHash ?? ""}
            disabled={commits.length === 0}
            placeholder={commitListReady ? "没有提交" : "加载中"}
            options={commits.map((commit) => ({
              value: commit.hash,
              label: <CommitOptionLabel commit={commit} />,
              testId: `diff-commit-option-${commit.hash}`,
            }))}
            onChange={onCommitChange}
          />
        )}
        <div className="diff-pane-toolbar-actions">
        {state.kind === "ok" && state.files.length > 0 && (
          <button
            type="button"
            className="preview-pane-button"
            data-testid="diff-view-toggle"
            aria-pressed={viewMode === "tree"}
            title={viewMode === "tree" ? "列表视图" : "树视图"}
            onClick={() => setViewMode(viewMode === "tree" ? "list" : "tree")}
          >
            <i
              className={`codicon ${viewMode === "tree" ? "codicon-list-flat" : "codicon-list-tree"}`}
              aria-hidden
            />
          </button>
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
          onClick={() => {
            if (mode === "branch") requestBranchDiff();
            else if (mode === "patch") loadCommits();
            else if (mode === "recent") switchMode("recent");
            else refresh();
          }}
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
          {state.kind === "error" && (
            <div className="desktop-panel-placeholder">{state.message}</div>
          )}
          {state.kind === "ok" && mode === "recent" && isStreaming && (
            <div className="desktop-panel-placeholder">响应中…</div>
          )}
          {state.kind === "ok" &&
            mode === "patch" &&
            commitListReady &&
            commits.length === 0 && (
              <div className="desktop-panel-placeholder">没有提交</div>
            )}
          {state.kind === "ok" &&
            state.files.length === 0 &&
            !(mode === "patch" && commitListReady && commits.length === 0) && (
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
