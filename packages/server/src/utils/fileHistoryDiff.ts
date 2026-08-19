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

type DiffOp = { type: "keep" | "del" | "add"; text: string };

/**
 * Myers O((N+M)D) line diff. Produces an edit script (keep/del/add) that
 * correctly aligns content around single-line insertions/deletions — the naive
 * prefix/suffix matcher mislabeled hundreds of shifted lines as changed.
 */
function myersOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ type: "add" as const, text }));
  if (m === 0) return a.map((text) => ({ type: "del" as const, text }));
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset];
      } else {
        x = v[k - 1 + offset] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        // Backtrack to reconstruct the edit script. trace[d] holds the V
        // array AFTER layer d completed (saved at the end of this loop body).
        const ops: DiffOp[] = [];
        let px = n;
        let py = m;
        for (let dd = d - 1; dd >= 0; dd--) {
          const vv = trace[dd];
          const k = px - py;
          let prevK: number;
          if (k === -dd || (k !== dd && vv[k - 1 + offset] < vv[k + 1 + offset])) {
            prevK = k + 1;
          } else {
            prevK = k - 1;
          }
          const prevX = vv[prevK + offset];
          const prevY = prevX - prevK;
          while (px > prevX && py > prevY) {
            ops.push({ type: "keep", text: a[px - 1] });
            px--;
            py--;
          }
          if (px > prevX) {
            ops.push({ type: "del", text: a[px - 1] });
            px--;
          } else if (py > prevY) {
            ops.push({ type: "add", text: b[py - 1] });
            py--;
          }
        }
        while (px > 0 && py > 0) {
          ops.push({ type: "keep", text: a[px - 1] });
          px--;
          py--;
        }
        ops.reverse();
        return ops;
      }
    }
    trace.push(Int32Array.from(v));
  }
  return [];
}

/**
 * Group the edit script into git-style hunks with 3 lines of context.
 * Adjacent change blocks closer than 2*CONTEXT+1 lines are merged into one
 * hunk; each hunk carries a `@@ -aStart,aCount +bStart,bCount @@` header.
 */
function buildHunks(a: string[], b: string[], ops: DiffOp[]): string {
  // Assign 1-based line numbers to every output line.
  let aLine = 1;
  let bLine = 1;
  const rows = ops.map((op) => {
    const row = {
      op: op.type,
      text: op.text,
      aLine: op.type === "add" ? 0 : aLine,
      bLine: op.type === "del" ? 0 : bLine,
    };
    if (op.type !== "add") aLine++;
    if (op.type !== "del") bLine++;
    return row;
  });

  // Find change-block boundaries: keep-runs longer than 2*CONTEXT split hunks.
  const hunks: string[] = [];
  let i = 0;
  while (i < rows.length) {
    while (i < rows.length && rows[i].op === "keep") i++;
    if (i >= rows.length) break;
    const start = Math.max(0, i - CONTEXT_LINES);
    let end = i;
    while (end < rows.length) {
      if (rows[end].op !== "keep") {
        end++;
        continue;
      }
      let next = end;
      while (next < rows.length && rows[next].op === "keep") next++;
      if (next >= rows.length) break;
      if (next - end > 2 * CONTEXT_LINES) break;
      end = next;
    }
    end = Math.min(rows.length, end + CONTEXT_LINES);
    const block = rows.slice(start, end);
    const aStart = block.find((r) => r.aLine > 0)?.aLine ?? 0;
    const bStart = block.find((r) => r.bLine > 0)?.bLine ?? 0;
    const aCount = block.filter((r) => r.aLine > 0).length;
    const bCount = block.filter((r) => r.bLine > 0).length;
    const lines = [`@@ -${aStart},${aCount} +${bStart},${bCount} @@`];
    for (const r of block) {
      lines.push(`${r.op === "keep" ? " " : r.op === "del" ? "-" : "+"}${r.text}`);
    }
    hunks.push(lines.join("\n"));
    i = end;
  }
  return hunks.join("\n");
}

/**
 * Line diff between `before` and `after` file contents. Uses a Myers line diff
 * so that a single inserted/deleted line does not mislabel the following
 * shifted lines as changed (the old prefix/suffix matcher did), then emits
 * git-style hunks with 3 lines of context.
 */
export function diffLines(before: string, after: string): LineDiff {
  const a = before.split("\n");
  const b = after.split("\n");
  // Trim a single trailing empty entry from the split (content ends with \n).
  if (a[a.length - 1] === "") a.pop();
  if (b[b.length - 1] === "") b.pop();

  const ops = myersOps(a, b);
  const additions = ops.filter((op) => op.type === "add").length;
  const deletions = ops.filter((op) => op.type === "del").length;
  if (additions === 0 && deletions === 0) {
    return { additions: 0, deletions: 0, hunks: "" };
  }
  return { additions, deletions, hunks: buildHunks(a, b, ops) };
}

/**
 * Enrich every assistant message of the NEWEST turn with a `file_history`
 * block, adding per-snapshot line diff stats (additions/deletions/hunks) by
 * comparing the stored pre-edit snapshot content against the file's current
 * content on disk.
 *
 * A "turn" starts at a real user message (role=user, not isMeta) and runs to
 * the next user message. Only the newest turn is considered: if it has no
 * file_history blocks (a plain question, tool-only diagnosis), nothing is
 * enriched — earlier turns' changes are intentionally not shown.
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

  // Walk from the tail and collect every assistant message of the newest turn
  // (bounded by real user messages; meta-injected user messages do not break
  // it). We stop at the first real user message — earlier turns are ignored
  // even when the newest turn has no file_history.
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
      // The newest turn ends here; do not look further back.
      break;
    }
    if (m?.role !== "assistant") continue;
    inTurn = true;
    targets.push(i);
    if (!foundFh && m.blocks?.some((b) => b.type === "file_history")) {
      foundFh = true;
    }
  }
  if (!inTurn || !foundFh) return messages;

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
