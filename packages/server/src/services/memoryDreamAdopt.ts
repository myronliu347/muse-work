import fs from "node:fs";
import path from "node:path";
import { resolveAutoMemoryDirectory } from "@muse-work/agent";
import { cursorsPath, observationsPath } from "./skillDream.js";
import type { MemoryDreamStore, MemoryDreamTarget } from "./memoryDreams.js";
import {
  applyDream,
  listBackups,
  rollbackMemoryDir,
  type ApplyDreamResult,
} from "./memoryDreamApplier.js";
import {
  hasCriticalMemoryLint,
  lintMemoryDir,
  memoryDirStats,
} from "./memoryDreamLint.js";

/**
 * Human-in-the-loop finishing moves for a dream run: adopt, discard, roll back.
 *
 * The nightly path may call `adoptRun` automatically later; the manual path
 * always waits for the person to press the button.
 */

export interface AdoptOutcome {
  ok: boolean;
  error?: string;
  backupPath?: string;
  stats?: ReturnType<typeof memoryDirStats>;
  lint?: ApplyDreamResult["lint"];
}

export function adoptDreamRun(options: {
  store: MemoryDreamStore;
  runId: string;
  backupRoot: string;
  memoryDirFor?: (workdir: string) => string;
  /** The person accepted non-critical warnings (orphans / over-cap files). */
  allowWarnings?: boolean;
  now?: () => Date;
}): AdoptOutcome {
  const run = options.store.getRun(options.runId);
  if (!run) return { ok: false, error: "run not found" };
  if (run.adoptedAt) return { ok: false, error: "run already adopted" };
  if (run.discardedAt) return { ok: false, error: "run discarded" };
  if (!run.draftDir) return { ok: false, error: "run has no draft" };

  const target = options.store.getTarget(run.targetId);
  if (!target) return { ok: false, error: "target not found" };

  const draftMemory = path.join(run.draftDir, "memory");
  if (!fs.existsSync(draftMemory)) {
    return { ok: false, error: "draft memory directory missing" };
  }

  const memoryDir = options.memoryDirFor
    ? options.memoryDirFor(target.workdir)
    : resolveAutoMemoryDirectory(target.workdir);

  const draftLint = lintMemoryDir(draftMemory);
  if (hasCriticalMemoryLint(draftLint)) {
    return {
      ok: false,
      error: "草稿索引不可用（断链/索引超限/frontmatter 不合法），不能替换",
      lint: draftLint,
    };
  }
  if (run.status !== "succeeded" && !options.allowWarnings) {
    return {
      ok: false,
      error: `run is ${run.status}, not succeeded`,
      lint: draftLint,
    };
  }
  if (!draftLint.ok && !options.allowWarnings) {
    return {
      ok: false,
      error: "草稿还有未进索引或超 4 KB 的文件，确认后仍可替换",
      lint: draftLint,
    };
  }

  const applied = applyDream({
    memoryDir,
    draftDir: draftMemory,
    backupRoot: options.backupRoot,
    targetId: target.id,
    allowWarnings: options.allowWarnings,
    now: (options.now ?? (() => new Date()))(),
  });

  if (!applied.ok) {
    return {
      ok: false,
      error: applied.reason ?? "adopt failed",
      lint: applied.lint,
      backupPath: applied.backupPath,
    };
  }

  const at = (options.now ?? (() => new Date()))().getTime();
  options.store.patchRun(run.id, { adoptedAt: at });
  options.store.patchTarget(target.id, {
    lastStatus: "succeeded",
    lastSummary: applied.stats,
    consecutiveFailures: 0,
  });
  return {
    ok: true,
    backupPath: applied.backupPath,
    stats: applied.stats,
    lint: applied.lint,
  };
}

