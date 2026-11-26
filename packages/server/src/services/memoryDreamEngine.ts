import fs from "node:fs";
import path from "node:path";
import { pathEncoder, resolveAutoMemoryDirectory } from "@muse-work/agent";
import { DEFAULT_ACTIVE_MODEL_ID, getMuseHomeDir } from "@muse-work/provider";
import type { SessionRunner } from "./sessionRunner/ctx.js";
import type { SessionStore } from "./sessionStore.js";
import {
  dreamDraftDir,
  type MemoryDreamTarget,
} from "./memoryDreams.js";
import {
  hasCriticalMemoryLint,
  lintMemoryDir,
  memoryDirStats,
  type MemoryLintResult,
} from "./memoryDreamLint.js";
import { rebuildFlatIndex } from "./memoryDreamIndex.js";
import { lastAssistantText } from "./issueDispatch.js";
import {
  buildAnalyzerSystemPrompt,
  buildAnalyzerTask,
  buildOrganizerSystemPrompt,
  buildOrganizerTask,
  buildRepairSystemPrompt,
  buildRepairTask,
} from "../prompts/memoryDream.js";
import {
  buildSkillExtractorPrompt,
  buildSkillExtractorTask,
  summarizeSkillDrafts,
} from "../prompts/skillDream.js";
import {
  appendRuleObservations,
  parseRuleCandidates,
  readAssistantRules,
  summarizeRuleDrafts,
  writeRuleDrafts,
  type RuleDraft,
} from "./ruleDream.js";
import {
  appendSkillObservations,
  cursorsPath,
  exportIncrementalSkillTranscripts,
  loadSkillCursors,
  loadSuppressed,
  suppressedPath,
  observationsPath,
  parseSkillCandidates,
  readAssistantSkills,
  readOptionalText,
  readRecentObservations,
  saveSkillCursors,
  skillRootForWorkdir,
  writeSkillDrafts,
  type SkillDraft,
} from "./skillDream.js";

/**
 * The dream engine: one analyzer per transcript (serial), then one organizer.
 *
 * It only ever writes a draft store under `<draftRoot>/<target>/<runId>/`.
 * Adoption is a separate, deterministic step (`memoryDreamApplier`) so an
 * unattended run can never rewrite live memory by itself.
 */

const DEFAULT_TURN_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
const MAX_TRANSCRIPTS_PER_RUN = 6;
const MAX_SESSIONS_PER_RUN = 12;
/** One initial pass plus this many repair passes, bounded by wall clock too. */
const MAX_REPAIR_PASSES = 2;
const MAX_RUN_DURATION_MS = 45 * 60 * 1000;
const INDEX_MAX_CHARS = 22_000;

const MEMORY_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];
const DENIED_TOOLS = ["Bash", "Workflow", "AskUserQuestion", "WebFetch", "WebSearch"];

export interface DreamProgress {
  phase: "copy" | "export" | "analyze" | "organize" | "repair" | "skills" | "lint" | "done";
  /** 1-based index for the analyze phase. */
  index?: number;
  total?: number;
  detail?: string;
  startedAt: number;
  updatedAt: number;
}

export interface DreamRunResult {
  ok: boolean;
  draftDir: string;
  transcripts: number;
  summaries: string[];
  /** True when the AI did not finish the index and code had to rebuild it. */
  fallbackIndex?: boolean;
  /** Files moved to archive.md by the mechanical fallback rebuild. */
  fallbackArchived?: number;
  stats?: ReturnType<typeof memoryDirStats>;
  lint?: MemoryLintResult;
  /** Assistant-only SOP drafts. Never written live by the engine. */
  skills?: ReturnType<typeof summarizeSkillDrafts>;
  /** Assistant-only always-on rule drafts. Never written live by the engine. */
  rules?: ReturnType<typeof summarizeRuleDrafts>;
  /** Best-effort skill pass failure; the memory draft can still be usable. */
  skillError?: string;
  error?: string;
}

export interface DreamEngine {
  run(input: {
    target: MemoryDreamTarget;
    runId: string;
    /** Only transcripts/memory since this timestamp take part. */
    since: number;
  }): Promise<DreamRunResult>;
  /** Wire into the runner's single turn-settled callback. */
  handleTurnSettled(sessionId: string, result: { ok: boolean; error?: string }): void;
}

