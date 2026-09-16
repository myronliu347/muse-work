import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAutomationStore } from "../src/services/automationStore.js";
import { createAutomationRuntime } from "../src/services/automationRuntime.js";
import { createIssueStore } from "../src/services/issueStore.js";
import { createWsHub } from "../src/services/wsHub.js";
import { createSessionStore } from "../src/services/sessionStore.js";
import type { SessionRunner } from "../src/services/sessionRunner/index.js";

describe("automationRuntime", () => {
  const homes: string[] = [];
  const runtimes: Array<{ stop: () => void }> = [];

  afterEach(() => {
    for (const runtime of runtimes) runtime.stop();
    runtimes.length = 0;
    for (const home of homes) {
      fs.rmSync(home, { recursive: true, force: true });
    }
    homes.length = 0;
  });

  function setup(now: () => Date) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-auto-rt-"));
    homes.push(home);
    const store = createAutomationStore({ home });
    const issueStore = createIssueStore({ home });
    const hub = createWsHub({ pingIntervalMs: 0 });
    const sessions = createSessionStore({ home });
    const runtime = createAutomationRuntime({
      store,
      hub,
      sessions,
      runner: {} as SessionRunner,
      home,
      now,
      issueStore,
      startSession: async () => "sess-1",
    });
    runtimes.push(runtime);
    return { home, store, runtime, hub, issueStore };
  }

  it("second enqueue of the same rule is skipped as rule_running", () => {
    const now = () => new Date(2026, 8, 16, 9, 0, 0);
    const { store, runtime } = setup(now);
    const automation = store.create({
      name: "巡检",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: true,
      triggers: [{ type: "cron", expr: "0 9 * * *" }],
    });
    const first = runtime.enqueue(automation.id, {
      type: "cron",
      firedAt: now().getTime(),
    });
    const second = runtime.enqueue(automation.id, {
      type: "cron",
      firedAt: now().getTime(),
    });
    expect(first?.status).toBe("running");
    expect(second?.status).toBe("skipped");
    expect(second?.skipReason).toBe("rule_running");
    expect(store.listRuns(automation.id)).toHaveLength(2);
  });

  it("third concurrent rule is skipped as global_concurrency", () => {
    const now = () => new Date(2026, 8, 16, 9, 0, 0);
    const { store, runtime } = setup(now);
    const rules = [1, 2, 3].map((i) =>
      store.create({
        name: `r${i}`,
        prompt: "x",
        workdir: "/tmp/p",
        enabled: true,
        triggers: [{ type: "cron", expr: "0 9 * * *" }],
      }),
    );
    const a = runtime.enqueue(rules[0]!.id, { type: "cron", firedAt: 1 });
    const b = runtime.enqueue(rules[1]!.id, { type: "cron", firedAt: 1 });
    const c = runtime.enqueue(rules[2]!.id, { type: "cron", firedAt: 1 });
    expect(a?.status).toBe("running");
    expect(b?.status).toBe("running");
    expect(c?.status).toBe("skipped");
    expect(c?.skipReason).toBe("global_concurrency");
  });

  it("disabled cron tick writes no run", () => {
    const now = () => new Date(2026, 8, 16, 9, 0, 0);
    const { store, runtime } = setup(now);
    const automation = store.create({
      name: "巡检",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: false,
      triggers: [{ type: "cron", expr: "0 9 * * *" }],
    });
    runtime.tick();
    expect(store.listRuns(automation.id)).toHaveLength(0);
  });

  it("tick writes running only when now matches the cron minute", () => {
    let current = new Date(2026, 8, 16, 8, 59, 0);
    const { store, runtime } = setup(() => current);
    const automation = store.create({
      name: "巡检",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: true,
      triggers: [{ type: "cron", expr: "0 9 * * *" }],
    });
    runtime.tick();
    expect(store.listRuns(automation.id)).toHaveLength(0);
    current = new Date(2026, 8, 16, 9, 0, 0);
    runtime.tick();
    const runs = store.listRuns(automation.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("running");
    expect(runs[0]?.trigger.type).toBe("cron");
  });

  it("does not enqueue twice for the same lastTickMinute", () => {
    let current = new Date(2026, 8, 16, 9, 0, 0);
    const { store, runtime } = setup(() => current);
    const automation = store.create({
      name: "巡检",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: true,
      triggers: [{ type: "cron", expr: "0 9 * * *" }],
    });
    runtime.tick();
    expect(store.listRuns(automation.id)).toHaveLength(1);
    current = new Date(2026, 8, 16, 9, 1, 0);
    runtime.tick();
    current = new Date(2026, 8, 16, 9, 0, 0);
    runtime.tick();
    expect(store.listRuns(automation.id)).toHaveLength(1);
  });

  it("once tick enqueues and sets firedAt", () => {
    const at = new Date(2026, 8, 16, 9, 0, 0).getTime();
    let current = new Date(at);
    const { store, runtime } = setup(() => current);
    const automation = store.create({
      name: "一次",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: true,
      triggers: [{ type: "once", at }],
    });
    runtime.tick();
    const runs = store.listRuns(automation.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.trigger.type).toBe("once");
    expect(store.get(automation.id)?.triggers[0]).toMatchObject({
      type: "once",
      firedAt: expect.any(Number),
    });
    current = new Date(at + 60_000);
    runtime.tick();
    expect(store.listRuns(automation.id)).toHaveLength(1);
  });

  it("does not backfill a past once on first tick", () => {
    const at = new Date(2026, 8, 16, 8, 0, 0).getTime();
    const current = new Date(2026, 8, 16, 9, 0, 0);
    const { store, runtime } = setup(() => current);
    const automation = store.create({
      name: "一次",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: true,
      triggers: [{ type: "once", at }],
    });
    runtime.tick();
    expect(store.listRuns(automation.id)).toHaveLength(0);
    expect(store.get(automation.id)?.triggers[0]).toEqual({ type: "once", at });
  });

  it("start ticks immediately then arms the interval", () => {
    const now = () => new Date(2026, 8, 16, 9, 0, 0);
    const { store, runtime } = setup(now);
    const automation = store.create({
      name: "巡检",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: true,
      triggers: [{ type: "cron", expr: "0 9 * * *" }],
    });
    runtime.start();
    expect(store.listRuns(automation.id)).toHaveLength(1);
    runtime.stop();
  });

  it("does not re-enqueue cron after a same-minute process restart", () => {
    const current = new Date(2026, 8, 16, 9, 0, 30);
    const { home, store } = setup(() => current);
    const automation = store.create({
      name: "巡检",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: true,
      triggers: [{ type: "cron", expr: "0 9 * * *" }],
    });
    store.addRun({
      id: "prior",
      automationId: automation.id,
      status: "failed",
      error: "进程退出",
      trigger: {
        type: "cron",
        expr: "0 9 * * *",
        firedAt: new Date(2026, 8, 16, 9, 0, 5).getTime(),
      },
      startedAt: new Date(2026, 8, 16, 9, 0, 5).getTime(),
      endedAt: current.getTime(),
    });
    const restarted = createAutomationRuntime({
      store,
      hub: createWsHub({ pingIntervalMs: 0 }),
      sessions: createSessionStore({ home }),
      runner: {} as SessionRunner,
      home,
      now: () => current,
      startSession: async () => "sess-1",
    });
    runtimes.push(restarted);
    restarted.tick();
    const cronRuns = store
      .listRuns(automation.id)
      .filter((run) => run.trigger.type === "cron");
    expect(cronRuns).toHaveLength(1);
    expect(cronRuns[0]?.id).toBe("prior");
  });

  it("tick enqueues each matching cron expr in the same minute and writes skipped if first is running", () => {
    const now = () => new Date(2026, 8, 14, 9, 0, 0);
    const { store, runtime } = setup(now);
    const automation = store.create({
      name: "巡检",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: true,
      triggers: [
        { type: "cron", expr: "0 9 * * *" },
        { type: "cron", expr: "0 9 * * 1-5" },
      ],
    });
    runtime.tick();
    const runs = store.listRuns(automation.id);
    expect(runs).toHaveLength(2);
    const statuses = runs.map((run) => run.status).sort();
    expect(statuses).toEqual(["running", "skipped"]);
    const skipped = runs.find((run) => run.status === "skipped");
    expect(skipped?.skipReason).toBe("rule_running");
    expect(new Set(runs.map((run) => run.trigger.expr))).toEqual(
      new Set(["0 9 * * *", "0 9 * * 1-5"]),
    );
  });

  it("restart same minute does not re-fire the same expr but can fire a second unmatched expr", () => {
    const current = new Date(2026, 8, 14, 9, 0, 30);
    const { home, store } = setup(() => current);
    const automation = store.create({
      name: "巡检",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: true,
      triggers: [
        { type: "cron", expr: "0 9 * * *" },
        { type: "cron", expr: "0 9 * * 1-5" },
      ],
    });
    store.addRun({
      id: "prior",
      automationId: automation.id,
      status: "failed",
      error: "进程退出",
      trigger: {
        type: "cron",
        expr: "0 9 * * *",
        firedAt: new Date(2026, 8, 14, 9, 0, 5).getTime(),
      },
      startedAt: new Date(2026, 8, 14, 9, 0, 5).getTime(),
      endedAt: current.getTime(),
    });
    const restarted = createAutomationRuntime({
      store,
      hub: createWsHub({ pingIntervalMs: 0 }),
      sessions: createSessionStore({ home }),
      runner: {} as SessionRunner,
      home,
      now: () => current,
      startSession: async () => "sess-1",
    });
    runtimes.push(restarted);
    restarted.tick();
    const cronRuns = store
      .listRuns(automation.id)
      .filter((run) => run.trigger.type === "cron");
    expect(cronRuns).toHaveLength(2);
    const prior = cronRuns.find((run) => run.trigger.expr === "0 9 * * *");
    const weekday = cronRuns.find((run) => run.trigger.expr === "0 9 * * 1-5");
    expect(prior?.id).toBe("prior");
    expect(weekday?.status).toBe("running");
  });

  it("create marks leftover running runs as failed 进程退出", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-auto-rt-"));
    homes.push(home);
    const store = createAutomationStore({ home });
    const automation = store.create({
      name: "巡检",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: true,
      triggers: [{ type: "cron", expr: "0 9 * * *" }],
    });
    store.addRun({
      id: "stale",
      automationId: automation.id,
      status: "running",
      trigger: { type: "cron", firedAt: 1 },
      startedAt: 1,
    });
    const runtime = createAutomationRuntime({
      store,
      hub: createWsHub({ pingIntervalMs: 0 }),
      sessions: createSessionStore({ home }),
      runner: {} as SessionRunner,
      home,
      now: () => new Date(2026, 8, 16, 9, 0, 0),
    });
    runtimes.push(runtime);
    const run = store.getRun("stale");
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("进程退出");
  });

  it("enqueue of a disabled rule returns undefined and writes no run", () => {
    const now = () => new Date(2026, 8, 16, 9, 0, 0);
    const { store, runtime } = setup(now);
    const automation = store.create({
      name: "巡检",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: false,
      triggers: [{ type: "cron", expr: "0 9 * * *" }],
    });
    expect(
      runtime.enqueue(automation.id, { type: "manual", firedAt: 1 }),
    ).toBeUndefined();
    expect(store.listRuns(automation.id)).toHaveLength(0);
  });

  it("issue create enqueues when tags are a subset and skips otherwise", () => {
    const now = () => new Date(2026, 8, 16, 9, 0, 0);
    const { store, issueStore } = setup(now);
    const automation = store.create({
      name: "收口",
      prompt: "x",
      workdir: "/tmp/p",
      enabled: true,
      triggers: [
        { type: "issue", events: ["created"], tags: ["auth"] },
      ],
    });
    const hit = issueStore.create({
      title: "修登录",
      tags: ["auth", "backend"],
    });
    const runs = store.listRuns(automation.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("running");
    expect(runs[0]?.trigger).toMatchObject({
      type: "issue",
      issue: {
        id: hit.id,
        title: "修登录",
        status: "pending",
        tags: ["auth", "backend"],
      },
    });
    issueStore.create({ title: "无关", tags: ["backend"] });
    expect(store.listRuns(automation.id)).toHaveLength(1);
  });
});
