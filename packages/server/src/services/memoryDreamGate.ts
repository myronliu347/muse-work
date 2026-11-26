import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { pathEncoder } from "@muse-work/agent";
import type {
  DreamSkipReason,
  MemoryDreamTarget,
} from "./memoryDreams.js";
import {
  countPendingTranscripts,
  cursorsPath,
  loadSkillCursors,
} from "./skillDream.js";

/**
 * Decide whether a memory-dream run is worth starting.
 *
 * Two independent signals:
 * - the target's own memory changed since the last successful run (every
 *   target; no new memory means nothing to consolidate);
 * - an issue progressed since then (assistant only, opt-in per target).
 *
 * A third one keeps capped runs honest: transcripts still behind their cursor
 * are a reason to run even when memory did not change. Without it, a run that
 * stopped after `MAX_TRANSCRIPTS_PER_RUN` would look "done" and the rest of
 * the backlog would never be read.
 *
 * The cutoff is "since the last successful run", not a calendar day, so a run
 * that crosses midnight still sees everything.
 */

export interface DreamGateDecision {
  shouldRun: boolean;
  skipReason?: DreamSkipReason;
  since: number;
  changedFiles: string[];
  issueProgress: number;
  assistantActivity?: boolean;
  /** Transcripts whose cursor is still behind (assistant only). */
  pendingTranscripts: number;
}

export function startOfLocalDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function startOfPreviousLocalDay(at: number): number {
  const start = new Date(startOfLocalDay(at));
  start.setDate(start.getDate() - 1);
  return start.getTime();
}

/** Last run wins; a target that never ran looks back one day, capped at 7. */
export function dreamCutoff(target: MemoryDreamTarget, now: number): number {
  if (target.fullRerun) return 0;
  const oneDayAgo = startOfPreviousLocalDay(now);
  const last = target.lastRunAt;
  if (!last) return oneDayAgo;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return Math.min(Math.max(last, oneDayAgo - sevenDays), now);
}

export function issueProgressDir(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "issue-progress");
}

/**
 * Count progress records newer than `since` across every issue.
 *
 * Reads the per-issue JSONL files directly: the progress store only exposes
 * per-issue queries, and this scan is a background nightly job, not a hot path.
 */
export function countIssueProgressSince(home: string, since: number): number {
  const dir = issueProgressDir(home);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, entry), "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.includes('"at"')) continue;
      try {
        const record = JSON.parse(line) as { at?: unknown };
        if (typeof record.at === "number" && record.at >= since) count += 1;
      } catch {
        // A torn last line while another process appends: ignore it.
      }
    }
  }
  return count;
}

/**
 * The assistant is a long-lived session: a day of chatting may not write a
 * single memory file, yet it is exactly the material the skill pass needs. A
 * fresh transcript therefore counts as a reason to run the assistant target.
 */
export function hasNewAssistantTranscript(
  home: string,
  workdir: string,
  since: number,
): boolean {
  const dir = path.join(
    getMuseHomeDir(home),
    "projects",
    pathEncoder.encodeSync(workdir),
  );
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  return entries.some((entry) => {
    if (!entry.endsWith(".jsonl")) return false;
    try {
      return fs.statSync(path.join(dir, entry)).mtimeMs > since;
    } catch {
      return false;
    }
  });
}

/** Memory files (one level, Markdown) modified after `since`. */
export function listChangedMemoryFiles(
  memoryDir: string,
  since: number,
): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(memoryDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const changed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    try {
      const stat = fs.statSync(path.join(memoryDir, entry.name));
      if (stat.mtimeMs > since) changed.push(entry.name);
    } catch {
      // File vanished between readdir and stat: not a change we can act on.
    }
  }
  return changed.sort();
}

export function evaluateDreamGate(options: {
  home: string;
  target: MemoryDreamTarget;
  memoryDir: string;
  now: number;
  /** Weekly sweep: run even when nothing changed. */
  force?: boolean;
}): DreamGateDecision {
  const since = dreamCutoff(options.target, options.now);
  const changedFiles = listChangedMemoryFiles(options.memoryDir, since);
  const issueProgress = options.target.withIssueProgress
    ? countIssueProgressSince(options.home, since)
    : 0;
  const assistantActivity =
    options.target.kind === "assistant" &&
    hasNewAssistantTranscript(options.home, options.target.workdir, since);
  const pendingTranscripts =
    options.target.kind === "assistant"
      ? countPendingTranscripts({
          home: options.home,
          workdir: options.target.workdir,
          cursors: loadSkillCursors(cursorsPath(options.home)),
        })
      : 0;

  if (options.force) {
    return {
      shouldRun: true,
      since,
      changedFiles,
      issueProgress,
      assistantActivity,
      pendingTranscripts,
    };
  }

  if (
    changedFiles.length > 0 ||
    issueProgress > 0 ||
    assistantActivity ||
    pendingTranscripts > 0
  ) {
    return {
      shouldRun: true,
      since,
      changedFiles,
      issueProgress,
      assistantActivity,
      pendingTranscripts,
    };
  }

  return {
    shouldRun: false,
    skipReason: options.target.withIssueProgress ? "no_progress" : "no_change",
    since,
    changedFiles,
    issueProgress,
    assistantActivity,
    pendingTranscripts,
  };
}