interface PendingTurn {
  resolve: (result: { ok: boolean; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createMemoryDreamEngine(options: {
  home: string;
  sessions: SessionStore;
  runner: SessionRunner;
  draftRoot: string;
  model?: string;
  /** Override for tests / custom homes; defaults to the agent memory resolver. */
  memoryDirFor?: (workdir: string) => string;
  /** Assistant-target skill extraction. Off by default so older callers are unchanged. */
  skillPass?: boolean;
}): DreamEngine {
  const { home, sessions, runner, draftRoot } = options;
  const pending = new Map<string, PendingTurn>();
  let sessionBudget = 0;

  function waitForTurn(
    sessionId: string,
    content: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const entry = pending.get(sessionId);
        if (!entry) return;
        pending.delete(sessionId);
        void runner.abortMessage(sessionId).catch(() => {
          /* best effort */
        });
        resolve({ ok: false, error: "dream turn timed out" });
      }, DEFAULT_TURN_TIMEOUT_MS);
      timer.unref?.();
      pending.set(sessionId, { resolve, timer });
      runner.sendMessage(sessionId, content).catch((error: unknown) => {
        const entry = pending.get(sessionId);
        if (!entry) return;
        pending.delete(sessionId);
        clearTimeout(entry.timer);
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  function handleTurnSettled(
    sessionId: string,
    result: { ok: boolean; error?: string },
  ): void {
    const entry = pending.get(sessionId);
    if (!entry) return;
    pending.delete(sessionId);
    clearTimeout(entry.timer);
    entry.resolve(result);
  }

  async function runChildSession(input: {
    title: string;
    workdir: string;
    systemPrompt: string;
    task: string;
    model?: string;
    tools?: string[];
    disallowedTools?: string[];
    maxTextChars?: number;
  }): Promise<{ ok: boolean; text: string; error?: string }> {
    if (sessionBudget >= MAX_SESSIONS_PER_RUN) {
      return { ok: false, text: "", error: "dream session budget exhausted" };
    }
    sessionBudget += 1;
    const session = sessions.create({
      origin: "automation",
      workdir: input.workdir,
      permissionMode: "bypassPermissions",
      title: input.title,
      systemPrompt: input.systemPrompt,
      systemPromptExplicit: true,
      // The dream must not see or write the live memory: its own copy is the
      // only store it works on.
      autoMemoryEnabled: false,
      tools: [...(input.tools ?? MEMORY_TOOLS)],
      disallowedTools: [...(input.disallowedTools ?? DENIED_TOOLS)],
      model: input.model || options.model || DEFAULT_ACTIVE_MODEL_ID,
    });
    try {
      const turn = await waitForTurn(session.id, input.task);
      let text = "";
      try {
        text = lastAssistantText(
          await runner.getMessages(session.id),
          input.maxTextChars ?? 4000,
        );
      } catch {
        text = "";
      }
      return { ok: turn.ok, text, error: turn.error };
    } finally {
      try {
        await runner.disposeSession(session.id);
      } catch {
        /* the session is hidden; failing to clean it up must not fail the dream */
      }
    }
  }

  async function runLearningPass(input: {
    target: MemoryDreamTarget;
    runId: string;
    since: number;
    draftDir: string;
    sessionWorkdir: string;
    memoryDir: string;
  }): Promise<{ drafts: SkillDraft[]; ruleDrafts: RuleDraft[]; error?: string }> {
    if (!options.skillPass || input.target.kind !== "assistant") {
      return { drafts: [], ruleDrafts: [] };
    }

    const cursorFile = cursorsPath(home);
    const cursorBefore = loadSkillCursors(cursorFile);
    // Discarding a run must not strand the transcript it consumed: keep the
    // pre-run cursor beside the draft so discardDreamRun can restore it.
    try {
      fs.writeFileSync(
        path.join(input.draftDir, "skill-cursors.before.json"),
        JSON.stringify(cursorBefore, null, 2),
        "utf-8",
      );
    } catch {
      // A missing snapshot only means discard cannot rewind the cursor.
    }
    const exported = exportIncrementalSkillTranscripts({
      home,
      workdir: input.target.workdir,
      since: input.since,
      outDir: path.join(input.draftDir, "skill-transcripts"),
      cursors: cursorBefore,
    });
    if (exported.files.length === 0) {
      return { drafts: [], ruleDrafts: [] };
    }

    writeProgress(input.draftDir, {
      phase: "skills",
      startedAt: Date.now(),
      detail: `${exported.files.length} 份新会话`,
    });

    const agentsMd = readOptionalText(
      path.join(input.target.workdir, "AGENTS.md"),
      8000,
    );
    const existingSkills = readAssistantSkills(input.target.workdir);
    const existingRules = readAssistantRules(input.target.workdir);
    const prompt = buildSkillExtractorPrompt({
      transcriptPaths: exported.files.map((file) => file.path),
      existingSkills,
      existingRules,
      agentsMd,
      memoryIndex: readOptionalText(path.join(input.memoryDir, "MEMORY.md"), 12_000),
      observations: readRecentObservations(observationsPath(home)),
      workdir: input.target.workdir,
      skillRoot: skillRootForWorkdir(input.target.workdir),
      maxCandidates: 5,
    });

    const turn = await runChildSession({
      title: `学习整理 · ${input.target.label} · 技能`,
      workdir: input.sessionWorkdir,
      systemPrompt: prompt,
      task: buildSkillExtractorTask(exported.files.map((file) => file.path)),
      model: input.target.model,
      tools: ["Read", "Grep", "Glob"],
      disallowedTools: [
        "Bash",
        "Write",
        "Edit",
        "Workflow",
        "AskUserQuestion",
        "WebFetch",
        "WebSearch",
      ],
      maxTextChars: 24_000,
    });

    if (!turn.ok) {
      return {
        drafts: [],
        ruleDrafts: [],
        error: turn.error ?? "learning extractor failed",
      };
    }

    if (
      turn.text.trim() &&
      !turn.text.includes('"candidates"') &&
      !turn.text.includes('"rules"')
    ) {
      // A prose-only answer is a parse failure, not "nothing to save": keep the
      // cursors so the next run retries this window.
      return {
        drafts: [],
        ruleDrafts: [],
        error: "learning extractor returned no candidates JSON",
      };
    }
    const candidates = parseSkillCandidates(turn.text);
    const ruleCandidates = parseRuleCandidates(turn.text);
    const suppressed = loadSuppressed(suppressedPath(home));
    const day = new Date().toISOString().slice(0, 10);
    const drafts = writeSkillDrafts({
      draftDir: input.draftDir,
      candidates,
      existingSkills,
      suppressed,
      runId: input.runId,
      day,
    });
    const ruleDrafts = writeRuleDrafts({
      draftDir: input.draftDir,
      candidates: ruleCandidates,
      agentsMd,
      existingRules,
      suppressed,
      runId: input.runId,
      day,
    });
    appendSkillObservations({
      file: observationsPath(home),
      candidates,
      drafts,
      runId: input.runId,
      day,
    });
    appendRuleObservations({
      file: observationsPath(home),
      candidates: ruleCandidates,
      drafts: ruleDrafts,
      runId: input.runId,
      day,
    });
    saveSkillCursors(cursorFile, exported.cursors);
    return { drafts, ruleDrafts };
  }

  function writeProgress(
    draftDir: string,
    progress: Omit<DreamProgress, "updatedAt">,
  ): void {
    try {
      fs.writeFileSync(
        path.join(draftDir, "progress.json"),
        JSON.stringify({ ...progress, updatedAt: Date.now() }, null, 2),
        "utf-8",
      );
    } catch {
      // Progress is cosmetic; never fail a dream because it could not be written.
    }
  }

  function transcriptDir(workdir: string): string {
    return path.join(
      getMuseHomeDir(home),
      "projects",
      pathEncoder.encodeSync(workdir),
    );
  }

  /**
   * Slice a transcript to the messages after `since`.
   *
   * The assistant keeps one long-lived session, so "one file per session" does
   * not hold for it: the same JSONL is cut into a per-run window instead. The
   * metadata line is kept so the analyzer can tell which workdir it came from.
   */
  function sliceTranscript(raw: string, since: number): string | undefined {
    const lines = raw.split("\n");
    let metadata: string | undefined;
    const kept: string[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: { type?: string; timestamp?: string };
      try {
        parsed = JSON.parse(line) as { type?: string; timestamp?: string };
      } catch {
        continue;
      }
      if (parsed.type === "metadata") {
        metadata = line;
        continue;
      }
      const at = parsed.timestamp ? Date.parse(parsed.timestamp) : Number.NaN;
      if (!Number.isFinite(at) || at >= since) kept.push(line);
    }
    if (kept.length === 0) return undefined;
    return `${metadata ? `${metadata}\n` : ""}${kept.join("\n")}\n`;
  }

  function exportTranscripts(input: {
    target: MemoryDreamTarget;
    since: number;
    outDir: string;
  }): Array<{ path: string; name: string }> {
    const dirs = new Set<string>([transcriptDir(input.target.workdir)]);
    for (const session of sessions.list()) {
      if (session.workdir === input.target.workdir) {
        dirs.add(transcriptDir(session.workdir));
      }
      if (session.worktreeRepoRoot === input.target.workdir) {
        dirs.add(transcriptDir(session.workdir));
      }
    }

    const exported: Array<{ path: string; name: string }> = [];
    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith(".jsonl")) continue;
        const source = path.join(dir, entry);
        let raw: string;
        try {
          raw = fs.readFileSync(source, "utf-8");
        } catch {
          continue;
        }
        const sliced = sliceTranscript(raw, input.since);
        if (!sliced) continue;
        const bounded =
          Buffer.byteLength(sliced, "utf-8") > MAX_TRANSCRIPT_BYTES
            ? sliced.slice(-MAX_TRANSCRIPT_BYTES)
            : sliced;
        const target = path.join(input.outDir, entry);
        fs.writeFileSync(target, bounded, "utf-8");
        exported.push({ path: target, name: entry });
        if (exported.length >= MAX_TRANSCRIPTS_PER_RUN) return exported;
      }
    }
    return exported;
  }

  function writeReport(input: {
    draftDir: string;
    target: MemoryDreamTarget;
    since: number;
    transcripts: number;
    summaries: string[];
    lint: MemoryLintResult;
    passes: number;
    fallbackIndex: boolean;
    fallbackArchived: number;
  }): void {
    const lines = [
      `# 记忆整理报告 · ${input.target.label}`,
      "",
      `- 目标：${input.target.workdir}`,
      `- 窗口起点：${new Date(input.since).toISOString()}`,
      `- transcript：${input.transcripts} 份`,
      `- 整理轮次：${input.passes}`,
      `- 文件数：${input.lint.files}`,
      `- 索引维护：${
        input.fallbackIndex
          ? `程序按优先级重建索引，归档 ${input.fallbackArchived} 个低优先级文件`
          : "AI 维护"
      }`,
      `- 孤儿：${input.lint.orphans}`,
      `- 索引：${input.lint.indexChars} 字符 / ${input.lint.indexLines} 行`,
      `- lint：${input.lint.ok ? "通过" : "未通过"}`,
      "",
      "## analyzer 摘要",
      "",
      ...(input.summaries.length > 0
        ? input.summaries.map((summary, index) => `${index + 1}. ${summary}`)
        : ["（本次没有 transcript，只跑了 organizer）"]),
      "",
    ];
    if (!input.lint.ok) {
      lines.push("## lint 问题", "");
      if (input.lint.dangling.length) {
        lines.push(`- 断链：${input.lint.dangling.join(", ")}`);
      }
      if (input.lint.orphanFiles.length) {
        lines.push(`- 孤儿：${input.lint.orphanFiles.join(", ")}`);
      }
      if (input.lint.overCap.length) {
        lines.push(`- 超 4KB：${input.lint.overCap.join(", ")}`);
      }
      if (input.lint.badType.length) {
        lines.push(`- type 非法：${input.lint.badType.join(", ")}`);
      }
      if (input.lint.badFrontmatter.length) {
        lines.push(`- frontmatter 缺失：${input.lint.badFrontmatter.join(", ")}`);
      }
      if (input.lint.indexOverChars || input.lint.indexOverLines) {
        lines.push(
          `- 索引超限：${input.lint.indexChars} 字符 / ${input.lint.indexLines} 行`,
        );
      }
      lines.push("");
    }
    fs.writeFileSync(
      path.join(input.draftDir, "DREAM.md"),
      lines.join("\n"),
      "utf-8",
    );
  }

  /** Only blocking problems drive repair passes; orphans/over-cap are warnings. */
  function lintScore(lint: MemoryLintResult): number {
    return (
      lint.dangling.length * 5 +
      lint.badFrontmatter.length * 2 +
      lint.badType.length * 2 +
      (lint.indexMissing ? 100 : 0) +
      (lint.indexOverChars ? 50 : 0) +
      (lint.indexOverLines ? 50 : 0)
    );
  }

  /** How many files the index can still hold at the current entry length. */
  function maxIndexedFiles(lint: MemoryLintResult): number {
    const linked = Math.max(1, lint.files - lint.orphans);
    const perEntry = lint.indexChars > 0 ? lint.indexChars / linked : 65;
    return Math.max(1, Math.floor(INDEX_MAX_CHARS / Math.max(40, perEntry)));
  }

  async function run(input: {
    target: MemoryDreamTarget;
    runId: string;
    since: number;
  }): Promise<DreamRunResult> {
    sessionBudget = 0;
    const draftDir = dreamDraftDir(draftRoot, input.target.id, input.runId);
    const draftMemory = path.join(draftDir, "memory");
    const result: DreamRunResult = {
      ok: false,
      draftDir,
      transcripts: 0,
      summaries: [],
    };

    const liveMemory = options.memoryDirFor
      ? options.memoryDirFor(input.target.workdir)
      : resolveAutoMemoryDirectory(input.target.workdir);
    if (!fs.existsSync(liveMemory)) {
      return { ...result, error: `memory directory missing: ${liveMemory}` };
    }

    try {
      fs.rmSync(draftDir, { recursive: true, force: true });
      fs.mkdirSync(draftDir, { recursive: true });
      // Dream sessions run in a scratch workdir, so their own transcripts do
      // not land next to the real ones and get re-analyzed the next night.
      const sessionWorkdir = path.join(draftDir, "workdir");
      fs.mkdirSync(sessionWorkdir, { recursive: true });
      const startedAt = Date.now();
      writeProgress(draftDir, { phase: "copy", startedAt });
      fs.cpSync(liveMemory, draftMemory, { recursive: true });
      const transcriptsDir = path.join(draftDir, "transcripts");
      fs.mkdirSync(transcriptsDir, { recursive: true });

      const transcripts = exportTranscripts({
        target: input.target,
        since: input.since,
        outDir: transcriptsDir,
      });
      result.transcripts = transcripts.length;
      writeProgress(draftDir, {
        phase: "export",
        startedAt,
        index: 0,
        total: transcripts.length,
        detail: `${transcripts.length} 份 transcript`,
      });

      for (const [index, transcript] of transcripts.entries()) {
        writeProgress(draftDir, {
          phase: "analyze",
          startedAt,
          index: index + 1,
          total: transcripts.length,
        });
        const analyzer = await runChildSession({
          title: `记忆整理 · ${input.target.label}`,
          workdir: sessionWorkdir,
          systemPrompt: buildAnalyzerSystemPrompt({
            memoryDir: draftMemory,
            transcriptPath: transcript.path,
          }),
          task: buildAnalyzerTask(transcript.path),
          model: input.target.model,
        });
        if (analyzer.text) result.summaries.push(analyzer.text);
        // One failed analyzer should not throw away the other transcripts'
        // work; the organizer can still tidy what landed.
      }

      writeProgress(draftDir, {
        phase: "organize",
        startedAt,
        index: transcripts.length,
        total: transcripts.length,
      });
      const organizer = await runChildSession({
        title: `记忆整理 · ${input.target.label} · 汇总`,
        workdir: sessionWorkdir,
        systemPrompt: buildOrganizerSystemPrompt({ memoryDir: draftMemory }),
        task: buildOrganizerTask(),
        model: input.target.model,
      });
      if (organizer.text) result.summaries.push(organizer.text);

      writeProgress(draftDir, {
        phase: "lint",
        startedAt,
        index: transcripts.length,
        total: transcripts.length,
      });
      // The AI owns the index. Code only checks it and, when the AI cannot
      // finish, rebuilds it as a visible fallback.
      let lint = lintMemoryDir(draftMemory);
      let passes = 1;
      let score = lintScore(lint);
      let fallbackIndex = false;

      // One organizer pass rarely finishes a large store: it still has orphans
      // and over-cap files. Keep repairing while the lint score improves, with
      // a hard pass and wall-clock budget so a night cannot run forever.
      while (
        hasCriticalMemoryLint(lint) &&
        passes <= MAX_REPAIR_PASSES &&
        Date.now() - startedAt < MAX_RUN_DURATION_MS
      ) {
        writeProgress(draftDir, {
          phase: "repair",
          startedAt,
          index: passes,
          total: MAX_REPAIR_PASSES + 1,
        });
        const repair = await runChildSession({
          title: `记忆整理 · ${input.target.label} · 修复 ${passes}`,
          workdir: sessionWorkdir,
          systemPrompt: buildRepairSystemPrompt({
            memoryDir: draftMemory,
            orphans: lint.orphans,
            overCap: lint.overCap.length,
            indexChars: lint.indexChars,
            indexLines: lint.indexLines,
            files: lint.files,
            maxFiles: maxIndexedFiles(lint),
            sampleOrphans: lint.orphanFiles.slice(0, 20),
            badFrontmatter: lint.badFrontmatter.slice(0, 20),
            badType: lint.badType.slice(0, 20),
          }),
          task: buildRepairTask(),
          model: input.target.model,
        });
        if (repair.text) result.summaries.push(repair.text);
        const next = lintMemoryDir(draftMemory);
        const nextScore = lintScore(next);
        passes += 1;
        lint = next;
        if (hasCriticalMemoryLint(next) && nextScore >= score) break; // no progress
        score = nextScore;
      }

      let fallbackArchived = 0;
      if (hasCriticalMemoryLint(lint)) {
        // The model owns the index, but if it ran out of passes/turn budget we
        // rebuild mechanically: most important units stay in MEMORY.md, the
        // overflow moves to archive.md with one pointer. This is the same
        // type-then-recency policy the index maintenance path already uses, so
        // a large store does not fail just because one run did not finish.
        const rebuilt = rebuildFlatIndex(draftMemory);
        fallbackIndex = true;
        fallbackArchived = rebuilt.archived;
        lint = lintMemoryDir(draftMemory);
      }

      result.lint = lint;
      result.fallbackIndex = fallbackIndex;
      result.fallbackArchived = fallbackArchived;
      result.stats = memoryDirStats(draftMemory);

      // Assistant-only SOP drafts. This is best-effort: a skill-pass failure
      // must not discard a usable memory draft, and it must not advance the
      // transcript cursors (the next run retries the same window).
      try {
        const skillPass = await runLearningPass({
          target: input.target,
          runId: input.runId,
          since: input.since,
          draftDir,
          sessionWorkdir,
          memoryDir: liveMemory,
        });
        if (skillPass.drafts.length > 0) {
          result.skills = summarizeSkillDrafts(skillPass.drafts);
        }
        if (skillPass.ruleDrafts.length > 0) {
          result.rules = summarizeRuleDrafts(skillPass.ruleDrafts);
        }
        if (skillPass.error) result.skillError = skillPass.error;
      } catch (error) {
        result.skillError = error instanceof Error ? error.message : String(error);
      }
      writeReport({
        draftDir,
        target: input.target,
        since: input.since,
        transcripts: transcripts.length,
        summaries: result.summaries,
        lint,
        passes,
        fallbackIndex,
        fallbackArchived,
      });
      result.ok = !hasCriticalMemoryLint(lint);
      if (!result.ok) result.error = "draft index is unusable";
      writeProgress(draftDir, {
        phase: "done",
        startedAt,
        index: transcripts.length,
        total: transcripts.length,
        detail: lint.ok ? "draft ready" : "lint failed",
      });
      return result;
    } catch (error) {
      return {
        ...result,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { run, handleTurnSettled };
}
