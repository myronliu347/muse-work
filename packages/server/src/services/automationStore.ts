import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";

export type AutomationPermission = "workspace";
export type AutomationRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "stopped"
  | "skipped";
export type SkipReason = "rule_running" | "global_concurrency";

export type AutomationTrigger =
  | { type: "cron"; expr: string }
  | { type: "once"; at: number; firedAt?: number }
  | {
      type: "issue";
      events: Array<"created" | "review" | "completed" | "cancelled">;
      tags?: string[];
      priority?: "p0" | "p1" | "p2";
    };

export interface Automation {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  prompt: string;
  workdir: string;
  agentName?: string;
  model?: string;
  permission: AutomationPermission;
  triggers: AutomationTrigger[];
  createdAt: number;
  updatedAt: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  sessionId?: string;
  status: AutomationRunStatus;
  trigger: {
    type: "cron" | "once" | "issue" | "manual";
    firedAt: number;
    issue?: {
      id: string;
      title: string;
      status: string;
      priority: string;
      tags: string[];
    };
  };
  skipReason?: SkipReason;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

type AutomationsFile = {
  version: 1;
  automations: Automation[];
};

type AutomationRunsFile = {
  version: 1;
  runs: AutomationRun[];
};

const MAX_RUNS_PER_AUTOMATION = 100;

function getAutomationsPath(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "automations.json");
}

function getAutomationRunsPath(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "automation-runs.json");
}

function writeAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function defaultAutomationsFile(): AutomationsFile {
  return { version: 1, automations: [] };
}

function defaultAutomationRunsFile(): AutomationRunsFile {
  return { version: 1, runs: [] };
}

