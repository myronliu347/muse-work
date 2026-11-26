import crypto from "node:crypto";
import fs from "node:fs";
import {
  dreamDraftDir,
  type MemoryDreamRun,
  type MemoryDreamStore,
  type MemoryDreamTarget,
} from "./memoryDreams.js";
import { dreamCutoff, evaluateDreamGate } from "./memoryDreamGate.js";
import { planDreams } from "./memoryDreamSchedule.js";
import type { DreamEngine } from "./memoryDreamEngine.js";
import { adoptDreamRun } from "./memoryDreamAdopt.js";
import { defaultDreamBackupRoot } from "./memoryDreams.js";
import { adoptRuleDraft, readAssistantRules, readRuleDrafts } from "./ruleDream.js";
import { adoptSkillDraft, readSkillDrafts } from "./skillDream.js";
import { requestSkillCatalogRefresh } from "@muse-work/agent";
import type { SessionRunner } from "./sessionRunner/ctx.js";

/**
 * The nightly driver.
 *
 * One tick checks "is it past the target's due hour and did we already attempt
 * this period", plans
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
  /** Live runner used to reload rules after scheduled auto-adoption. */
  runner?: SessionRunner;
  /** Assistant session id, for live rule reload after auto-adoption. */
  resolveAssistantSessionId?: () => string | undefined;
  now?: () => Date;
  hour?: number;
  maxRuns?: number;
  onChanged?: () => void;
}): MemoryDreamScheduler {
  const now = () => options.now?.() ?? new Date();
  const hour = options.hour ?? 4;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;

  function notify(): void {
    options.onChanged?.();
  }

  function periodStart(target: MemoryDreamTarget, at: number): number {
    const start = new Date(at);
    start.setHours(target.hour ?? hour, 0, 0, 0);
    if (target.cadence === "weekly") {
      // ISO-style week starting Monday; catch up on the first tick after it.
      const day = start.getDay();
      start.setDate(start.getDate() - ((day + 6) % 7));
    } else if (target.cadence === "monthly") {
      start.setDate(1);
    }
    return start.getTime();
  }

  function dueForAttempt(target: MemoryDreamTarget, at: number): boolean {
    const start = periodStart(target, at);
    if (at < start) return false;
    return (target.lastAttemptAt ?? 0) < start;
  }

  async function autoAdopt(
    target: MemoryDreamTarget,
    run: MemoryDreamRun,
    trigger: "schedule" | "manual",
  ): Promise<void> {
    if (trigger !== "schedule" || target.mode !== "auto") return;
    if (!run.draftDir) return;
    const errors: string[] = [];
    let adoptedMemory = false;
    const memory = adoptDreamRun({
      store: options.store,
      runId: run.id,
      backupRoot: defaultDreamBackupRoot(options.home),
      memoryDirFor: options.memoryDirFor,
    });
    if (memory.ok) adoptedMemory = true;
    else if (memory.error) errors.push(`memory: ${memory.error}`);

    const skills = readSkillDrafts(run.draftDir).filter((draft) => draft.lint.ok);
    let adoptedSkills = 0;
    for (const skill of skills) {
      const outcome = adoptSkillDraft({
        draftDir: run.draftDir,
        name: skill.name,
        workdir: target.workdir,
        backupRoot: defaultDreamBackupRoot(options.home),
      });
      if (outcome.ok) adoptedSkills += 1;
      else if (outcome.error) errors.push(`skill ${skill.name}: ${outcome.error}`);
    }
    if (adoptedSkills > 0) {
      await requestSkillCatalogRefresh(target.workdir).catch(() => {
        /* the catalog refreshes on the assistant's next load anyway */
      });
    }

    const agentsMd = (() => {
      try {
        return fs.readFileSync(`${target.workdir}/AGENTS.md`, "utf-8");
      } catch {
        return "";
      }
    })();
    const existingRules = readAssistantRules(target.workdir);
    const rules = readRuleDrafts(
      run.draftDir,
      agentsMd,
      existingRules.map((rule) => rule.text),
    ).filter((draft) => draft.lint.ok);
    let adoptedRules = 0;
    for (const rule of rules) {
      const outcome = adoptRuleDraft({
        draftDir: run.draftDir,
        name: rule.name,
        workdir: target.workdir,
        backupRoot: defaultDreamBackupRoot(options.home),
        agentsMd,
        existingRules: existingRules.map((item) => item.text),
      });
      if (outcome.ok) adoptedRules += 1;
      else if (outcome.error) errors.push(`rule ${rule.name}: ${outcome.error}`);
    }
    if (adoptedRules > 0 && options.runner) {
      const assistantId = options.resolveAssistantSessionId?.();
      if (assistantId) {
        await options.runner.reloadMemoryRules(assistantId).catch(() => {
          /* next agent rebuild will load the rules */
        });
      }
    }

    const at = now().getTime();
    options.store.patchRun(run.id, {
      ...(adoptedMemory || adoptedSkills > 0 || adoptedRules > 0
        ? { autoAdoptedAt: at }
        : {}),
      ...(errors.length > 0 ? { autoAdoptError: errors.join("; ") } : {}),
    });
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
      ...(result.pending !== undefined ? { pending: result.pending } : {}),
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
      // A full rerun stays "full" until the cursor backlog is empty: the
      // transcripts it has not reached yet must keep reading full history, not
      // be filtered by a cutoff that has already moved past them.
      const drained = (result.pending ?? 0) === 0;
      options.store.patchTarget(target.id, {
        lastRunAt: now().getTime(),
        lastStatus: "succeeded",
        lastSummary: result.stats,
        consecutiveFailures: 0,
        fullRerun: drained ? false : target.fullRerun === true,
      });
      if (finished) await autoAdopt(target, finished, trigger);
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
    const at = now().getTime();
    const decision = evaluateDreamGate({
      home: options.home,
      target,
      memoryDir: options.memoryDirFor(target.workdir),
      now: at,
    });
    if (!decision.shouldRun) {
      // Manual runs still respect the same "something changed" gate as the
      // nightly tick; a no-op run would only pay for a memory organizer.
      const run = options.store.addRun({
        id: crypto.randomUUID(),
        targetId: target.id,
        status: "skipped",
        trigger: "manual",
        skipReason: decision.skipReason,
        startedAt: at,
        endedAt: at,
      });
      options.store.patchTarget(target.id, {
        lastAttemptAt: at,
        lastStatus: "skipped",
      });
      notify();
      return run;
    }
    return execute(target, decision.since, "manual");
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
