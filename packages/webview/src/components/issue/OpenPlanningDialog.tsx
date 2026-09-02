import React, { useEffect, useRef, useState } from "react";
import type { MuseApiClient } from "../../muse/apiClient";
import "../../styles/ConfirmDialog.css";
import "../../styles/NewIssueDialog.css";
import "../../styles/OpenPlanningDialog.css";

export const PICK_DIRECTORY_TIMEOUT_MS = 15_000;

export type PostToHost = (msg: Record<string, unknown>) => void;

export type WorktreeCreated = {
  name: string;
  path: string;
  branch: string;
  baseBranch: string;
  repoRoot: string;
};

export type GitBranchesResult = {
  branches: string[];
  current: string | null;
};

export interface OpenPlanningDialogProps {
  issueId: string;
  api: MuseApiClient;
  postToHost: PostToHost;
  onOpened: (result: { sessionId: string; workdir: string }) => void;
  onCancel: () => void;
  /** Injectable for tests; default uses `desktopPickDirectory` (15s timeout). */
  pickDirectory?: () => Promise<string | null>;
  /** Injectable for tests; default uses `desktopListGitBranches`. */
  listBranches?: (workdir: string) => Promise<GitBranchesResult | null>;
}

const NOT_GIT_HINT = "非 git 目录，开关无效，将直接在该目录执行";
const WORKTREE_TIMEOUT_ERROR = "创建 worktree 超时";

type AgentMode = "single" | "split";

function isNotGitError(error: string): boolean {
  return /not a git repository|not a git repo|不是 git|非 git/i.test(error);
}

/** List git branches via Electron; timeout / non-git → null. */
export function listBranchesViaHost(
  postToHost: PostToHost,
  workdir: string,
): Promise<GitBranchesResult | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, PICK_DIRECTORY_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as {
        command?: string;
        workdir?: string;
        result?: GitBranchesResult | null;
      };
      if (msg?.command !== "desktopGitBranches") return;
      if (msg.workdir && msg.workdir !== workdir) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(msg.result ?? null);
    };
    window.addEventListener("message", onMessage);
    postToHost({ command: "desktopListGitBranches", workdir });
  });
}

/** Pick a directory via Electron; canceled/timeout → null. */
export function pickDirectoryViaHost(
  postToHost: PostToHost,
): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, PICK_DIRECTORY_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { command?: string; path?: string };
      if (msg?.command !== "desktopPickDirectoryResult") return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(typeof msg.path === "string" && msg.path ? msg.path : null);
    };
    window.addEventListener("message", onMessage);
    postToHost({ command: "desktopPickDirectory" });
  });
}

function createWorktreeViaHost(
  postToHost: PostToHost,
  opts: { workdir: string; baseBranch?: string },
  signal?: AbortSignal,
): Promise<
  | { ok: true; worktree: WorktreeCreated }
  | { ok: false; error: string; aborted?: boolean }
> {
  const requestId = `wt_${Math.random().toString(36).slice(2, 10)}`;
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, error: "aborted", aborted: true });
      return;
    }

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
    };

    const finish = (
      result:
        | { ok: true; worktree: WorktreeCreated }
        | { ok: false; error: string; aborted?: boolean },
    ) => {
      cleanup();
      resolve(result);
    };

    const onAbort = () => {
      finish({ ok: false, error: "aborted", aborted: true });
    };

    const timer = window.setTimeout(() => {
      finish({ ok: false, error: WORKTREE_TIMEOUT_ERROR });
    }, PICK_DIRECTORY_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      const msg = event.data as {
        command?: string;
        requestId?: string;
        error?: string;
        name?: string;
        path?: string;
        branch?: string;
        baseBranch?: string;
        repoRoot?: string;
      };
      if (msg?.command !== "desktopWorktreeCreated") return;
      if (msg.requestId !== requestId) return;
      if (typeof msg.error === "string" && msg.error) {
        finish({ ok: false, error: msg.error });
        return;
      }
      if (
        typeof msg.name === "string" &&
        typeof msg.path === "string" &&
        typeof msg.branch === "string" &&
        typeof msg.repoRoot === "string"
      ) {
        finish({
          ok: true,
          worktree: {
            name: msg.name,
            path: msg.path,
            branch: msg.branch,
            baseBranch:
              typeof msg.baseBranch === "string" ? msg.baseBranch : "HEAD",
            repoRoot: msg.repoRoot,
          },
        });
        return;
      }
      finish({ ok: false, error: "创建 worktree 返回不完整" });
    };

    signal?.addEventListener("abort", onAbort);
    window.addEventListener("message", onMessage);
    postToHost({
      command: "desktopCreateWorktree",
      workdir: opts.workdir,
      baseBranch: opts.baseBranch,
      requestId,
    });
  });
}

