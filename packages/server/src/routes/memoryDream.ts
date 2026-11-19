import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveAutoMemoryDirectory } from "@muse-work/agent";
import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import {
  adoptDreamRun,
  discardDreamRun,
  listDreamBackups,
  rollbackDream,
} from "../services/memoryDreamAdopt.js";
import { defaultDreamBackupRoot } from "../services/memoryDreams.js";
import { lintMemoryDir } from "../services/memoryDreamLint.js";

/**
 * Backend for the settings page's "memory tidying" section.
 *
 * Deliberately small: enable/disable, read state, trigger a run by hand. The
 * nightly schedule is owned by the scheduler, not by this route.
 */
export const memoryDreamRoutes = new Hono<HonoEnv>();

memoryDreamRoutes.get("/memory-dream", (c) => {
  const ctx = c.get("ctx");
  const assistantWorkdir = ctx.store
    .list()
    .find((session) => session.origin === "assistant")?.workdir;
  if (assistantWorkdir) {
    ctx.memoryDreamStore.ensureAssistantTarget(assistantWorkdir);
  }
  return c.json({
    enabled: ctx.memoryDreamStore.isEnabled(),
    targets: ctx.memoryDreamStore.listTargets(),
    runs: ctx.memoryDreamStore.listRuns(undefined, 20).map((run) => ({
      ...run,
      draftReady: Boolean(
        run.draftDir && fs.existsSync(path.join(run.draftDir, "memory")),
      ),
      progress: readProgress(run.draftDir),
    })),
  });
});

memoryDreamRoutes.put("/memory-dream/enabled", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    enabled?: unknown;
  };
  if (typeof body.enabled !== "boolean") {
    return c.json({ error: "enabled must be a boolean" }, 400);
  }
  const ctx = c.get("ctx");
  if (body.enabled) {
    const assistantWorkdir = ctx.store
      .list()
      .find((session) => session.origin === "assistant")?.workdir;
    if (assistantWorkdir) {
      const target = ctx.memoryDreamStore.ensureAssistantTarget(assistantWorkdir);
      // Turning it on mid-day should not immediately fire a catch-up run; the
      // scheduler starts with the next 03:00. "立即整理" is the explicit path.
      ctx.memoryDreamStore.patchTarget(target.id, {
        lastAttemptAt: Date.now(),
      });
    }
  }
  ctx.memoryDreamStore.setEnabled(body.enabled);
  ctx.hub.broadcastAll({ type: "memory-dream:changed" });
  return c.json({ ok: true, enabled: body.enabled });
});

memoryDreamRoutes.put("/memory-dream/targets/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    model?: unknown;
  };
  if (body.model !== undefined && typeof body.model !== "string") {
    return c.json({ error: "model must be a string" }, 400);
  }
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  if (!ctx.memoryDreamStore.getTarget(id)) {
    return c.json({ error: "target not found" }, 404);
  }
  const target = ctx.memoryDreamStore.patchTarget(id, {
    model: typeof body.model === "string" ? body.model.trim() : undefined,
  });
  ctx.hub.broadcastAll({ type: "memory-dream:changed" });
  return c.json({ ok: true, target });
});

memoryDreamRoutes.post("/memory-dream/targets/:id/run", (c) => {
  const ctx = c.get("ctx");
  const target = ctx.memoryDreamStore.getTarget(c.req.param("id"));
  if (!target) return c.json({ error: "target not found" }, 404);
  if (ctx.memoryDreamStore.hasRunning(target.id)) {
    return c.json({ error: "target is already running" }, 409);
  }
  // A dream takes minutes; the run record carries the result.
  void ctx.memoryDreamScheduler.runNow(target.id).catch(() => {
    /* the run record already holds the failure */
  });
  return c.json({ ok: true, started: true });
});

memoryDreamRoutes.get("/memory-dream/targets/:id/runs", (c) => {
  const ctx = c.get("ctx");
  const limit = Number(c.req.query("limit") ?? "20");
  return c.json({
    runs: ctx.memoryDreamStore.listRuns(
      c.req.param("id"),
      Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
    ),
  });
});


memoryDreamRoutes.post("/memory-dream/runs/:id/adopt", async (c) => {
  const ctx = c.get("ctx");
  const body = (await c.req.json().catch(() => ({}))) as {
    allowWarnings?: unknown;
  };
  const outcome = adoptDreamRun({
    store: ctx.memoryDreamStore,
    runId: c.req.param("id"),
    backupRoot: defaultDreamBackupRoot(ctx.home),
    allowWarnings: body.allowWarnings === true,
  });
  if (!outcome.ok) {
    return c.json(
      {
        error: outcome.error,
        lint: outcome.lint,
        backupPath: outcome.backupPath,
      },
      422,
    );
  }
  ctx.hub.broadcastAll({ type: "memory-dream:changed" });
  return c.json(outcome);
});

memoryDreamRoutes.delete("/memory-dream/runs/:id", (c) => {
  const ctx = c.get("ctx");
  const discarded = discardDreamRun({
    store: ctx.memoryDreamStore,
    runId: c.req.param("id"),
  });
  if (!discarded) return c.json({ error: "run not found or adopted" }, 404);
  ctx.hub.broadcastAll({ type: "memory-dream:changed" });
  return c.json({ ok: true });
});

