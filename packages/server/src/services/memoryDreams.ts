import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";

/**
 * Memory dreaming targets and run history.
 *
 * A target is one memory store, identified by the workdir it belongs to
 * (`MemoryService` keys memory by the git common dir, so worktrees share one
 * target). The assistant is just the first target; project targets only add a
 * row, nothing else in the pipeline special-cases them.
 */

export type DreamTargetKind = "assistant" | "project";
export type DreamMode = "draft" | "auto";
export type DreamCadence = "daily" | "weekly";
export type DreamRunStatus = "running" | "succeeded" | "failed" | "skipped";
export type DreamSkipReason =
  | "no_progress"
  | "no_change"
  | "budget"
  | "busy"
  | "error";

export interface DreamTargetSummary {
  files: number;
  orphans: number;
  indexChars: number;
}

export interface MemoryDreamTarget {
  id: string;
  kind: DreamTargetKind;
  /** Project root (or the assistant workdir); memory dir is derived from it. */
  workdir: string;
  label: string;
  enabled: boolean;
  mode: DreamMode;
  cadence: DreamCadence;
  /** Model used by this target's dream sessions; empty means the default. */
  model?: string;
  /**
   * Assistant only: also run when an issue progressed, even if the assistant
   * memory itself did not change. Projects rely on memory changes alone so an
   * active project does not rewrite another project's memory.
   */
  withIssueProgress: boolean;
  /** Last time the scheduler actually attempted a run (success or not). */
  lastAttemptAt?: number;
  lastRunAt?: number;
  lastStatus?: DreamRunStatus;
  lastSummary?: DreamTargetSummary;
  consecutiveFailures: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryDreamRun {
  id: string;
  targetId: string;
  status: DreamRunStatus;
  /** What started it: the nightly tick or the settings page's "run now". */
  trigger?: "schedule" | "manual";
  skipReason?: DreamSkipReason;
  startedAt: number;
  endedAt?: number;
  /** Per-run draft directory (`dreams/<target>/<runId>`), when the run got that far. */
  draftDir?: string;
  summary?: DreamTargetSummary;
  error?: string;
  /** Set when a person (or the auto path) swapped the draft into live memory. */
  adoptedAt?: number;
  /** Set when the draft was thrown away. */
  discardedAt?: number;
}

export interface MemoryDreamStore {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  listTargets(): MemoryDreamTarget[];
  getTarget(id: string): MemoryDreamTarget | undefined;
  /** Seed or refresh the assistant target; its workdir is resolved at runtime. */
  ensureAssistantTarget(workdir: string): MemoryDreamTarget;
  upsertProjectTarget(input: {
    workdir: string;
    label: string;
    mode?: DreamMode;
    cadence?: DreamCadence;
    enabled?: boolean;
  }): MemoryDreamTarget;
  patchTarget(
    id: string,
    patch: Partial<
      Pick<
        MemoryDreamTarget,
        | "enabled"
        | "mode"
        | "cadence"
        | "label"
        | "model"
        | "lastAttemptAt"
        | "lastRunAt"
        | "lastStatus"
        | "lastSummary"
        | "consecutiveFailures"
      >
    >,
  ): MemoryDreamTarget | undefined;
  removeTarget(id: string): boolean;
  addRun(run: MemoryDreamRun): MemoryDreamRun;
  patchRun(
    id: string,
    patch: Partial<Omit<MemoryDreamRun, "id" | "targetId">>,
  ): MemoryDreamRun | undefined;
  getRun(id: string): MemoryDreamRun | undefined;
  listRuns(targetId?: string, limit?: number): MemoryDreamRun[];
  hasRunning(targetId: string): boolean;
  /** A run left `running` by a crashed process must not block the next night. */
  failStaleRunning(reason: string): void;
}

type TargetsFile = {
  version: 1;
  enabled: boolean;
  targets: MemoryDreamTarget[];
};

type RunsFile = {
  version: 1;
  runs: MemoryDreamRun[];
};

const MAX_RUNS = 200;

function targetsPath(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "memory-dreams.json");
}

function runsPath(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "memory-dream-runs.json");
}

function writeAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function projectTargetId(workdir: string): string {
  const normalized = path.resolve(workdir);
  const digest = crypto
    .createHash("sha1")
    .update(normalized)
    .digest("hex")
    .slice(0, 12);
  return `project-${digest}`;
}

