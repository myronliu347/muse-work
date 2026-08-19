import React from "react";
import type { EnrichedFileSnapshot } from "../../types";
import { FileIcon } from "../panels/FileIcon";
import { displayFileName } from "../../utils/filePathDisplay";
import { dedupeSnapshotsByFile } from "../../utils/fileHistorySnapshots";
import "../../styles/FileHistoryCard.css";

export interface FileHistoryCardProps {
  /** Message ids carrying the snapshots shown (undo reverts them all). */
  messageIds: string[];
  snapshots: EnrichedFileSnapshot[];
  workdir?: string;
  /** Open a file in the diff pane (最近一次修改 mode). */
  onOpenFile?: (path: string) => void;
  /** Undo this turn's file changes. */
  onRevert?: (messageIds: string[]) => void;
  reverting?: boolean;
}

/**
 * "N 个文件已更改" card shown below the last assistant message. Lists each
 * file with its +N/−M line diff stats; the header carries an undo action that
 * restores the pre-edit snapshot content.
 */
export const FileHistoryCard: React.FC<FileHistoryCardProps> = ({
  messageIds,
  snapshots,
  workdir,
  onOpenFile,
  onRevert,
  reverting,
}) => {
  const hasRevert = Boolean(onRevert);
  // A turn often edits the same file repeatedly; keep the newest snapshot per
  // file so the card lists each changed file once (stats counted once too).
  const files = dedupeSnapshotsByFile(snapshots);
  const filePaths = files.map((s) => s.filePath).filter(Boolean) as string[];
  const totalAdditions = files.reduce(
    (sum, s) => sum + (s.additions ?? 0),
    0,
  );
  const totalDeletions = files.reduce(
    (sum, s) => sum + (s.deletions ?? 0),
    0,
  );

  return (
    <div
      className="file-history-card"
      data-testid="file-history-card"
      data-message-id={messageIds.join(",")}
    >
      <div className="file-history-card-header">
        <span className="file-history-card-title">
          {files.length} 个文件已更改
        </span>
        {totalAdditions > 0 && (
          <span className="file-history-card-stats file-history-card-stats--add">
            +{totalAdditions}
          </span>
        )}
        {totalDeletions > 0 && (
          <span className="file-history-card-stats file-history-card-stats--del">
            −{totalDeletions}
          </span>
        )}
        {hasRevert && (
          <button
            className="file-history-card-revert"
            data-testid="file-history-card-revert"
            onClick={() => onRevert?.(messageIds)}
            disabled={reverting}
            title="撤销本轮文件改动"
          >
            <i className={`codicon ${reverting ? "codicon-loading" : "codicon-history"}`} />
            <span>{reverting ? "撤销中…" : "撤销"}</span>
          </button>
        )}
      </div>
      <div className="file-history-card-files">
        {files.map((snap) => {
          const display = displayFileName(snap.filePath ?? "", filePaths);
          const add = snap.additions ?? 0;
          const del = snap.deletions ?? 0;
          return (
            <div
              key={snap.filePath}
              className="file-history-card-row"
              data-testid="file-history-card-row"
              onClick={() => onOpenFile?.(snap.filePath!)}
            >
              <FileIcon name={display} className="file-history-card-file-icon" />
              <span className="file-history-card-file-name" title={snap.filePath}>
                {display}
              </span>
              <span className="file-history-card-file-stats">
                {add > 0 && (
                  <span className="file-history-card-stats--add">+{add}</span>
                )}
                {del > 0 && (
                  <span className="file-history-card-stats--del">−{del}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FileHistoryCard;
