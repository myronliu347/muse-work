import React from "react";
import "../../styles/DesktopApp.css";

export interface WorktreeInfoCardProps {
  /** Optional session title shown as the card heading (sidebar hover). */
  title?: string;
  /** Worktree branch name (e.g. `worktree-<name>`). */
  branch?: string;
  /** Worktree slug (e.g. `lgmv`). */
  worktreeName?: string;
  /** Worktree directory path. */
  workdir?: string;
}

/**
 * Hover card describing a worktree session: branch, worktree name, and
 * worktree directory. Mirrors the Cursor hover metadata card.
 */
export const WorktreeInfoCard: React.FC<WorktreeInfoCardProps> = ({
  title,
  branch,
  worktreeName,
  workdir,
}) => {
  return (
    <div
      className="desktop-worktree-card"
      data-testid="desktop-worktree-card"
    >
      {title ? (
        <div className="desktop-worktree-card-title">{title}</div>
      ) : null}
      {branch ? (
        <div className="desktop-worktree-card-row">
          <span className="codicon codicon-git-branch" aria-hidden="true" />
          <span>{branch}</span>
        </div>
      ) : null}
      {worktreeName ? (
        <div className="desktop-worktree-card-row">
          <span className="codicon codicon-folder" aria-hidden="true" />
          <span>
            {worktreeName}
            <span className="desktop-worktree-card-sub">Worktree</span>
          </span>
        </div>
      ) : null}
      {workdir ? (
        <div className="desktop-worktree-card-row">
          <span className="codicon codicon-file-directory" aria-hidden="true" />
          <span>{workdir}</span>
        </div>
      ) : null}
    </div>
  );
};

export default WorktreeInfoCard;
