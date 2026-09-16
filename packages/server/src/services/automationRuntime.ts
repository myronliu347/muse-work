import type { SessionRunner } from "./sessionRunner/index.js";
import type { SessionStore } from "./sessionStore.js";
import type { WsHub } from "./wsHub.js";
import {
  type Automation,
  type AutomationRun,
  type AutomationStore,
  type AutomationTrigger,
} from "./automationStore.js";
import type { Issue, IssueStore } from "./issueStore.js";
import { cronMatchesLocal } from "./scheduleCompile.js";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTickMinute(at: Date): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}T${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

function issueTriggerMatches(
  trigger: AutomationTrigger,
  event: "created" | "review" | "completed" | "cancelled",
  issue: Issue,
): boolean {
  if (trigger.type !== "issue") return false;
  if (!trigger.events.includes(event)) return false;
  if (trigger.priority !== undefined && trigger.priority !== issue.priority) {
    return false;
  }
  if (trigger.tags && trigger.tags.length > 0) {
    const issueTags = new Set(issue.tags);
    for (const tag of trigger.tags) {
      const normalized = String(tag).trim().toLowerCase();
      if (!normalized || !issueTags.has(normalized)) return false;
    }
  }
  return true;
}

export function createAutomationRuntime(options: {
  store: AutomationStore;
  hub: WsHub;
  sessions: SessionStore;
  runner: SessionRunner;
  home: string;
  now?: () => Date;
  issueStore?: IssueStore;
  startSession?: (args: {
    automation: Automation;
    run: AutomationRun;
  }) => Promise<string>;
}): {
  enqueue(
    automationId: string,
    trigger: AutomationRun["trigger"],
  ): AutomationRun | undefined;
  tick(): void;
  start(): void;
  stop(): void;
} {
  const { store, hub } = options;
  const now = () => options.now?.() ?? new Date();
  const startSession =
    options.startSession ??
    (async () => "sess-1");

  store.failStaleRunning("进程退出");

  let lastTickMinute: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeIssues: (() => void) | undefined;

  function broadcast(): void {
    hub.broadcastAll({ type: "automation:changed" });
  }

  function enqueue(
    automationId: string,
    trigger: AutomationRun["trigger"],
  ): AutomationRun | undefined {
    const automation = store.get(automationId);
    if (!automation || !automation.enabled) {
      return undefined;
    }

    const startedAt = now().getTime();
    const id = crypto.randomUUID();

    if (store.hasRunning(automationId)) {
      const run = store.addRun({
        id,
        automationId,
        status: "skipped",
        skipReason: "rule_running",
        trigger: { ...trigger },
        startedAt,
        endedAt: startedAt,
      });
      broadcast();
      return run;
    }

    if (store.countRunning() >= 2) {
      const run = store.addRun({
        id,
        automationId,
        status: "skipped",
        skipReason: "global_concurrency",
        trigger: { ...trigger },
        startedAt,
        endedAt: startedAt,
      });
      broadcast();
      return run;
    }

    const run = store.addRun({
      id,
      automationId,
      status: "running",
      trigger: { ...trigger },
      startedAt,
    });
    broadcast();
    void Promise.resolve(startSession({ automation, run }))
      .then((sessionId) => {
        store.patchRun(run.id, { sessionId });
      })
      .catch(() => {
        // Task 6 owns real session failures.
      });
    return run;
  }

  function onIssueEvent(payload: {
    event: "created" | "review" | "completed" | "cancelled";
    issue: Issue;
  }): void {
    const firedAt = now().getTime();
    for (const automation of store.list()) {
      if (!automation.enabled) continue;
      const matched = automation.triggers.some((trigger) =>
        issueTriggerMatches(trigger, payload.event, payload.issue),
      );
      if (!matched) continue;
      enqueue(automation.id, {
        type: "issue",
        firedAt,
        issue: {
          id: payload.issue.id,
          title: payload.issue.title,
          status: payload.issue.status,
          priority: payload.issue.priority,
          tags: [...payload.issue.tags],
        },
      });
    }
  }

  unsubscribeIssues = options.issueStore?.subscribe(onIssueEvent);

  function tick(): void {
    const at = now();
    const minute = formatTickMinute(at);
    if (lastTickMinute !== undefined && minute <= lastTickMinute) {
      return;
    }
    lastTickMinute = minute;
    const ts = at.getTime();

    for (const automation of store.list()) {
      if (!automation.enabled) continue;

      let triggersChanged = false;
      const nextTriggers = automation.triggers.map((trigger) => {
        if (trigger.type === "cron") {
          if (cronMatchesLocal(trigger.expr, at)) {
            const alreadyFiredThisMinute = store
              .listRuns(automation.id)
              .some(
                (run) =>
                  run.trigger.type === "cron" &&
                  run.trigger.expr === trigger.expr &&
                  formatTickMinute(new Date(run.trigger.firedAt)) === minute,
              );
            if (!alreadyFiredThisMinute) {
              enqueue(automation.id, {
                type: "cron",
                firedAt: ts,
                expr: trigger.expr,
              });
            }
          }
          return trigger;
        }
        if (
          trigger.type === "once" &&
          trigger.firedAt === undefined &&
          formatTickMinute(new Date(trigger.at)) === minute
        ) {
          enqueue(automation.id, { type: "once", firedAt: ts });
          triggersChanged = true;
          return { ...trigger, firedAt: ts };
        }
        return trigger;
      });

      if (triggersChanged) {
        store.update(automation.id, { triggers: nextTriggers });
      }
    }
  }

  function start(): void {
    if (timer) return;
    tick();
    timer = setInterval(() => {
      tick();
    }, 15_000);
    timer.unref?.();
  }

  function stop(): void {
    unsubscribeIssues?.();
    unsubscribeIssues = undefined;
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  }

  return { enqueue, tick, start, stop };
}
