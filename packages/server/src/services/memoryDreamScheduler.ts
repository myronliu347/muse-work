import crypto from "node:crypto";
import {
  dreamDraftDir,
  type MemoryDreamRun,
  type MemoryDreamStore,
  type MemoryDreamTarget,
} from "./memoryDreams.js";
import { dreamCutoff } from "./memoryDreamGate.js";
import { planDreams } from "./memoryDreamSchedule.js";
import type { DreamEngine } from "./memoryDreamEngine.js";

/**
 * The nightly driver.
 *
 * One tick checks "is it past 03:00 and did we already attempt today", plans
 * the targets that need work, and runs them one at a time. A missed 03:00 (the
 * laptop was asleep) is caught on the next tick after start, once per target
 * per local day.
 */

export interface MemoryDreamScheduler {
  tick(): Promise<void>;
  start(): void;
  stop(): void;
  runNow(targetId: string): Promise<MemoryDreamRun | undefined>;
  handleTurnSettled(sessionId: string, result: { ok: boolean; error?: string }): void;
}

const TICK_MS = 15_000;
const MAX_CONSECUTIVE_FAILURES = 3;

function localHourStart(now: Date, hour: number): number {
  const start = new Date(now);
  start.setHours(hour, 0, 0, 0);
  return start.getTime();
}

export function createMemoryDreamScheduler(options: {
  home: string;
  store: MemoryDreamStore;
  engine: DreamEngine;
  memoryDirFor: (workdir: string) => string;
  /** Root of dream drafts; the run record carries its directory from the start. */
  draftRoot: string;
  /** Resolve the assistant workdir at runtime; seeds/refreshes its target. */
  resolveAssistantWorkdir?: () => string | undefined;
  now?: () => Date;
  hour?: number;
  maxRuns?: number;
  onChanged?: () => void;
}): MemoryDreamScheduler {
  const now = () => options.now?.() ?? new Date();
  const hour = options.hour ?? 3;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;

  function notify(): void {
    options.onChanged?.();
  }

  function dueForAttempt(target: MemoryDreamTarget, at: number): boolean {
    const start = localHourStart(new Date(at), hour);
    if (at < start) return false;
    const lastAttempt = target.lastAttemptAt ?? 0;
    if (target.cadence === "weekly") {
      const week = 7 * 24 * 60 * 60 * 1000;
      const anchor = target.lastRunAt ?? 0;
      return at - anchor >= week && lastAttempt < start;
    }
    return lastAttempt < start;
  }

  async function execute(
    target: MemoryDreamTarget,
    since: number,
    trigger: "schedule" | "manual",
  ): Promise<MemoryDreamRun | undefined> {
    const runId = crypto.randomUUID();
    const run = options.store.addRun({
      id: runId,
      targetId: target.id,
      status: "running",
      trigger,
      startedAt: now().getTime(),
      previousLastRunAt: target.lastRunAt,
      // Written now, not on completion: the settings page needs the draft
      // directory to read progress.json while the run is still in flight.
      draftDir: dreamDraftDir(options.draftRoot, target.id, runId),
    });
    options.store.patchTarget(target.id, { lastAttemptAt: now().getTime() });
    notify();

    const result = await options.engine.run({
      target,
      runId: run.id,
      since,
    });

    const finished = options.store.patchRun(run.id, {
      status: result.ok ? "succeeded" : "failed",
      endedAt: now().getTime(),
      summary: result.stats,
      transcripts: result.transcripts,
      fallbackIndex: result.fallbackIndex === true,
      ...(result.skillError ? { skillError: result.skillError } : {}),
      ...(result.lint
        ? {
            lint: {
              ok: result.lint.ok,
              orphans: result.lint.orphans,
              overCap: result.lint.overCap.length,
              dangling: result.lint.dangling.length,
              indexChars: result.lint.indexChars,
              indexLines: result.lint.indexLines,
            },
          }
        : {}),
      error: result.error,
    });

    if (result.ok) {
      options.store.patchTarget(target.id, {
        lastRunAt: now().getTime(),
        lastStatus: "succeeded",
        lastSummary: result.stats,
        consecutiveFailures: 0,
      });
    } else {
      const failures = target.consecutiveFailures + 1;
      options.store.patchTarget(target.id, {
        lastStatus: "failed",
        lastSummary: result.stats,
        consecutiveFailures: failures,
        ...(failures >= MAX_CONSECUTIVE_FAILURES ? { enabled: false } : {}),
      });
    }
    notify();
    return finished;
  }

  async function tick(): Promise<void> {
    if (inFlight) return;
    if (!options.store.isEnabled()) return;
    inFlight = true;
    const assistantWorkdir = options.resolveAssistantWorkdir?.();
    if (assistantWorkdir) options.store.ensureAssistantTarget(assistantWorkdir);
    try {
      const at = now().getTime();
      const targets = options.store
        .listTargets()
        .filter((target) => target.enabled && dueForAttempt(target, at));
      if (targets.length === 0) return;

      const plan = planDreams({
        home: options.home,
        targets,
        now: at,
        memoryDirFor: (target) => options.memoryDirFor(target.workdir),
        maxRuns: options.maxRuns,
      });

      for (const item of plan.skipped) {
        options.store.addRun({
          id: crypto.randomUUID(),
          targetId: item.target.id,
          status: "skipped",
          skipReason: item.skipReason,
          startedAt: at,
          endedAt: at,
        });
        options.store.patchTarget(item.target.id, {
          lastAttemptAt: at,
          lastStatus: "skipped",
        });
      }

      for (const item of plan.run) {
        await execute(item.target, item.decision.since, "schedule");
      }
      if (plan.skipped.length > 0) notify();
    } finally {
      inFlight = false;
    }
  }

  async function runNow(
    targetId: string,
  ): Promise<MemoryDreamRun | undefined> {
    const target = options.store.getTarget(targetId);
    if (!target) return undefined;
    const since = dreamCutoff(target, now().getTime());
    return execute(target, since, "manual");
  }

  return {
    tick,
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => {
        void tick();
      }, TICK_MS);
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
    runNow,
    handleTurnSettled(sessionId, result) {
      options.engine.handleTurnSettled(sessionId, result);
    },
  };
}
