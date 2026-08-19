import fs from "node:fs";
import path from "node:path";

/** Result of a line-level diff between two file contents. */
export interface LineDiff {
  additions: number;
  deletions: number;
  /** Unified-diff style hunks (git-like `@@` headers) for the webview DiffPane. */
  hunks: string;
}

const CONTEXT_LINES = 3;

/**
 * Line diff between `before` and `after` file contents. Uses a simple
 * prefix/suffix match around a changed middle block, then emits git-style
 * hunks with 3 lines of context. Good enough for the small per-turn edits
 * that file_history snapshots capture; not a full Myers diff.
 */
export function diffLines(before: string, after: string): LineDiff {
  const a = before.split("\n");
  const b = after.split("\n");
  // Trim a single trailing empty entry from the split (content ends with \n).
  if (a[a.length - 1] === "") a.pop();
  if (b[b.length - 1] === "") b.pop();

  // Common prefix / suffix
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);

  if (aMid.length === 0 && bMid.length === 0) {
    return { additions: 0, deletions: 0, hunks: "" };
  }

  const additions = bMid.length;
  const deletions = aMid.length;

  // Build a single hunk (small per-turn edits rarely need splitting).
  const aStart = prefix;
  const bStart = prefix;
  const aCount = aMid.length;
  const bCount = bMid.length;
  const header = `@@ -${aStart},${aCount} +${bStart},${bCount} @@`;

  // Context lines before the change.
  const contextBefore = a.slice(Math.max(0, prefix - CONTEXT_LINES), prefix);
  // Context lines after the change.
  const contextAfter = a.slice(a.length - suffix, a.length - suffix + CONTEXT_LINES);

  const lines: string[] = [header];
  for (const line of contextBefore) lines.push(` ${line}`);
  for (const line of aMid) lines.push(`-${line}`);
  for (const line of bMid) lines.push(`+${line}`);
  for (const line of contextAfter) lines.push(` ${line}`);

  return { additions, deletions, hunks: lines.join("\n") };
}

/**
 * Enrich every assistant message of the newest turn that carries a
 * `file_history` block with per-snapshot line diff stats
 * (additions/deletions/hunks) by comparing the stored pre-edit snapshot
 * content against the file's current content on disk.
 *
 * A "turn" starts at a real user message (role=user, not isMeta) and runs to
 * the next user message. Trailing turns without changes (tool-only diagnosis,
 * plain questions) are skipped; the newest turn that actually changed files
 * wins — matching the "recent changes" card below the last message.
 *
 * Snapshots whose current content matches the snapshot (already reverted or
 * never persisted) are dropped; an emptied block is removed entirely.
 *
 * Returns a NEW messages array; the SDK's persisted blocks are never mutated.
 */
export function enrichFileHistory(
  messages: unknown[],
  workdir: string,
  _sessionId: string,
): unknown[] {
  if (messages.length === 0) return messages;

  // Walk from the tail and collect every assistant message belonging to the
  // newest turn that contains at least one file_history block. A turn is
  // bounded by real user messages (role=user && !isMeta); meta-injected user
  // messages (task reminders, SessionStart) do not break the turn.
  const targets: number[] = [];
  let inTurn = false;
  let foundFh = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as {
      role?: string;
      isMeta?: boolean;
      blocks?: Array<Record<string, unknown>>;
    };
    if (m?.role === "user" && !m.isMeta) {
      if (inTurn) {
        // A user message ends the turn we were collecting. If that turn had
        // file_history, we stop here; otherwise discard it and keep looking.
        if (foundFh) break;
        targets.length = 0;
        inTurn = false;
        foundFh = false;
        continue;
      }
      continue;
    }
    if (m?.role !== "assistant") continue;
    inTurn = true;
    targets.push(i);
    if (!foundFh && m.blocks?.some((b) => b.type === "file_history")) {
      foundFh = true;
    }
  }
  if (!foundFh) return messages;

  let changed = false;
  const next = messages.map((m, idx) => {
    if (!targets.includes(idx)) return m;
    const msg = m as {
      blocks?: Array<Record<string, unknown>>;
    };
    const blocks = msg.blocks!.map((block) => {
      if (block.type !== "file_history") return block;
      const snapshots = block.snapshots as Array<{
        filePath?: string;
        snapshotPath?: string;
      }> | undefined;
      if (!Array.isArray(snapshots) || snapshots.length === 0) return block;

      const enriched = snapshots
        .map((snap) => {
          const filePath = snap.filePath;
          if (!filePath) return snap;
          const resolved = filePath.startsWith("/")
            ? filePath
            : pathJoin(workdir, filePath);
          const before = readFileSafe(snap.snapshotPath);
          const after = readFileSafe(resolved);
          const diff = diffLines(before, after);
          if (diff.additions === 0 && diff.deletions === 0) {
            changed = true;
            return null;
          }
          changed = true;
          return { ...snap, ...diff };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      if (enriched.length === 0) return null;
      return { ...block, snapshots: enriched };
    });

    const nextBlocks = blocks.filter(
      (b): b is Record<string, unknown> => b !== null,
    );
    return { ...msg, blocks: nextBlocks };
  });

  return changed ? next : messages;
}

function readFileSafe(filePath: string | undefined): string {
  if (!filePath) return "";
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function pathJoin(base: string, p: string): string {
  return `${base.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;
}

/**
 * Restore files captured by file_history snapshots (undo). LIFO (newest first),
 * mirroring the SDK's revertTo order:
 * - create / missing snapshot content → delete the file
 * - otherwise write the pre-edit snapshot content back
 *
 * Returns the number of snapshots successfully reverted. A single failure is
 * logged and skipped so the rest of the batch still applies.
 */
export function revertSnapshots(
  snapshots: Array<{
    filePath?: string;
    snapshotPath?: string;
    operation?: string;
    timestamp?: number;
  }>,
): number {
  const ordered = [...snapshots].sort(
    (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0),
  );
  let revertedCount = 0;
  for (const snap of ordered) {
    const filePath = snap.filePath;
    if (!filePath) continue;
    try {
      const before = snap.snapshotPath ? readFileSafe(snap.snapshotPath) : null;
      if (snap.operation === "create" || before === null || before === "") {
        if (fs.existsSync(filePath)) fs.rmSync(filePath);
      } else {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, before);
      }
      revertedCount++;
    } catch {
      // Keep going; a single failure must not abort the batch.
    }
  }
  return revertedCount;
}
