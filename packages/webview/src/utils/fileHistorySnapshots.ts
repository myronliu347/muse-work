/**
 * file_history snapshot helpers shared by the message-list card and the diff
 * pane's "最近一次修改" mode.
 */

export interface FileSnapshotLike {
  filePath?: string;
  timestamp?: number;
}

/**
 * One turn often edits the same file several times; the SDK records a
 * snapshot per edit. For display we keep only the OLDEST snapshot per file:
 * the enrich diff is computed against the file's CURRENT disk content, so the
 * oldest snapshot (pre-first-edit content) yields the whole turn's diff, while
 * newer snapshots would only show the delta since that edit.
 */
export function dedupeSnapshotsByFile<T extends FileSnapshotLike>(
  snapshots: T[],
): T[] {
  const oldest = new Map<string, T>();
  for (const snap of snapshots) {
    if (!snap.filePath) continue;
    const existing = oldest.get(snap.filePath);
    if (!existing || (snap.timestamp ?? 0) <= (existing.timestamp ?? 0)) {
      oldest.set(snap.filePath, snap);
    }
  }
  return [...oldest.values()];
}
