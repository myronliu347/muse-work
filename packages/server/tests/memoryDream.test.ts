import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createMemoryDreamStore,
  projectTargetId,
} from "../src/services/memoryDreams.js";
import {
  countIssueProgressSince,
  dreamCutoff,
  evaluateDreamGate,
  listChangedMemoryFiles,
} from "../src/services/memoryDreamGate.js";
import { lintMemoryDir } from "../src/services/memoryDreamLint.js";
import { rebuildFlatIndex } from "../src/services/memoryDreamIndex.js";
import {
  applyDream,
  listBackups,
  rollbackMemoryDir,
} from "../src/services/memoryDreamApplier.js";
import { planDreams } from "../src/services/memoryDreamSchedule.js";
import { createMemoryDreamEngine, type DreamEngine } from "../src/services/memoryDreamEngine.js";
import { dreamDraftDir } from "../src/services/memoryDreams.js";
import { skillRootForWorkdir } from "../src/services/skillDream.js";
import { ruleRootForWorkdir } from "../src/services/ruleDream.js";
import { createMemoryDreamScheduler } from "../src/services/memoryDreamScheduler.js";
import {
  adoptDreamRun,
  discardDreamRun,
  listDreamBackups,
  rollbackDream,
} from "../src/services/memoryDreamAdopt.js";
import { cursorsPath, observationsPath } from "../src/services/skillDream.js";
import { pathEncoder, resolveAutoMemoryDirectory } from "@muse-work/agent";
import type { SessionStore } from "../src/services/sessionStore.js";
import type { SessionRunner } from "../src/services/sessionRunner/ctx.js";
import type { MemoryDreamTarget } from "../src/services/memoryDreams.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "muse-dream-"));
}

function writeMemory(
  dir: string,
  name: string,
  description: string,
  type = "feedback",
  body = "- one rule",
): void {
  fs.writeFileSync(
    path.join(dir, name),
    `---\nname: ${name}\ndescription: ${description}\ntype: ${type}\n---\n\n${body}\n`,
    "utf-8",
  );
}

function makeMemoryDir(files: Array<{ name: string; description?: string }>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-mem-"));
  for (const file of files) {
    writeMemory(dir, file.name, file.description ?? `about ${file.name}`);
  }
  const index = files
    .map((file) => `- [${file.name}](${file.name}) — ${file.description ?? file.name}`)
    .join("\n");
  fs.writeFileSync(path.join(dir, "MEMORY.md"), `# Memory\n\n${index}\n`, "utf-8");
  // Backdate the fixture so "changed since" assertions only see writes the test makes.
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  for (const entry of fs.readdirSync(dir)) {
    fs.utimesSync(path.join(dir, entry), old, old);
  }
  return dir;
}

describe("memoryDreamStore", () => {
  it("seeds the assistant target once and persists it", () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    const target = store.ensureAssistantTarget("/Users/me/assistant-chat");
    expect(target.id).toBe("assistant");
    expect(target.kind).toBe("assistant");
    expect(target.mode).toBe("auto");
    expect(target.withIssueProgress).toBe(true);

    const reloaded = createMemoryDreamStore({ home });
    expect(reloaded.getTarget("assistant")?.workdir).toBe(
      "/Users/me/assistant-chat",
    );
  });

  it("follows a moved assistant workdir", () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    store.ensureAssistantTarget("/old");
    store.ensureAssistantTarget("/new");
    expect(store.listTargets()).toHaveLength(1);
    expect(store.getTarget("assistant")?.workdir).toBe("/new");
  });

  it("adds project targets as drafts by default", () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    const target = store.upsertProjectTarget({
      workdir: "/repos/a",
      label: "A",
    });
    expect(target.id).toBe(projectTargetId("/repos/a"));
    expect(target.kind).toBe("project");
    expect(target.mode).toBe("draft");
    expect(target.withIssueProgress).toBe(false);
    expect(store.upsertProjectTarget({ workdir: "/repos/a", label: "A2" }).label).toBe(
      "A2",
    );
  });

  it("stores a per-target dream model", () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    store.ensureAssistantTarget("/assistant");
    store.patchTarget("assistant", { model: "deepseek-v4-pro" });
    expect(createMemoryDreamStore({ home }).getTarget("assistant")?.model).toBe(
      "deepseek-v4-pro",
    );
    store.patchTarget("assistant", { model: "" });
    expect(store.getTarget("assistant")?.model).toBe("");
  });

  it("keeps the enabled flag across reloads", () => {
    const home = tempHome();
    createMemoryDreamStore({ home }).setEnabled(true);
    expect(createMemoryDreamStore({ home }).isEnabled()).toBe(true);
  });

  it("records runs, guards per target, and clears stale running rows", () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    const run = store.addRun({
      id: "r1",
      targetId: "assistant",
      status: "running",
      startedAt: 1,
    });
    expect(store.hasRunning("assistant")).toBe(true);
    store.patchRun(run.id, { status: "succeeded", endedAt: 2 });
    expect(store.hasRunning("assistant")).toBe(false);

    store.addRun({ id: "r2", targetId: "assistant", status: "running", startedAt: 3 });
    store.failStaleRunning("crashed");
    expect(store.getRun("r2")?.status).toBe("failed");
    expect(store.getRun("r2")?.error).toBe("crashed");
  });
});