function restoreSkillCursors(home: string, draftDir: string | undefined): void {
  if (!draftDir) return;
  const before = path.join(draftDir, "skill-cursors.before.json");
  try {
    const snapshot = fs.readFileSync(before, "utf-8");
    const target = cursorsPath(home);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.restore.tmp`;
    fs.writeFileSync(tmp, snapshot, "utf-8");
    fs.renameSync(tmp, target);
  } catch {
    // No snapshot / unreadable snapshot: leave the cursor untouched.
  }
}

/** Drop observations written by a discarded run so they do not fake recurrence. */
function removeObservationsForRun(home: string, runId: string): void {
  const file = observationsPath(home);
  let lines: string[];
  try {
    lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
  } catch {
    return;
  }
  const kept = lines.filter((line) => {
    try {
      return (JSON.parse(line) as { runId?: unknown }).runId !== runId;
    } catch {
      return true;
    }
  });
  if (kept.length === lines.length) return;
  try {
    const tmp = `${file}.${process.pid}.discard.tmp`;
    fs.writeFileSync(tmp, kept.length ? `${kept.join("\n")}\n` : "", "utf-8");
    fs.renameSync(tmp, file);
  } catch {
    // Best effort; the cursor restore is the important part.
  }
}

export function discardDreamRun(options: {
  store: MemoryDreamStore;
  runId: string;
  home?: string;
  now?: () => Date;
}): boolean {
  const run = options.store.getRun(options.runId);
  if (!run || run.adoptedAt) return false;
  // A running run still owns the draft and may write the cursor after this
  // call. An older run is not allowed to rewind while a newer one is alive:
  // cursors are shared, so doing that makes the newer extraction re-consume or
  // skip windows unpredictably.
  if (run.status === "running") return false;
  const newer = options.store
    .listRuns(run.targetId, 200)
    .some(
      (item) =>
        item.id !== run.id &&
        item.startedAt > run.startedAt &&
        !item.discardedAt,
    );
  if (newer) return false;
  if (options.home) {
    restoreSkillCursors(options.home, run.draftDir);
    removeObservationsForRun(options.home, run.id);
  }
  const target = options.store.getTarget(run.targetId);
  if (target && run.status === "succeeded") {
    // Roll the window back to where this run started. A first run has no
    // previous value; 0 makes the next run look at the full history again.
    options.store.patchTarget(target.id, {
      lastRunAt: run.previousLastRunAt ?? 0,
    });
  }
  if (run.draftDir) {
    fs.rmSync(run.draftDir, { recursive: true, force: true });
  }
  options.store.patchRun(run.id, {
    discardedAt: (options.now ?? (() => new Date()))().getTime(),
  });
  return true;
}

export function listDreamBackups(options: {
  store: MemoryDreamStore;
  backupRoot: string;
  targetId: string;
  memoryDirFor?: (workdir: string) => string;
  now?: () => Date;
}): string[] {
  return listBackups(options.backupRoot, options.targetId);
}

export function rollbackDream(options: {
  store: MemoryDreamStore;
  targetId: string;
  backupPath: string;
  backupRoot: string;
  memoryDirFor?: (workdir: string) => string;
  /** The person accepted non-critical warnings (orphans / over-cap files). */
  allowWarnings?: boolean;
  now?: () => Date;
}): AdoptOutcome {
  const target: MemoryDreamTarget | undefined = options.store.getTarget(
    options.targetId,
  );
  if (!target) return { ok: false, error: "target not found" };
  const memoryDir = options.memoryDirFor
    ? options.memoryDirFor(target.workdir)
    : resolveAutoMemoryDirectory(target.workdir);
  const result = rollbackMemoryDir({
    memoryDir,
    backupPath: options.backupPath,
    backupRoot: options.backupRoot,
    targetId: target.id,
    now: (options.now ?? (() => new Date()))(),
  });
  if (result.ok) {
    options.store.patchTarget(target.id, { lastSummary: result.stats });
  }
  return {
    ok: result.ok,
    error: result.ok ? undefined : (result.reason ?? "rollback failed"),
    backupPath: result.backupPath,
    stats: result.stats,
    lint: result.lint,
  };
}
