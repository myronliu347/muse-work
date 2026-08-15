import React from "react";
import "../../styles/DesktopApp.css";

export interface DesktopGitContextProps {
  /** Current branch (worktree branch or repo HEAD). */
  branch?: string;
  /** Worktree slug when the session is isolated. */
  worktreeName?: string;
}

/** Read-only branch / worktree badge on the sender row. */
export const DesktopGitContext: React.FC<DesktopGitContextProps> = ({
  branch,
  worktreeName,
}) => {
  if (!branch && !worktreeName) return null;
  return (
    <div
      className="desktop-git-context"
      data-testid="desktop-git-context"
      title={
        worktreeName
          ? `分支 ${branch ?? "?"} · worktree ${worktreeName}`
          : `分支 ${branch}`
      }
    >
      {branch ? (
        <span className="desktop-git-context-item" data-testid="desktop-git-branch">
          <span className="codicon codicon-git-branch" />
          <span>{branch}</span>
        </span>
      ) : null}
      {worktreeName ? (
        <span
          className="desktop-git-context-item"
          data-testid="desktop-git-worktree"
        >
          <span className="codicon codicon-folder" />
          <span>{worktreeName}</span>
        </span>
      ) : null}
    </div>
  );
};

export default DesktopGitContext;