describe("memoryDreamGate", () => {
  it("counts only progress records newer than the cutoff", () => {
    const home = tempHome();
    const dir = path.join(home, ".muse-work", "db", "issue-progress");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "i1.jsonl"),
      [
        JSON.stringify({ kind: "turn", at: 100 }),
        JSON.stringify({ kind: "status", at: 200 }),
        "",
      ].join("\n"),
    );
    expect(countIssueProgressSince(home, 150)).toBe(1);
    expect(countIssueProgressSince(home, 1000)).toBe(0);
  });

  it("ignores torn lines", () => {
    const home = tempHome();
    const dir = path.join(home, ".muse-work", "db", "issue-progress");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "i1.jsonl"),
      `${JSON.stringify({ at: 200 })}\n{"at": 30`,
    );
    expect(countIssueProgressSince(home, 150)).toBe(1);
  });

  it("detects memory files changed after the cutoff", () => {
    const dir = makeMemoryDir([{ name: "a.md" }]);
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(path.join(dir, "a.md"), old, old);
    expect(listChangedMemoryFiles(dir, Date.now() - 10 * 60 * 1000)).toEqual([]);
    fs.writeFileSync(path.join(dir, "MEMORY.md"), "# Memory\n", "utf-8");
    expect(
      listChangedMemoryFiles(dir, Date.now() - 10 * 60 * 1000),
    ).toContain("MEMORY.md");
  });

  it("forces since=0 when a full rerun is requested", () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    const target = store.ensureAssistantTarget("/full-rerun");
    const dir = makeMemoryDir([{ name: "a.md" }]);
    const now = Date.now();
    const result = evaluateDreamGate({
      home,
      target: {
        ...target,
        lastRunAt: now,
        lastAttemptAt: now,
        withIssueProgress: false,
        fullRerun: true,
      },
      memoryDir: dir,
      now,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.since).toBe(0);
  });

  it("runs the assistant target when its transcript is newer than the cutoff", () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    const workdir = "/assistant-activity";
    const target = store.ensureAssistantTarget(workdir);
    const dir = makeMemoryDir([{ name: "a.md" }]);
    const now = Date.now();
    const transcriptDir = path.join(
      home,
      ".muse-work",
      "projects",
      pathEncoder.encodeSync(workdir),
    );
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(
      path.join(transcriptDir, "assistant.jsonl"),
      JSON.stringify({ type: "metadata", workdir }) + "\n",
      "utf-8",
    );

    const result = evaluateDreamGate({
      home,
      target: { ...target, lastRunAt: now - 60_000, withIssueProgress: false },
      memoryDir: dir,
      now,
    });
    expect(result.shouldRun).toBe(true);
    expect(result.assistantActivity).toBe(true);
  });

  it("runs on memory change, on issue progress for the assistant, and skips otherwise", () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    const target = store.ensureAssistantTarget("/assistant");
    const dir = makeMemoryDir([{ name: "a.md" }]);
    const now = Date.now();

    // Nothing changed and no progress: skip.
    const none = evaluateDreamGate({
      home,
      target: { ...target, lastRunAt: now - 60_000, withIssueProgress: false },
      memoryDir: dir,
      now,
    });
    expect(none.shouldRun).toBe(false);
    expect(none.skipReason).toBe("no_change");

    // Issue progress alone triggers the assistant target.
    const progressDir = path.join(home, ".muse-work", "db", "issue-progress");
    fs.mkdirSync(progressDir, { recursive: true });
    fs.writeFileSync(
      path.join(progressDir, "i1.jsonl"),
      JSON.stringify({ kind: "turn", at: now }) + "\n",
    );
    const viaIssue = evaluateDreamGate({
      home,
      target: { ...target, lastRunAt: now - 60_000 },
      memoryDir: dir,
      now,
    });
    expect(viaIssue.shouldRun).toBe(true);
    expect(viaIssue.issueProgress).toBe(1);
  });

  it("clamps the cutoff to the last successful run in the last seven days", () => {
    const now = Date.now();
    const target = {
      id: "assistant",
      kind: "assistant" as const,
      workdir: "/a",
      label: "a",
      enabled: true,
      mode: "auto" as const,
      cadence: "daily" as const,
      withIssueProgress: true,
      consecutiveFailures: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    expect(dreamCutoff(target, now)).toBeLessThanOrEqual(now - 23 * 60 * 60 * 1000);
    const recent = dreamCutoff({ ...target, lastRunAt: now - 60_000 }, now);
    expect(recent).toBe(now - 60_000);
  });
});

describe("memoryDreamLint", () => {
  it("passes a clean store and reports its shape", () => {
    const dir = makeMemoryDir([{ name: "a.md" }, { name: "b.md" }]);
    const lint = lintMemoryDir(dir);
    expect(lint.ok).toBe(true);
    expect(lint.files).toBe(2);
    expect(lint.orphans).toBe(0);
    expect(lint.indexChars).toBeGreaterThan(0);
  });

  it("catches orphans, dangling links, oversize files, bad type and duplicates", () => {
    const dir = makeMemoryDir([{ name: "a.md" }]);
    writeMemory(dir, "orphan.md", "not indexed");
    fs.appendFileSync(
      path.join(dir, "MEMORY.md"),
      "- [gone](gone.md) — dangling\n",
      "utf-8",
    );
    writeMemory(dir, "big.md", "big", "feedback", "x".repeat(5000));
    writeMemory(dir, "badtype.md", "bad", "nope");
    writeMemory(dir, "dup.md", "about a.md");

    const lint = lintMemoryDir(dir);
    expect(lint.ok).toBe(false);
    expect(lint.dangling).toContain("gone.md");
    expect(lint.orphanFiles).toEqual(
      expect.arrayContaining(["orphan.md", "big.md", "badtype.md", "dup.md"]),
    );
    expect(lint.overCap).toContain("big.md");
    expect(lint.badType).toContain("badtype.md");
    expect(lint.duplicateDescriptions.length).toBeGreaterThan(0);
  });

  it("flags a missing index", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-mem-"));
    writeMemory(dir, "a.md", "a");
    expect(lintMemoryDir(dir).ok).toBe(false);
    expect(lintMemoryDir(dir).indexMissing).toBe(true);
  });
});