/**
 * Modal to bind an Issue's planning session: pick workdir, optional worktree.
 * Git worktree is created by the desktop host, never by the server.
 */
export const OpenPlanningDialog: React.FC<OpenPlanningDialogProps> = ({
  issueId,
  api,
  postToHost,
  onOpened,
  onCancel,
  pickDirectory,
  listBranches,
}) => {
  const [workdir, setWorkdir] = useState("");
  const [agentMode, setAgentMode] = useState<AgentMode>("single");
  const [worktreeEnabled, setWorktreeEnabled] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [gitBranches, setGitBranches] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    cancelledRef.current = false;
    const ac = new AbortController();
    abortRef.current = ac;
    return () => {
      cancelledRef.current = true;
      ac.abort();
      abortRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!submitting) onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, submitting]);

  const handlePick = async () => {
    setError(null);
    const pick = pickDirectory ?? (() => pickDirectoryViaHost(postToHost));
    const path = await pick();
    if (cancelledRef.current) return;
    if (path) {
      setWorkdir(path);
      setBaseBranch("");
      setGitBranches([]);
    }
  };

  useEffect(() => {
    const path = workdir.trim();
    if (!path) {
      setGitBranches([]);
      return;
    }
    let cancelled = false;
    const load = listBranches ?? ((wd: string) => listBranchesViaHost(postToHost, wd));
    void load(path).then((result) => {
      if (cancelled) return;
      const branches = result?.branches ?? [];
      setGitBranches(branches);
      const preferred = result?.current || branches[0] || "";
      if (preferred) {
        setBaseBranch((prev) => prev || preferred);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [workdir, listBranches, postToHost]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const path = workdir.trim();
    if (!path || submitting) return;
    setSubmitting(true);
    setError(null);
    const branch = baseBranch.trim() || undefined;
    let sessionWorkdir = path;
    let enabled = worktreeEnabled;
    let worktreeName: string | undefined;
    let worktreeBranch: string | undefined;
    let worktreeRepoRoot: string | undefined;
    let resolvedBase = branch;

    if (worktreeEnabled) {
      const created = await createWorktreeViaHost(
        postToHost,
        {
          workdir: path,
          baseBranch: branch,
        },
        abortRef.current?.signal,
      );
      if (cancelledRef.current || created.aborted) return;
      if (!created.ok) {
        if (isNotGitError(created.error)) {
          enabled = false;
          setError(NOT_GIT_HINT);
        } else {
          setError(`创建 worktree 失败：${created.error}`);
          setSubmitting(false);
          return;
        }
      } else {
        sessionWorkdir = created.worktree.path;
        worktreeName = created.worktree.name;
        worktreeBranch = created.worktree.branch;
        worktreeRepoRoot = created.worktree.repoRoot;
        resolvedBase = created.worktree.baseBranch;
      }
    }

    try {
      const result = await api.openPlanningSession(issueId, {
        workdir: sessionWorkdir,
        worktreeEnabled: enabled,
        agentMode,
        ...(resolvedBase ? { baseBranch: resolvedBase } : {}),
        ...(worktreeName ? { worktreeName } : {}),
        ...(worktreeBranch ? { worktreeBranch } : {}),
        ...(worktreeRepoRoot ? { worktreeRepoRoot } : {}),
      });
      if (cancelledRef.current) return;
      onOpened(result);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="confirm-dialog-overlay"
      data-testid="open-planning-dialog-overlay"
    >
      <form
        className="confirm-dialog new-issue-dialog open-planning-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="打开规划会话"
        onSubmit={handleSubmit}
      >
        <div className="new-issue-dialog-head">
          <div className="confirm-dialog-title">打开规划会话</div>
          <p className="new-issue-dialog-lead">
            {agentMode === "single"
              ? "选定工作目录后在本会话规划并改代码"
              : "选定工作目录后再开始规划；改代码会派发到执行会话"}
          </p>
        </div>
        <fieldset className="open-planning-mode" data-testid="open-planning-mode">
          <legend className="new-issue-label">工作模式</legend>
          <label className="open-planning-mode-option">
            <input
              type="radio"
              name="open-planning-agent-mode"
              value="single"
              checked={agentMode === "single"}
              onChange={() => setAgentMode("single")}
              data-testid="open-planning-mode-single"
              disabled={submitting}
            />
            <span>
              <span className="open-planning-switch-title">单 agent</span>
              <span className="open-planning-hint">
                用默认会话 agent，规划与改代码都在本会话
              </span>
            </span>
          </label>
          <label className="open-planning-mode-option">
            <input
              type="radio"
              name="open-planning-agent-mode"
              value="split"
              checked={agentMode === "split"}
              onChange={() => setAgentMode("split")}
              data-testid="open-planning-mode-split"
              disabled={submitting}
            />
            <span>
              <span className="open-planning-switch-title">规划 + 执行</span>
              <span className="open-planning-hint">
                规划会话只出方案，改代码派到执行会话
              </span>
            </span>
          </label>
        </fieldset>
        <div className="new-issue-field">
          <span className="new-issue-label">工作目录</span>
          <button
            type="button"
            className={`open-planning-pick${workdir ? " has-path" : ""}`}
            data-testid="open-planning-pick-directory"
            onClick={() => void handlePick()}
            disabled={submitting}
          >
            <span className="codicon codicon-folder" aria-hidden="true" />
            <span
              className="open-planning-workdir"
              data-testid="open-planning-workdir"
              title={workdir || undefined}
            >
              {workdir || "选择项目目录…"}
            </span>
          </button>
        </div>
        <label className="open-planning-switch-row">
          <span className="open-planning-switch-copy">
            <span className="open-planning-switch-title">独立 worktree</span>
            <span className="open-planning-hint">
              非 git 目录时开关无效，将直接在该目录执行
            </span>
          </span>
          <span className="open-planning-switch">
            <input
              type="checkbox"
              checked={worktreeEnabled}
              onChange={(e) => setWorktreeEnabled(e.target.checked)}
              data-testid="open-planning-worktree"
              disabled={submitting}
            />
            <span className="open-planning-switch-track" aria-hidden="true" />
          </span>
        </label>
        {worktreeEnabled && gitBranches.length > 0 ? (
          <label className="new-issue-field">
            <span className="new-issue-label">基础分支</span>
            <select
              className="new-issue-input open-planning-branch-select"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              data-testid="open-planning-base-branch"
              disabled={submitting}
            >
              {gitBranches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {error ? (
          <div className="new-issue-error" data-testid="open-planning-error">
            {error}
          </div>
        ) : null}
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-cancel"
            data-testid="open-planning-cancel"
            onClick={onCancel}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="submit"
            className="confirm-dialog-btn confirm-dialog-btn-confirm"
            data-testid="open-planning-submit"
            disabled={submitting || !workdir.trim()}
          >
            打开
          </button>
        </div>
      </form>
    </div>
  );
};

export default OpenPlanningDialog;
