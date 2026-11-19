import type { MemoryDreamTarget, DreamSkipReason } from "./memoryDreams.js";
import { evaluateDreamGate, type DreamGateDecision } from "./memoryDreamGate.js";

/**
 * Decide which targets run tonight.
 *
 * Pure planning: no sessions, no disk writes outside the read-only checks.
 * The scheduler owns the timer and the engine owns execution; keeping the
 * decision here makes "why did it not run" testable and explainable.
 */

export interface DreamPlanItem {
  target: MemoryDreamTarget;
  memoryDir: string;
  decision: DreamGateDecision;
  /** Weekly cadence force-runs even when nothing changed. */
  forcedWeekly: boolean;
}

export interface DreamPlan {
  run: DreamPlanItem[];
  skipped: Array<DreamPlanItem & { skipReason: DreamSkipReason }>;
}

export const DEFAULT_MAX_RUNS_PER_NIGHT = 2;

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export function isWeeklyDue(
  target: MemoryDreamTarget,
  now: number,
): boolean {
  if (target.cadence !== "weekly") return false;
  if (!target.lastRunAt) return true;
  return now - target.lastRunAt >= SEVEN_DAYS;
}

export function planDreams(options: {
  home: string;
  targets: MemoryDreamTarget[];
  now: number;
  memoryDirFor: (target: MemoryDreamTarget) => string;
  maxRuns?: number;
}): DreamPlan {
  const maxRuns = options.maxRuns ?? DEFAULT_MAX_RUNS_PER_NIGHT;
  const run: DreamPlanItem[] = [];
  const skipped: DreamPlan["skipped"] = [];

  const enabled = options.targets
    .filter((target) => target.enabled)
    // Oldest first: a target that missed nights goes before one that just ran.
    .sort((a, b) => (a.lastRunAt ?? 0) - (b.lastRunAt ?? 0));

  for (const target of enabled) {
    const memoryDir = options.memoryDirFor(target);
    const forcedWeekly = isWeeklyDue(target, options.now);
    const decision = evaluateDreamGate({
      home: options.home,
      target,
      memoryDir,
      now: options.now,
      force: forcedWeekly,
    });
    const item: DreamPlanItem = { target, memoryDir, decision, forcedWeekly };

    if (!decision.shouldRun) {
      skipped.push({
        ...item,
        skipReason: decision.skipReason ?? "no_change",
      });
      continue;
    }
    if (run.length >= maxRuns) {
      skipped.push({ ...item, skipReason: "budget" });
      continue;
    }
    run.push(item);
  }

  return { run, skipped };
}