describe("memoryDreamApplier", () => {
  it("backs up, swaps and reports stats", () => {
    const live = makeMemoryDir([{ name: "a.md" }, { name: "b.md" }]);
    const draft = makeMemoryDir([{ name: "ab.md", description: "merged" }]);
    const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "muse-bak-"));

    const result = applyDream({
      memoryDir: live,
      draftDir: draft,
      backupRoot,
      targetId: "assistant",
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(live, "ab.md"))).toBe(true);
    expect(fs.existsSync(path.join(live, "a.md"))).toBe(false);
    expect(result.backupPath && fs.existsSync(result.backupPath)).toBe(true);
    expect(listBackups(backupRoot, "assistant")).toHaveLength(1);
  });

  it("refuses a draft that fails lint and leaves the live store untouched", () => {
    const live = makeMemoryDir([{ name: "a.md" }]);
    const draft = makeMemoryDir([{ name: "a.md" }]);
    writeMemory(draft, "big.md", "big", "feedback", "x".repeat(5000));
    const before = fs.readFileSync(path.join(live, "a.md"), "utf-8");
    const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "muse-bak-"));

    const result = applyDream({
      memoryDir: live,
      draftDir: draft,
      backupRoot,
      targetId: "assistant",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("draft_lint");
    expect(fs.readFileSync(path.join(live, "a.md"), "utf-8")).toBe(before);
  });

  it("restores a backup and backs up the current state first", () => {
    const live = makeMemoryDir([{ name: "a.md" }]);
    const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "muse-bak-"));
    const backup = path.join(backupRoot, "assistant", "old");
    fs.mkdirSync(backup, { recursive: true });
    writeMemory(backup, "old.md", "old");
    fs.writeFileSync(path.join(backup, "MEMORY.md"), "# Old\n- [old](old.md) — old\n");

    const result = rollbackMemoryDir({
      memoryDir: live,
      backupPath: backup,
      backupRoot,
      targetId: "assistant",
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(live, "old.md"))).toBe(true);
    expect(fs.existsSync(path.join(live, "a.md"))).toBe(false);
  });
});

