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

type TurnMessage = {
  role?: string;
  isMeta?: boolean;
  blocks?: ReadonlyArray<{
    type?: string;
    snapshots?: ReadonlyArray<FileSnapshotLike & {
      snapshotPath?: string;
      additions?: number;
      deletions?: number;
      hunks?: string;
    }>;
  }>;
};

/** Files changed in the newest turn, in the shape the diff pane renders. */
export function recentTurnDiffFiles(messages: readonly TurnMessage[], workdir: string | undefined) {
  const snapshots: Array<
    FileSnapshotLike & {
      snapshotPath?: string;
      additions?: number;
      deletions?: number;
      hunks?: string;
    }
  > = [];
  let inTurn = false;
  let foundHistory = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user" && !message.isMeta) break;
    if (message.role !== "assistant") continue;
    inTurn = true;
    const block = message.blocks?.find((item) => item.type === "file_history");
    if (block?.snapshots) {
      snapshots.push(...block.snapshots);
      foundHistory = true;
    }
  }
  if (!inTurn || !foundHistory) return [];
  return dedupeSnapshotsByFile(snapshots)
    .filter(
      (snapshot) =>
        snapshot.filePath &&
        (!workdir || snapshot.filePath.startsWith(workdir)) &&
        ((snapshot.additions ?? 0) > 0 || (snapshot.deletions ?? 0) > 0),
    )
    .map((snapshot) => ({
      path: snapshot.filePath!,
      status: "modified" as const,
      additions: snapshot.additions ?? 0,
      deletions: snapshot.deletions ?? 0,
      hunks: snapshot.hunks ?? "",
      truncated: false,
      binary: false,
      ...(snapshot.snapshotPath ? { snapshotPath: snapshot.snapshotPath } : {}),
    }));
}