function loadAutomationsFile(filePath: string): AutomationsFile {
  if (!fs.existsSync(filePath)) {
    return defaultAutomationsFile();
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as AutomationsFile;
}

function loadAutomationRunsFile(filePath: string): AutomationRunsFile {
  if (!fs.existsSync(filePath)) {
    return defaultAutomationRunsFile();
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as AutomationRunsFile;
}

function cloneAutomation(automation: Automation): Automation {
  return {
    ...automation,
    triggers: automation.triggers.map((trigger) => ({ ...trigger })),
  };
}

function cloneRun(run: AutomationRun): AutomationRun {
  return {
    ...run,
    trigger: {
      ...run.trigger,
      issue: run.trigger.issue ? { ...run.trigger.issue, tags: [...run.trigger.issue.tags] } : undefined,
    },
  };
}

function hydrateAutomation(record: Automation): Automation {
  return {
    ...record,
    description: record.description ?? "",
    permission: record.permission ?? "workspace",
    triggers: record.triggers ?? [],
  };
}

export function createAutomationStore(options?: { home?: string }) {
  const home = options?.home ?? process.env.MUSE_HOME ?? os.homedir();
  const automationsPath = getAutomationsPath(home);
  const runsPath = getAutomationRunsPath(home);

  const automationsFile = loadAutomationsFile(automationsPath);
  const runsFile = loadAutomationRunsFile(runsPath);

  const automations = new Map<string, Automation>();
  const runs = new Map<string, AutomationRun>();

  for (const record of automationsFile.automations) {
    if (!record?.id) continue;
    automations.set(record.id, hydrateAutomation(record));
  }

  for (const record of runsFile.runs) {
    if (!record?.id) continue;
    runs.set(record.id, { ...record });
  }

  function persistAutomations(): void {
    writeAtomically(
      automationsPath,
      JSON.stringify(
        { version: 1, automations: [...automations.values()] },
        null,
        2,
      ) + "\n",
    );
  }

  function persistRuns(): void {
    writeAtomically(
      runsPath,
      JSON.stringify({ version: 1, runs: [...runs.values()] }, null, 2) + "\n",
    );
  }

  function pruneRunsForAutomation(automationId: string): void {
    const forAutomation = [...runs.values()].filter(
      (run) => run.automationId === automationId,
    );
    if (forAutomation.length <= MAX_RUNS_PER_AUTOMATION) {
      return;
    }
    forAutomation.sort((a, b) => {
      if (a.startedAt !== b.startedAt) {
        return a.startedAt - b.startedAt;
      }
      return a.id.localeCompare(b.id);
    });
    const toRemove = forAutomation.slice(
      0,
      forAutomation.length - MAX_RUNS_PER_AUTOMATION,
    );
    for (const run of toRemove) {
      runs.delete(run.id);
    }
  }

  return {
    create(input: Partial<Automation> & { triggers?: AutomationTrigger[] }): Automation {
      const now = Date.now();
      const automation: Automation = {
        id: crypto.randomUUID(),
        name: input.name ?? "",
        description: input.description ?? "",
        enabled: input.enabled ?? false,
        prompt: input.prompt ?? "",
        workdir: input.workdir ?? "",
        agentName: input.agentName,
        model: input.model,
        permission: input.permission ?? "workspace",
        triggers: (input.triggers ?? []).map((trigger) => ({ ...trigger })),
        createdAt: now,
        updatedAt: now,
      };
      automations.set(automation.id, automation);
      persistAutomations();
      return cloneAutomation(automation);
    },

    get(id: string): Automation | undefined {
      const automation = automations.get(id);
      return automation ? cloneAutomation(automation) : undefined;
    },

    list(): Automation[] {
      return [...automations.values()]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(cloneAutomation);
    },

    update(
      id: string,
      patch: Partial<Omit<Automation, "id" | "createdAt">>,
    ): Automation | undefined {
      const automation = automations.get(id);
      if (!automation) {
        return undefined;
      }
      if (patch.name !== undefined) automation.name = patch.name;
      if (patch.description !== undefined) automation.description = patch.description;
      if (patch.enabled !== undefined) automation.enabled = patch.enabled;
      if (patch.prompt !== undefined) automation.prompt = patch.prompt;
      if (patch.workdir !== undefined) automation.workdir = patch.workdir;
      if (patch.agentName !== undefined) automation.agentName = patch.agentName;
      if (patch.model !== undefined) automation.model = patch.model;
      if (patch.permission !== undefined) automation.permission = patch.permission;
      if (patch.triggers !== undefined) {
        automation.triggers = patch.triggers.map((trigger) => ({ ...trigger }));
      }
      automation.updatedAt = Date.now();
      persistAutomations();
      return cloneAutomation(automation);
    },

    setEnabled(id: string, enabled: boolean): Automation | undefined {
      const automation = automations.get(id);
      if (!automation) {
        return undefined;
      }
      if (automation.enabled !== enabled) {
        automation.enabled = enabled;
        automation.updatedAt = Date.now();
        persistAutomations();
      }
      return cloneAutomation(automation);
    },

    remove(id: string): boolean {
      if (!automations.has(id)) {
        return false;
      }
      automations.delete(id);
      persistAutomations();
      return true;
    },

    addRun(run: AutomationRun): AutomationRun {
      const stored = cloneRun(run);
      runs.set(stored.id, stored);
      pruneRunsForAutomation(stored.automationId);
      persistRuns();
      return cloneRun(stored);
    },

    listRuns(automationId: string): AutomationRun[] {
      return [...runs.values()]
        .filter((run) => run.automationId === automationId)
        .sort((a, b) => {
          if (b.startedAt !== a.startedAt) {
            return b.startedAt - a.startedAt;
          }
          return b.id.localeCompare(a.id);
        })
        .map(cloneRun);
    },

    getRun(runId: string): AutomationRun | undefined {
      const run = runs.get(runId);
      return run ? cloneRun(run) : undefined;
    },

    patchRun(
      runId: string,
      patch: Partial<AutomationRun>,
    ): AutomationRun | undefined {
      const run = runs.get(runId);
      if (!run) {
        return undefined;
      }
      if (patch.automationId !== undefined) run.automationId = patch.automationId;
      if (patch.sessionId !== undefined) run.sessionId = patch.sessionId;
      if (patch.status !== undefined) run.status = patch.status;
      if (patch.trigger !== undefined) {
        run.trigger = {
          ...patch.trigger,
          issue: patch.trigger.issue
            ? { ...patch.trigger.issue, tags: [...patch.trigger.issue.tags] }
            : undefined,
        };
      }
      if (patch.skipReason !== undefined) run.skipReason = patch.skipReason;
      if (patch.error !== undefined) run.error = patch.error;
      if (patch.startedAt !== undefined) run.startedAt = patch.startedAt;
      if (patch.endedAt !== undefined) run.endedAt = patch.endedAt;
      persistRuns();
      return cloneRun(run);
    },

    failStaleRunning(error: string): void {
      const now = Date.now();
      let changed = false;
      for (const run of runs.values()) {
        if (run.status !== "running") continue;
        run.status = "failed";
        run.error = error;
        run.endedAt = now;
        changed = true;
      }
      if (changed) {
        persistRuns();
      }
    },

    countRunning(): number {
      let count = 0;
      for (const run of runs.values()) {
        if (run.status === "running") count++;
      }
      return count;
    },

    hasRunning(automationId: string): boolean {
      for (const run of runs.values()) {
        if (run.automationId === automationId && run.status === "running") {
          return true;
        }
      }
      return false;
    },
  };
}

export type AutomationStore = ReturnType<typeof createAutomationStore>;