memoryDreamRoutes.get("/memory-dream/backups", (c) => {
  const ctx = c.get("ctx");
  const targetId = c.req.query("targetId") ?? "assistant";
  return c.json({
    backups: listDreamBackups({
      store: ctx.memoryDreamStore,
      backupRoot: defaultDreamBackupRoot(ctx.home),
      targetId,
    }),
  });
});

memoryDreamRoutes.post("/memory-dream/rollback", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    targetId?: unknown;
    backupPath?: unknown;
  };
  if (typeof body.targetId !== "string" || typeof body.backupPath !== "string") {
    return c.json({ error: "targetId and backupPath are required" }, 400);
  }
  const ctx = c.get("ctx");
  const outcome = rollbackDream({
    store: ctx.memoryDreamStore,
    targetId: body.targetId,
    backupPath: body.backupPath,
    backupRoot: defaultDreamBackupRoot(ctx.home),
  });
  if (!outcome.ok) {
    return c.json({ error: outcome.error, lint: outcome.lint }, 422);
  }
  ctx.hub.broadcastAll({ type: "memory-dream:changed" });
  return c.json(outcome);
});


interface DreamProgressView {
  phase: "copy" | "export" | "analyze" | "organize" | "lint" | "done";
  index?: number;
  total?: number;
  detail?: string;
  startedAt: number;
  updatedAt: number;
}

function readProgress(draftDir: string | undefined): DreamProgressView | undefined {
  if (!draftDir) return undefined;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(draftDir, "progress.json"), "utf-8"),
    ) as DreamProgressView;
  } catch {
    return undefined;
  }
}

interface MemoryFileMeta {
  file: string;
  bytes: number;
  type: string;
  name: string;
  description: string;
}

function readMemoryMeta(dir: string, file: string): MemoryFileMeta {
  const full = path.join(dir, file);
  let raw = "";
  try {
    raw = fs.readFileSync(full, "utf-8");
  } catch {
    return { file, bytes: 0, type: "", name: "", description: "" };
  }
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? "";
  const field = (key: string) =>
    new RegExp(`^${key}:\\s*(.*)$`, "m").exec(frontmatter)?.[1]?.trim() ?? "";
  return {
    file,
    bytes: Buffer.byteLength(raw, "utf-8"),
    type: field("type"),
    name: field("name"),
    description: field("description"),
  };
}

function countConflicts(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".md")) continue;
      const raw = fs.readFileSync(path.join(dir, entry), "utf-8");
      total += (raw.match(/\bCONFLICT\b/g) ?? []).length;
    }
  } catch {
    return 0;
  }
  return total;
}

function memoryFileHashes(dir: string): Map<string, string> {
  const hashes = new Map<string, string>();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return hashes;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, entry));
      hashes.set(entry, crypto.createHash("sha1").update(raw).digest("hex"));
    } catch {
      // Unreadable file: treat it as absent so the diff is conservative.
    }
  }
  return hashes;
}

memoryDreamRoutes.get("/memory-dream/runs/:id/report", (c) => {
  const ctx = c.get("ctx");
  const run = ctx.memoryDreamStore.getRun(c.req.param("id"));
  if (!run) return c.json({ error: "run not found" }, 404);
  const target = ctx.memoryDreamStore.getTarget(run.targetId);
  if (!target) return c.json({ error: "target not found" }, 404);
  if (!run.draftDir) return c.json({ error: "run has no draft" }, 404);

  const draftMemory = path.join(run.draftDir, "memory");
  const liveMemory = resolveAutoMemoryDirectory(target.workdir);
  const draft = memoryFileHashes(draftMemory);
  const live = memoryFileHashes(liveMemory);
  const draftLint = lintMemoryDir(draftMemory);
  const liveLint = lintMemoryDir(liveMemory);

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [file, hash] of draft) {
    if (!live.has(file)) added.push(file);
    else if (live.get(file) !== hash) changed.push(file);
  }
  for (const file of live.keys()) {
    if (!draft.has(file)) removed.push(file);
  }

  let report = "";
  try {
    report = fs.readFileSync(path.join(run.draftDir, "DREAM.md"), "utf-8");
  } catch {
    report = "";
  }

  return c.json({
    report,
    draftLint: {
      ok: draftLint.ok,
      orphans: draftLint.orphans,
      overCap: draftLint.overCap.length,
      dangling: draftLint.dangling.length,
      badFrontmatter: draftLint.badFrontmatter.length,
      badType: draftLint.badType.length,
      indexChars: draftLint.indexChars,
      indexLines: draftLint.indexLines,
    },
    liveLint: {
      ok: liveLint.ok,
      orphans: liveLint.orphans,
      overCap: liveLint.overCap.length,
      dangling: liveLint.dangling.length,
      indexChars: liveLint.indexChars,
      indexLines: liveLint.indexLines,
    },
    durationMs:
      run.endedAt && run.startedAt ? run.endedAt - run.startedAt : undefined,
    counts: {
      added: added.length,
      changed: changed.length,
      removed: removed.length,
      conflicts: countConflicts(draftMemory),
    },
    added: added.sort().map((file) => readMemoryMeta(draftMemory, file)),
    changed: changed.sort().map((file) => ({
      ...readMemoryMeta(draftMemory, file),
      beforeBytes: readMemoryMeta(liveMemory, file).bytes,
    })),
    removed: removed.sort().map((file) => readMemoryMeta(liveMemory, file)),
  });
});