describe("memoryDreamSchedule", () => {
  function target(id: string, overrides: Partial<MemoryDreamTarget> = {}): MemoryDreamTarget {
    return {
      id,
      kind: id === "assistant" ? "assistant" : "project",
      workdir: `/w/${id}`,
      label: id,
      enabled: true,
      mode: "draft",
      cadence: "daily",
      withIssueProgress: id === "assistant",
      consecutiveFailures: 0,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  it("skips unchanged targets and keeps the skip reason", () => {
    const home = tempHome();
    const dir = makeMemoryDir([{ name: "a.md" }]);
    const plan = planDreams({
      home,
      targets: [target("a")],
      now: Date.now(),
      memoryDirFor: () => dir,
    });
    expect(plan.run).toHaveLength(0);
    expect(plan.skipped[0].skipReason).toBe("no_change");
  });

  it("runs a changed target", () => {
    const home = tempHome();
    const dir = makeMemoryDir([{ name: "a.md" }]);
    fs.writeFileSync(path.join(dir, "NEW.md"), "x");
    writeMemory(dir, "b.md", "b");
    const plan = planDreams({
      home,
      targets: [target("a")],
      now: Date.now(),
      memoryDirFor: () => dir,
    });
    expect(plan.run.map((item) => item.target.id)).toEqual(["a"]);
  });

  it("orders by oldest run and enforces the nightly budget", () => {
    const home = tempHome();
    const dir = makeMemoryDir([{ name: "a.md" }]);
    fs.writeFileSync(path.join(dir, "NEW.md"), "x");
    writeMemory(dir, "b.md", "b");
    const now = Date.now();
    const plan = planDreams({
      home,
      targets: [
        target("newer", { lastRunAt: now - 1000 }),
        target("older", { lastRunAt: now - 5000 }),
        target("oldest", { lastRunAt: now - 9000 }),
      ],
      now,
      memoryDirFor: () => dir,
      maxRuns: 2,
    });
    expect(plan.run.map((item) => item.target.id)).toEqual(["oldest", "older"]);
    expect(plan.skipped.find((item) => item.target.id === "newer")?.skipReason).toBe(
      "budget",
    );
  });

  it("force-runs a weekly target that has not run for seven days", () => {
    const home = tempHome();
    const dir = makeMemoryDir([{ name: "a.md" }]);
    const now = Date.now();
    const plan = planDreams({
      home,
      targets: [target("w", { cadence: "weekly", lastRunAt: now - 8 * 24 * 60 * 60 * 1000 })],
      now,
      memoryDirFor: () => dir,
    });
    expect(plan.run).toHaveLength(1);
    expect(plan.run[0].forcedWeekly).toBe(true);
  });
});

describe("memoryDreamEngine", () => {
  function setup(options?: { transcripts?: number; since?: number }) {
    const home = tempHome();
    const workdir = path.join(home, "assistant-chat");
    fs.mkdirSync(workdir, { recursive: true });
    const memoryDirFor = (dir: string) =>
      path.join(home, ".muse-work", "projects", pathEncoder.encodeSync(dir), "memory");
    const memoryDir = memoryDirFor(workdir);
    fs.mkdirSync(memoryDir, { recursive: true });
    writeMemory(memoryDir, "a.md", "alpha");
    fs.writeFileSync(
      path.join(memoryDir, "MEMORY.md"),
      "# Memory\n\n- [alpha](a.md) — alpha\n",
      "utf-8",
    );

    const now = Date.now();
    const since = options?.since ?? now - 60 * 60 * 1000;
    const transcriptDir = path.join(
      home,
      ".muse-work",
      "projects",
      pathEncoder.encodeSync(workdir),
    );
    fs.mkdirSync(transcriptDir, { recursive: true });
    const count = options?.transcripts ?? 1;
    for (let index = 0; index < count; index += 1) {
      fs.writeFileSync(
        path.join(transcriptDir, `s${index}.jsonl`),
        [
          JSON.stringify({ type: "metadata", workdir }),
          JSON.stringify({
            timestamp: new Date(now - 30 * 60 * 1000).toISOString(),
            role: "user",
            blocks: [{ type: "text", content: "hello" }],
          }),
          JSON.stringify({
            timestamp: new Date(now - 30 * 60 * 1000).toISOString(),
            role: "assistant",
            blocks: [{ type: "text", content: "world" }],
          }),
          "",
        ].join("\n"),
        "utf-8",
      );
    }

    const order: string[] = [];
    const created: Array<{
      id: string;
      title?: string;
      systemPrompt?: string;
      model?: string;
    }> = [];
    const sessions = {
      create(input: {
        title?: string;
        systemPrompt?: string;
        workdir: string;
        model?: string;
      }) {
        const session = { id: `s-${created.length + 1}`, ...input };
        created.push(session);
        return session;
      },
      list() {
        return [{ id: "assistant", origin: "assistant", workdir }];
      },
    } as unknown as SessionStore;

    let engine: ReturnType<typeof createMemoryDreamEngine>;
    const runner = {
      async sendMessage(sessionId: string) {
        const session = created.find((item) => item.id === sessionId);
        order.push(session?.title?.includes("汇总") ? "organizer" : "analyzer");
        queueMicrotask(() => engine.handleTurnSettled(sessionId, { ok: true }));
        return { accepted: true as const };
      },
      async abortMessage() {
        return { ok: true as const };
      },
      async getMessages() {
        return [
          { role: "assistant", blocks: [{ type: "text", content: "summary" }] },
        ];
      },
      async disposeSession() {},
    } as unknown as SessionRunner;

    engine = createMemoryDreamEngine({
      home,
      sessions,
      runner,
      draftRoot: path.join(home, "dreams"),
      memoryDirFor,
    });

    return {
      home,
      workdir,
      memoryDir,
      since,
      order,
      created,
      engine,
      target: {
        id: "assistant",
        kind: "assistant" as const,
        workdir,
        label: "助手记忆",
        enabled: true,
        mode: "auto" as const,
        cadence: "daily" as const,
        withIssueProgress: true,
        consecutiveFailures: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    };
  }

  it("runs one analyzer per transcript then one organizer", async () => {
    const ctx = setup({ transcripts: 2 });
    const result = await ctx.engine.run({
      target: ctx.target,
      runId: "run-1",
      since: ctx.since,
    });
    expect(result.transcripts).toBe(2);
    expect(ctx.order).toEqual(["analyzer", "analyzer", "organizer"]);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(result.draftDir, "DREAM.md"))).toBe(true);
    expect(fs.existsSync(path.join(result.draftDir, "memory", "a.md"))).toBe(true);
    expect(result.summaries).toHaveLength(3);
  });

  it("ignores transcripts older than the cutoff and still runs the organizer", async () => {
    const ctx = setup({ transcripts: 0 });
    const result = await ctx.engine.run({
      target: ctx.target,
      runId: "run-2",
      since: Date.now() + 60_000,
    });
    expect(result.transcripts).toBe(0);
    expect(ctx.order).toEqual(["organizer"]);
    expect(result.ok).toBe(true);
  });

  it("uses the target's model for dream sessions", async () => {
    const ctx = setup({ transcripts: 1 });
    await ctx.engine.run({
      target: { ...ctx.target, model: "deepseek-v4-pro" },
      runId: "run-model",
      since: ctx.since,
    });
    expect(ctx.created.every((session) => session.model === "deepseek-v4-pro")).toBe(
      true,
    );
  });

  it("keeps going when an analyzer fails", async () => {
    const ctx = setup({ transcripts: 2 });
    let calls = 0;
    let localEngine: ReturnType<typeof createMemoryDreamEngine> | undefined;
    const runner = {
      async sendMessage(sessionId: string) {
        calls += 1;
        if (calls === 1) {
          throw new Error("boom");
        }
        queueMicrotask(() => localEngine?.handleTurnSettled(sessionId, { ok: true }));
        return { accepted: true as const };
      },
      async abortMessage() {
        return { ok: true as const };
      },
      async getMessages() {
        return [{ role: "assistant", blocks: [{ type: "text", content: "ok" }] }];
      },
      async disposeSession() {},
    } as unknown as SessionRunner;

    const engine = createMemoryDreamEngine({
      home: ctx.home,
      sessions: {
        create: () => ({ id: `x-${calls}` }),
        list: () => [],
      } as unknown as SessionStore,
      runner,
      draftRoot: path.join(ctx.home, "dreams2"),
      memoryDirFor: (dir) =>
        path.join(ctx.home, ".muse-work", "projects", pathEncoder.encodeSync(dir), "memory"),
    });
    localEngine = engine;

    const result = await engine.run({
      target: ctx.target,
      runId: "run-3",
      since: ctx.since,
    });
    expect(result.ok).toBe(true);
    expect(result.summaries.length).toBeGreaterThan(0);
  });
});

describe("memoryDreamScheduler", () => {
  function setup(options?: { hour?: number; enabled?: boolean }) {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    if (options?.enabled !== false) store.setEnabled(true);
    const target = store.ensureAssistantTarget("/assistant");
    const dir = makeMemoryDir([{ name: "a.md" }]);
    // A fresh write makes the gate see a change.
    fs.writeFileSync(path.join(dir, "NEW.md"), "x");
    writeMemory(dir, "b.md", "b");
    const runs: string[] = [];
    const engine = {
      async run(input: { runId: string }) {
        runs.push(input.runId);
        return {
          ok: true,
          draftDir: `/drafts/${input.runId}`,
          transcripts: 1,
          summaries: ["done"],
          stats: { files: 2, orphans: 0, indexChars: 20 },
        };
      },
      handleTurnSettled() {},
    } as unknown as DreamEngine;
    const scheduler = createMemoryDreamScheduler({
      home,
      store,
      engine,
      memoryDirFor: () => dir,
      draftRoot: path.join(home, "dreams"),
      now: () => new Date(2026, 10, 20, 4, 0, 0),
      hour: options?.hour ?? 3,
    });
    return { home, store, target, dir, runs, scheduler };
  }

  it("runs due targets once and records the result", async () => {
    const ctx = setup();
    await ctx.scheduler.tick();
    expect(ctx.runs).toHaveLength(1);
    const runs = ctx.store.listRuns("assistant");
    expect(runs[0]?.status).toBe("succeeded");
    expect(runs[0]?.draftDir).toBe(
      path.join(ctx.home, "dreams", "assistant", runs[0].id),
    );
    expect(ctx.store.getTarget("assistant")?.lastStatus).toBe("succeeded");
    expect(ctx.store.getTarget("assistant")?.lastRunAt).toBeTruthy();
  });

  it("does not run twice in the same local day", async () => {
    const ctx = setup();
    await ctx.scheduler.tick();
    await ctx.scheduler.tick();
    expect(ctx.runs).toHaveLength(1);
  });

  it("does nothing while the feature is disabled", async () => {
    const ctx = setup({ enabled: false });
    await ctx.scheduler.tick();
    expect(ctx.runs).toHaveLength(0);
  });

  it("waits for the weekly cadence instead of running daily", async () => {
    const ctx = setup();
    ctx.store.patchTarget("assistant", {
      cadence: "weekly",
      lastRunAt: new Date(2026, 10, 18, 4, 0, 0).getTime(),
      lastAttemptAt: new Date(2026, 10, 19, 3, 0, 1).getTime(),
    });
    await ctx.scheduler.tick();
    expect(ctx.runs).toHaveLength(0);
  });

  it("skips an on-demand run when neither memory nor transcript changed", async () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    store.setEnabled(true);
    const target = store.ensureAssistantTarget("/assistant");
    const dir = makeMemoryDir([{ name: "a.md" }]);
    store.patchTarget(target.id, { lastRunAt: Date.now() });
    let calls = 0;
    const scheduler = createMemoryDreamScheduler({
      home,
      store,
      engine: {
        async run() {
          calls += 1;
          return {
            ok: true,
            draftDir: "/unused",
            transcripts: 1,
            summaries: [],
          };
        },
        handleTurnSettled() {},
      } as unknown as DreamEngine,
      memoryDirFor: () => dir,
      draftRoot: path.join(home, "dreams"),
      now: () => new Date(),
    });

    const run = await scheduler.runNow("assistant");
    expect(run?.status).toBe("skipped");
    expect(run?.skipReason).toBe("no_progress");
    expect(calls).toBe(0);
  });

  it("auto-adopts scheduled drafts when the target mode is auto", async () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    store.setEnabled(true);
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-auto-"));
    const target = store.ensureAssistantTarget(workdir);
    const liveMemory = makeMemoryDir([{ name: "a.md" }]);
    const draftRoot = path.join(home, "dreams");
    const engine = {
      async run(input: { runId: string }) {
        const draftDir = dreamDraftDir(draftRoot, target.id, input.runId);
        fs.cpSync(liveMemory, path.join(draftDir, "memory"), { recursive: true });
        fs.mkdirSync(path.join(draftDir, "skills", "progress-review"), { recursive: true });
        fs.writeFileSync(
          path.join(draftDir, "skills", "progress-review", "SKILL.md"),
          "---\nname: progress-review\ndescription: Use when reviewing.\n---\n\n## 步骤\n1. 做\n",
        );
        fs.writeFileSync(
          path.join(draftDir, "skills", "progress-review", "meta.json"),
          JSON.stringify({ name: "progress-review", description: "Use when reviewing.", action: "create" }),
        );
        fs.mkdirSync(path.join(draftDir, "rules"), { recursive: true });
        fs.writeFileSync(
          path.join(draftDir, "rules", "report-timing.md"),
          "---\nname: report-timing\ndescription: timing\n---\n\nOnly report when blocked.",
        );
        fs.writeFileSync(
          path.join(draftDir, "rules", "report-timing.json"),
          JSON.stringify({ name: "report-timing", description: "timing", text: "Only report when blocked.", occurrenceDays: 2 }),
        );
        return { ok: true, draftDir, transcripts: 1, summaries: [] };
      },
      handleTurnSettled() {},
    } as unknown as DreamEngine;
    const scheduler = createMemoryDreamScheduler({
      home,
      store,
      engine,
      memoryDirFor: () => liveMemory,
      draftRoot,
      now: () => new Date(2026, 10, 24, 4, 0, 0),
      hour: 4,
    });
    await scheduler.tick();
    expect(fs.existsSync(path.join(liveMemory, "MEMORY.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillRootForWorkdir(workdir), "progress-review", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(ruleRootForWorkdir(workdir), "auto-report-timing.md"))).toBe(true);
    expect(store.listRuns("assistant")[0]?.autoAdoptedAt).toBeTruthy();
  });

  it("runs on demand regardless of the schedule", async () => {
    const ctx = setup({ enabled: true });
    const run = await ctx.scheduler.runNow("assistant");
    expect(run?.status).toBe("succeeded");
    expect(ctx.runs).toHaveLength(1);
  });
});

describe("memoryDreamAdopt", () => {
  function setup() {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    store.setEnabled(true);
    store.ensureAssistantTarget("/assistant");
    const live = makeMemoryDir([{ name: "a.md" }]);
    const runId = "run-adopt";
    const draftDir = path.join(home, "dreams", "drafts", "assistant", runId);
    fs.mkdirSync(path.join(draftDir, "memory"), { recursive: true });
    const draftMemory = path.join(draftDir, "memory");
    writeMemory(draftMemory, "merged.md", "merged");
    fs.writeFileSync(
      path.join(draftMemory, "MEMORY.md"),
      "# Memory\n\n- [merged](merged.md) — merged\n",
    );
    store.addRun({
      id: runId,
      targetId: "assistant",
      status: "succeeded",
      trigger: "manual",
      startedAt: 1,
      endedAt: 2,
      draftDir,
    });
    return { home, store, live, runId, draftDir, draftMemory };
  }

  it("adopts a successful draft into live memory with a backup", () => {
    const ctx = setup();
    const outcome = adoptDreamRun({
      store: ctx.store,
      runId: ctx.runId,
      backupRoot: path.join(ctx.home, "backups"),
      memoryDirFor: () => ctx.live,
    });
    expect(outcome.ok).toBe(true);
    expect(fs.existsSync(path.join(ctx.live, "merged.md"))).toBe(true);
    expect(fs.existsSync(path.join(ctx.live, "a.md"))).toBe(false);
    expect(ctx.store.getRun(ctx.runId)?.adoptedAt).toBeTruthy();
  });

  it("refuses to adopt the same run twice", () => {
    const ctx = setup();
    adoptDreamRun({
      store: ctx.store,
      runId: ctx.runId,
      backupRoot: path.join(ctx.home, "backups"),
      memoryDirFor: () => ctx.live,
    });
    const second = adoptDreamRun({
      store: ctx.store,
      runId: ctx.runId,
      backupRoot: path.join(ctx.home, "backups"),
      memoryDirFor: () => ctx.live,
    });
    expect(second.ok).toBe(false);
  });

  it("refuses a draft that fails lint", () => {
    const ctx = setup();
    writeMemory(ctx.draftMemory, "big.md", "big", "feedback", "x".repeat(5000));
    const before = fs.readFileSync(path.join(ctx.live, "a.md"), "utf-8");
    const outcome = adoptDreamRun({
      store: ctx.store,
      runId: ctx.runId,
      backupRoot: path.join(ctx.home, "backups"),
      memoryDirFor: () => ctx.live,
    });
    expect(outcome.ok).toBe(false);
    expect(fs.readFileSync(path.join(ctx.live, "a.md"), "utf-8")).toBe(before);
  });

  it("refuses non-critical warnings unless the caller accepts them", () => {
    const ctx = setup();
    writeMemory(ctx.draftMemory, "big.md", "big", "feedback", "x".repeat(5000));
    fs.appendFileSync(
      path.join(ctx.draftMemory, "MEMORY.md"),
      "- [big](big.md) — big\n",
    );
    const refused = adoptDreamRun({
      store: ctx.store,
      runId: ctx.runId,
      backupRoot: path.join(ctx.home, "backups"),
      memoryDirFor: () => ctx.live,
    });
    expect(refused.ok).toBe(false);

    const accepted = adoptDreamRun({
      store: ctx.store,
      runId: ctx.runId,
      backupRoot: path.join(ctx.home, "backups"),
      memoryDirFor: () => ctx.live,
      allowWarnings: true,
    });
    expect(accepted.ok).toBe(true);
    expect(fs.existsSync(path.join(ctx.live, "big.md"))).toBe(true);
  });

  it("can adopt a failed run's draft once warnings are accepted", () => {
    const ctx = setup();
    ctx.store.patchRun(ctx.runId, { status: "failed", error: "draft index is unusable" });

    const refused = adoptDreamRun({
      store: ctx.store,
      runId: ctx.runId,
      backupRoot: path.join(ctx.home, "backups"),
      memoryDirFor: () => ctx.live,
    });
    expect(refused.ok).toBe(false);

    const accepted = adoptDreamRun({
      store: ctx.store,
      runId: ctx.runId,
      backupRoot: path.join(ctx.home, "backups"),
      memoryDirFor: () => ctx.live,
      allowWarnings: true,
    });
    expect(accepted.ok).toBe(true);
    expect(fs.existsSync(path.join(ctx.live, "merged.md"))).toBe(true);
  });

  it("still refuses a dangling index even when warnings are accepted", () => {
    const ctx = setup();
    fs.appendFileSync(
      path.join(ctx.draftMemory, "MEMORY.md"),
      "- [gone](gone.md) — dangling\n",
    );
    const outcome = adoptDreamRun({
      store: ctx.store,
      runId: ctx.runId,
      backupRoot: path.join(ctx.home, "backups"),
      memoryDirFor: () => ctx.live,
      allowWarnings: true,
    });
    expect(outcome.ok).toBe(false);
  });

  it("discards the draft but keeps the run record", () => {
    const ctx = setup();
    expect(discardDreamRun({ store: ctx.store, runId: ctx.runId })).toBe(true);
    expect(fs.existsSync(ctx.draftDir)).toBe(false);
    expect(ctx.store.getRun(ctx.runId)?.discardedAt).toBeTruthy();
  });

  it("rolls back to a listed backup", () => {
    const ctx = setup();
    const backupRoot = path.join(ctx.home, "backups");
    const outcome = adoptDreamRun({
      store: ctx.store,
      runId: ctx.runId,
      backupRoot,
      memoryDirFor: () => ctx.live,
    });
    expect(outcome.ok).toBe(true);
    const backups = listDreamBackups({
      store: ctx.store,
      backupRoot,
      targetId: "assistant",
    });
    expect(backups.length).toBeGreaterThan(0);

    const rolled = rollbackDream({
      store: ctx.store,
      targetId: "assistant",
      backupPath: backups[0],
      backupRoot,
      memoryDirFor: () => ctx.live,
    });
    expect(rolled.ok).toBe(true);
    expect(fs.existsSync(path.join(ctx.live, "a.md"))).toBe(true);
  });
});

describe("memoryDreamIndex", () => {
  it("lists important entries directly and archives the overflow", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-index-"));
    // 120 files across a few real topics plus many singletons.
    for (let i = 0; i < 120; i += 1) {
      const topic = i < 60 ? `review${i}` : `misc${i}`;
      writeMemory(dir, `feedback_${topic}.md`, `rule ${i}`);
    }
    fs.writeFileSync(path.join(dir, "MEMORY.md"), "# Memory\n");
    const rebuilt = rebuildFlatIndex(dir);
    const lint = lintMemoryDir(dir);
    expect(rebuilt.direct + rebuilt.archived).toBe(120);
    expect(rebuilt.direct).toBeGreaterThan(0);
    expect(lint.orphans).toBe(0);
    expect(lint.indexLines).toBeLessThanOrEqual(200);
    expect(lint.indexChars).toBeLessThanOrEqual(22_000);
    expect(lint.ok).toBe(true);
    const index = fs.readFileSync(path.join(dir, "MEMORY.md"), "utf-8");
    if (rebuilt.archived > 0) expect(index).toContain("archive.md");
  });
});

describe("memoryDreamEngine index ownership", () => {
  function setup(
    files: (dir: string) => void,
    handlers: {
      onRepair?: (dir: string) => void;
      onOrganizer?: (dir: string) => void;
    } = {},
  ) {
    const home = tempHome();
    const workdir = path.join(home, "assistant-chat");
    fs.mkdirSync(workdir, { recursive: true });
    const memoryDirFor = (dir: string) =>
      path.join(home, ".muse-work", "projects", pathEncoder.encodeSync(dir), "memory");
    const mem = memoryDirFor(workdir);
    fs.mkdirSync(mem, { recursive: true });
    writeMemory(mem, "a.md", "alpha");
    fs.writeFileSync(
      path.join(mem, "MEMORY.md"),
      "# Memory\n\n- [alpha](a.md) — alpha\n",
    );
    files(mem);

    const created: Array<{ id: string; title?: string; systemPrompt?: string }> = [];
    let repairs = 0;
    const sessions = {
      create(input: { title?: string; systemPrompt?: string }) {
        const session = { id: `s-${created.length + 1}`, ...input };
        created.push(session);
        return session;
      },
      list: () => [],
    } as unknown as SessionStore;

    let engine: ReturnType<typeof createMemoryDreamEngine>;
    const dirOf = (systemPrompt: string | undefined) =>
      /记忆目录[^：]*：(\/[^。\s]+)/.exec(systemPrompt ?? "")?.[1];
    const runner = {
      async sendMessage(sessionId: string) {
        const session = created.find((item) => item.id === sessionId);
        if (session?.title?.includes("修复")) {
          repairs += 1;
          const dir = dirOf(session.systemPrompt);
          if (dir && handlers.onRepair) handlers.onRepair(dir);
        } else if (session?.title?.includes("汇总")) {
          const dir = dirOf(session.systemPrompt);
          if (dir && handlers.onOrganizer) handlers.onOrganizer(dir);
        }
        queueMicrotask(() => engine.handleTurnSettled(sessionId, { ok: true }));
        return { accepted: true as const };
      },
      async abortMessage() {
        return { ok: true as const };
      },
      async getMessages() {
        return [{ role: "assistant", blocks: [{ type: "text", content: "ok" }] }];
      },
      async disposeSession() {},
    } as unknown as SessionRunner;

    engine = createMemoryDreamEngine({
      home,
      sessions,
      runner,
      draftRoot: path.join(home, "dreams"),
      memoryDirFor,
    });
    const draftMemory = path.join(home, "dreams", "assistant", "run-index", "memory");
    const run = () =>
      engine.run({
        target: {
          id: "assistant",
          kind: "assistant",
          workdir,
          label: "助手记忆",
          enabled: true,
          mode: "auto",
          cadence: "daily",
          withIssueProgress: true,
          consecutiveFailures: 0,
          createdAt: 0,
          updatedAt: 0,
        },
        runId: "run-index",
        since: Date.now(),
      });
    return { mem, draftMemory, run, repairs: () => repairs };
  }

  it("accepts an index the AI wrote itself", async () => {
    const ctx = setup(
      (mem) => {
        writeMemory(mem, "o1.md", "orphan one");
        writeMemory(mem, "o2.md", "orphan two");
      },
      {
        onOrganizer: (dir) => {
          fs.appendFileSync(
            path.join(dir, "MEMORY.md"),
            "- [orphan one](o1.md) — orphan one\n- [orphan two](o2.md) — orphan two\n",
          );
        },
      },
    );
    const result = await ctx.run();
    expect(result.ok).toBe(true);
    expect(result.fallbackIndex).toBe(false);
    expect(ctx.repairs()).toBe(0);
    expect(result.lint?.orphans).toBe(0);
  });

  it("rebuilds mechanically when the AI leaves orphans, and says so", async () => {
    const ctx = setup((mem) => {
      writeMemory(mem, "o1.md", "orphan one");
      writeMemory(mem, "o2.md", "orphan two");
    });
    const result = await ctx.run();
    expect(result.ok).toBe(true);
    expect(result.fallbackIndex).toBe(true);
    expect(ctx.repairs()).toBeGreaterThanOrEqual(1);
    expect(result.lint?.orphans).toBe(0);
    const index = fs.readFileSync(
      path.join(ctx.draftMemory, "MEMORY.md"),
      "utf-8",
    );
    expect(index).toContain("o1.md");
  });

  it("archives overflow when the model leaves a huge store unindexed", async () => {
    const ctx = setup((mem) => {
      for (let i = 0; i < 220; i += 1) {
        writeMemory(
          mem,
          `ref_${i}.md`,
          `reference note ${i} with enough detail to take index space and push the entrypoint over budget`,
          "reference",
        );
      }
    });
    const result = await ctx.run();
    expect(result.ok).toBe(true);
    expect(result.fallbackIndex).toBe(true);
    expect(result.fallbackArchived).toBeGreaterThan(0);
    expect(result.lint?.orphans).toBe(0);
    expect(result.lint?.indexChars ?? Infinity).toBeLessThanOrEqual(22_000);
    expect(fs.existsSync(path.join(ctx.draftMemory, "archive.md"))).toBe(true);
    const index = fs.readFileSync(
      path.join(ctx.draftMemory, "MEMORY.md"),
      "utf-8",
    );
    expect(index).toContain("archive.md");
  });

  it("still runs a repair pass when frontmatter is invalid", async () => {
    const ctx = setup(
      (mem) => {
        fs.writeFileSync(
          path.join(mem, "bad.md"),
          "---\nname: bad\ndescription: bad type\ntype: nope\n---\n\n- rule\n",
        );
      },
      {
        onRepair: (dir) => {
          fs.writeFileSync(
            path.join(dir, "bad.md"),
            "---\nname: bad\ndescription: bad type\ntype: feedback\n---\n\n- rule\n",
          );
          fs.appendFileSync(
            path.join(dir, "MEMORY.md"),
            "- [bad](bad.md) — bad type\n",
          );
        },
      },
    );
    const result = await ctx.run();
    expect(ctx.repairs()).toBe(1);
    expect(result.ok).toBe(true);
    expect(result.fallbackIndex).toBe(false);
    expect(result.lint?.badType).toEqual([]);
  });
});

describe("discardDreamRun learning rewind", () => {
  it("restores the pre-run cursor, observations and lastRunAt", () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    store.ensureAssistantTarget("/assistant");
    store.patchTarget("assistant", { lastRunAt: 200, lastStatus: "succeeded" });
    const draftDir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-discard-"));
    const before = { version: 1 as const, transcripts: { old: { inode: 1, offset: 10, size: 10, mtimeMs: 1 } } };
    const after = { version: 1 as const, transcripts: { old: { inode: 1, offset: 20, size: 20, mtimeMs: 2 } } };
    fs.writeFileSync(
      path.join(draftDir, "skill-cursors.before.json"),
      JSON.stringify(before),
      "utf-8",
    );
    fs.mkdirSync(path.dirname(cursorsPath(home)), { recursive: true });
    fs.writeFileSync(cursorsPath(home), JSON.stringify(after), "utf-8");
    fs.writeFileSync(
      observationsPath(home),
      `${JSON.stringify({ runId: "run-discard", day: "2026-11-24" })}\n${JSON.stringify({ runId: "other", day: "2026-11-24" })}\n`,
      "utf-8",
    );
    const run = store.addRun({
      id: "run-discard",
      targetId: "assistant",
      status: "succeeded",
      startedAt: 100,
      endedAt: 200,
      previousLastRunAt: 100,
      draftDir,
    });

    expect(discardDreamRun({ store, runId: run.id, home })).toBe(true);
    expect(store.getTarget("assistant")?.lastRunAt).toBe(100);
    expect(JSON.parse(fs.readFileSync(cursorsPath(home), "utf-8"))).toEqual(before);
    const obs = fs.readFileSync(observationsPath(home), "utf-8");
    expect(obs).not.toContain("run-discard");
    expect(obs).toContain("other");
    expect(fs.existsSync(draftDir)).toBe(false);
  });

  it("drops the shared skill cursor when the draft has no pre-run snapshot", () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    store.ensureAssistantTarget("/assistant");
    const draftDir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-discard-nosnap-"));
    fs.mkdirSync(path.dirname(cursorsPath(home)), { recursive: true });
    fs.writeFileSync(
      cursorsPath(home),
      JSON.stringify({ version: 1, transcripts: { old: { inode: 1, offset: 20, size: 20, mtimeMs: 2 } } }),
      "utf-8",
    );
    const run = store.addRun({
      id: "run-nosnap",
      targetId: "assistant",
      status: "failed",
      startedAt: 100,
      endedAt: 200,
      draftDir,
    });

    expect(discardDreamRun({ store, runId: run.id, home })).toBe(true);
    expect(fs.existsSync(cursorsPath(home))).toBe(false);
  });

  it("refuses to discard an older or running run while a newer one is alive", () => {
    const home = tempHome();
    const store = createMemoryDreamStore({ home });
    store.ensureAssistantTarget("/assistant");
    const older = store.addRun({
      id: "run-older",
      targetId: "assistant",
      status: "failed",
      startedAt: 100,
      endedAt: 200,
    });
    const running = store.addRun({
      id: "run-running",
      targetId: "assistant",
      status: "running",
      startedAt: 300,
    });
    expect(discardDreamRun({ store, runId: older.id, home })).toBe(false);
    expect(discardDreamRun({ store, runId: running.id, home })).toBe(false);
    expect(store.getRun(older.id)?.discardedAt).toBeUndefined();
    expect(store.getRun(running.id)?.discardedAt).toBeUndefined();

    store.patchRun(running.id, { status: "succeeded", endedAt: 400 });
    const newer = store.addRun({
      id: "run-newer",
      targetId: "assistant",
      status: "succeeded",
      startedAt: 500,
      endedAt: 600,
    });
    expect(discardDreamRun({ store, runId: older.id, home })).toBe(false);
    expect(discardDreamRun({ store, runId: newer.id, home })).toBe(true);
    expect(discardDreamRun({ store, runId: running.id, home })).toBe(true);
    expect(discardDreamRun({ store, runId: older.id, home })).toBe(true);
  });
});