export function createMemoryDreamStore(options: {
  home: string;
  now?: () => Date;
}): MemoryDreamStore {
  const now = () => options.now?.() ?? new Date();
  const file = targetsPath(options.home);
  const runsFile = runsPath(options.home);

  const loadedTargets = readJson<TargetsFile>(file, {
    version: 1,
    enabled: false,
    targets: [],
  });
  const loadedRuns = readJson<RunsFile>(runsFile, { version: 1, runs: [] });

  let enabled = loadedTargets.enabled === true;
  const targets = new Map<string, MemoryDreamTarget>();
  for (const target of loadedTargets.targets ?? []) {
    targets.set(target.id, { ...target });
  }
  const runs = new Map<string, MemoryDreamRun>();
  for (const run of loadedRuns.runs ?? []) {
    runs.set(run.id, { ...run });
  }

  function saveTargets(): void {
    writeAtomically(
      file,
      JSON.stringify(
        {
          version: 1,
          enabled,
          targets: [...targets.values()].map((t) => ({ ...t })),
        } satisfies TargetsFile,
        null,
        2,
      ),
    );
  }

  function saveRuns(): void {
    const ordered = [...runs.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_RUNS);
    writeAtomically(
      runsFile,
      JSON.stringify({ version: 1, runs: ordered } satisfies RunsFile, null, 2),
    );
  }

  function touch(target: MemoryDreamTarget): MemoryDreamTarget {
    target.updatedAt = now().getTime();
    targets.set(target.id, target);
    return target;
  }

  function listTargets(): MemoryDreamTarget[] {
    return [...targets.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((t) => ({ ...t }));
  }

  function ensureAssistantTarget(workdir: string): MemoryDreamTarget {
    const existing = targets.get("assistant");
    const at = now().getTime();
    if (existing) {
      // The assistant workdir can move; follow it instead of pinning the seed.
      if (existing.workdir !== workdir) {
        existing.workdir = workdir;
        touch(existing);
        saveTargets();
      }
      return { ...existing };
    }
    const target: MemoryDreamTarget = {
      id: "assistant",
      kind: "assistant",
      workdir,
      label: "助手记忆",
      enabled: true,
      mode: "auto",
      cadence: "daily",
      withIssueProgress: true,
      consecutiveFailures: 0,
      createdAt: at,
      updatedAt: at,
    };
    targets.set(target.id, target);
    saveTargets();
    return { ...target };
  }

  return {
    isEnabled: () => enabled,
    setEnabled(next) {
      enabled = next;
      saveTargets();
    },
    listTargets,
    getTarget(id) {
      const target = targets.get(id);
      return target ? { ...target } : undefined;
    },
    ensureAssistantTarget,

    upsertProjectTarget(input) {
      const id = projectTargetId(input.workdir);
      const at = now().getTime();
      const existing = targets.get(id);
      if (existing) {
        existing.workdir = path.resolve(input.workdir);
        existing.label = input.label;
        if (input.mode) existing.mode = input.mode;
        if (input.cadence) existing.cadence = input.cadence;
        if (input.enabled !== undefined) existing.enabled = input.enabled;
        touch(existing);
        saveTargets();
        return { ...existing };
      }
      const target: MemoryDreamTarget = {
        id,
        kind: "project",
        workdir: path.resolve(input.workdir),
        label: input.label,
        enabled: input.enabled ?? true,
        // Projects default to drafts: their memory holds one-off evidence and
        // auto-rewriting it unattended is the higher-risk default.
        mode: input.mode ?? "draft",
        cadence: input.cadence ?? "daily",
        withIssueProgress: false,
        consecutiveFailures: 0,
        createdAt: at,
        updatedAt: at,
      };
      targets.set(id, target);
      saveTargets();
      return { ...target };
    },

    patchTarget(id, patch) {
      const target = targets.get(id);
      if (!target) return undefined;
      Object.assign(target, patch);
      touch(target);
      saveTargets();
      return { ...target };
    },

    removeTarget(id) {
      const existed = targets.delete(id);
      if (existed) saveTargets();
      return existed;
    },

    addRun(run) {
      runs.set(run.id, { ...run });
      saveRuns();
      return { ...run };
    },

    patchRun(id, patch) {
      const run = runs.get(id);
      if (!run) return undefined;
      Object.assign(run, patch);
      saveRuns();
      return { ...run };
    },

    getRun(id) {
      const run = runs.get(id);
      return run ? { ...run } : undefined;
    },

    listRuns(targetId, limit = 20) {
      return [...runs.values()]
        .filter((run) => (targetId ? run.targetId === targetId : true))
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, limit)
        .map((run) => ({ ...run }));
    },

    hasRunning(targetId) {
      return [...runs.values()].some(
        (run) => run.targetId === targetId && run.status === "running",
      );
    },

    failStaleRunning(reason) {
      let changed = false;
      const at = now().getTime();
      for (const run of runs.values()) {
        if (run.status !== "running") continue;
        run.status = "failed";
        run.error = reason;
        run.endedAt = at;
        changed = true;
      }
      if (changed) saveRuns();
    },
  };
}

export function defaultDreamBackupRoot(home: string): string {
  return path.join(getMuseHomeDir(home), "dreams", "backups");
}

export function defaultDreamDraftRoot(home: string): string {
  return path.join(getMuseHomeDir(home), "dreams", "drafts");
}
