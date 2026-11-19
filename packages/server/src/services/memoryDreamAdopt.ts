import fs from "node:fs";
import path from "node:path";
import { resolveAutoMemoryDirectory } from "@muse-work/agent";
import type { MemoryDreamStore, MemoryDreamTarget } from "./memoryDreams.js";
import {
  applyDream,
  listBackups,
  rollbackMemoryDir,
  type ApplyDreamResult,
} from "./memoryDreamApplier.js";
import { memoryDirStats } from "./memoryDreamLint.js";

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
  now?: () => Date;
}): AdoptOutcome {
  const run = options.store.getRun(options.runId);
  if (!run) return { ok: false, error: "run not found" };
  if (run.adoptedAt) return { ok: false, error: "run already adopted" };
  if (run.discardedAt) return { ok: false, error: "run discarded" };
  if (run.status !== "succeeded") {
    return { ok: false, error: `run is ${run.status}, not succeeded` };
  }
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

  const applied = applyDream({
    memoryDir,
    draftDir: draftMemory,
    backupRoot: options.backupRoot,
    targetId: target.id,
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

export function discardDreamRun(options: {
  store: MemoryDreamStore;
  runId: string;
  now?: () => Date;
}): boolean {
  const run = options.store.getRun(options.runId);
  if (!run || run.adoptedAt) return false;
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
