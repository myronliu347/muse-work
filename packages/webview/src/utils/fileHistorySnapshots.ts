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
 * snapshot per edit. For display we keep only the newest snapshot per file
 * (the diff against current content is the same, so duplicates just add rows).
 */
export function dedupeSnapshotsByFile<T extends FileSnapshotLike>(
  snapshots: T[],
): T[] {
  const newest = new Map<string, T>();
  for (const snap of snapshots) {
    if (!snap.filePath) continue;
    const existing = newest.get(snap.filePath);
    if (!existing || (snap.timestamp ?? 0) >= (existing.timestamp ?? 0)) {
      newest.set(snap.filePath, snap);
    }
  }
  return [...newest.values()];
}
