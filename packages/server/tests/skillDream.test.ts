import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  adoptSkillDraft,
  cursorsPath,
  exportIncrementalSkillTranscripts,
  lintSkillContent,
  loadSkillCursors,
  loadSuppressed,
  loadSuppressedEntries,
  suppressLearningContent,
  observationsPath,
  parseSkillCandidates,
  readSkillDrafts,
  resetLearningCursors,
  saveSkillCursors,
  skillRootForWorkdir,
  transcriptDirForWorkdir,
  writeSkillDrafts,
} from "../src/services/skillDream.js";
import { createMemoryDreamEngine } from "../src/services/memoryDreamEngine.js";
import { buildSkillExtractorPrompt } from "../src/prompts/skillDream.js";
import type { SessionStore } from "../src/services/sessionStore.js";
import type { SessionRunner } from "../src/services/sessionRunner/ctx.js";
import type { MemoryDreamTarget } from "../src/services/memoryDreams.js";

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function skillContent(name: string, description = "Use when testing."): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n## 触发\n测试。\n\n## 步骤\n1. 做一件事。\n`;
}

function writeTranscript(dir: string, file: string, lines: string[]): string {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, file);
  fs.writeFileSync(
    target,
    [
      JSON.stringify({ type: "metadata", workdir: "/tmp/work", createdAt: 1 }),
      ...lines,
      "",
    ].join("\n"),
    "utf-8",
  );
  return target;
}

describe("skillDream candidates", () => {
  it("parses fenced JSON and normalizes a candidate", () => {
    const text = `说明\n\`\`\`json\n${JSON.stringify({
      candidates: [
        {
          action: "create",
          name: "progress-review",
          intent: "progress_review",
          description: "Use when the user asks for a progress review.",
          content: skillContent("progress-review"),
          evidence: [{ day: "2026-11-17", quote: "汇总上周" }],
          confidence: 0.8,
        },
      ],
    })}\n\`\`\``;
    const candidates = parseSkillCandidates(text);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.name).toBe("progress-review");
    expect(candidates[0]?.confidence).toBe(0.8);
  });

  it("rejects invalid names, bad frontmatter, oversized descriptions and secrets", () => {
    expect(lintSkillContent("Bad Name", skillContent("bad-name")).ok).toBe(false);
    expect(lintSkillContent("x", "no frontmatter").ok).toBe(false);
    expect(
      lintSkillContent("x", skillContent("x", "a".repeat(201))).ok,
    ).toBe(false);
    expect(
      lintSkillContent("x", `${skillContent("x")}sk-${"a".repeat(30)}`).ok,
    ).toBe(false);
  });

  it("drafts a single occurrence with a first-occurrence marker", () => {
    const draftDir = tempDir("muse-skill-gate-");
    const base = {
      action: "create" as const,
      name: "progress-review",
      description: "Use when the user asks for a progress review.",
      content: skillContent("progress-review"),
      evidence: [{ day: "2026-11-24" }],
      confidence: 0.7,
    };
    const drafts = writeSkillDrafts({
      draftDir,
      candidates: [{ ...base, occurrenceDays: 1 }],
      runId: "run-1",
      day: "2026-11-24",
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.occurrenceDays).toBe(1);
  });

  it("suppresses a rejected skill so it is not drafted again", () => {
    const draftDir = tempDir("muse-skill-suppressed-");
    const file = path.join(tempDir("muse-skill-suppressed-store-"), "suppressed.json");
    const candidate = {
      action: "create" as const,
      name: "progress-review",
      description: "Use when the user asks for a progress review.",
      content: skillContent("progress-review"),
      evidence: [{ day: "2026-11-24" }],
      confidence: 0.7,
      occurrenceDays: 2,
    };
    suppressLearningContent({
      file,
      kind: "skill",
      name: candidate.name,
      content: candidate.content,
    });
    expect(loadSuppressed(file).size).toBe(1);
    const ignored = loadSuppressedEntries(file);
    expect(ignored).toHaveLength(1);
    expect(ignored[0]).toMatchObject({
      kind: "skill",
      name: "progress-review",
      description: "Use when testing.",
    });
    expect(
      writeSkillDrafts({
        draftDir,
        candidates: [candidate],
        suppressed: loadSuppressed(file),
        runId: "run-1",
        day: "2026-11-24",
      }),
    ).toHaveLength(0);
    expect(
      writeSkillDrafts({
        draftDir,
        candidates: [
          {
            ...candidate,
            content: skillContent("progress-review", "A rephrased description."),
          },
        ],
        suppressedNames: new Set(["progress-review"]),
        runId: "run-1",
        day: "2026-11-24",
      }),
    ).toHaveLength(0);
  });

  it("tells the extractor which skills and rules were ignored", () => {
    const prompt = buildSkillExtractorPrompt({
      transcriptPaths: ["/tmp/transcript.jsonl"],
      existingSkills: [],
      existingRules: [],
      agentsMd: "",
      memoryIndex: "",
      memoryDir: "/tmp/assistant-chat/memory",
      observations: "",
      workdir: "/tmp/assistant-chat",
      skillRoot: "/tmp/assistant-chat/.muse-work/skills",
      maxCandidates: 5,
      ignored: [
        {
          kind: "skill",
          name: "progress-review",
          description: "旧的不想要的汇总技能。",
        },
      ],
    });
    expect(prompt).toContain("用户已忽略");
    expect(prompt).toContain("progress-review");
    expect(prompt).toContain("不要再次输出");
    expect(prompt).toContain("记忆目录：/tmp/assistant-chat/memory");
    expect(prompt).toContain("用 Read 打开");
  });

  it("forces create to update when the live skill exists, and downgrades a missing update", () => {
    const draftDir = tempDir("muse-skill-action-");
    const existing = [
      {
        name: "progress-review",
        description: "old",
        content: skillContent("progress-review"),
      },
    ];
    const base = {
      action: "create" as const,
      name: "progress-review",
      description: "new",
      content: skillContent("progress-review", "new"),
      evidence: [],
      confidence: 0.8,
      occurrenceDays: 2,
    };
    const updated = writeSkillDrafts({
      draftDir,
      candidates: [base],
      existingSkills: existing,
      runId: "r1",
      day: "2026-11-24",
    });
    expect(updated[0]?.action).toBe("update");

    const missing = writeSkillDrafts({
      draftDir: tempDir("muse-skill-action2-"),
      candidates: [
        {
          ...base,
          action: "update",
          name: "new-skill",
          content: skillContent("new-skill"),
        },
      ],
      existingSkills: existing,
      runId: "r2",
      day: "2026-11-24",
    });
    expect(missing[0]?.action).toBe("create");
  });

  it("writes drafts and reads them back", () => {
    const draftDir = tempDir("muse-skill-draft-");
    const drafts = writeSkillDrafts({
      draftDir,
      candidates: [
        {
          action: "create",
          name: "progress-review",
          intent: "progress_review",
          description: "Use when the user asks for a progress review.",
          content: skillContent("progress-review"),
          evidence: [{ day: "2026-11-17" }],
          confidence: 0.7,
          occurrenceDays: 2,
        },
      ],
      runId: "run-1",
      day: "2026-11-24",
    });
    expect(drafts).toHaveLength(1);
    const read = readSkillDrafts(draftDir);
    expect(read).toHaveLength(1);
    expect(read[0]?.name).toBe("progress-review");
    expect(read[0]?.lint.ok).toBe(true);
  });
});

describe("skillDream incremental transcripts", () => {
  it("exports only new or changed transcript bytes", () => {
    const home = tempDir("muse-skill-home-");
    const workdir = tempDir("muse-skill-work-");
    const dir = transcriptDirForWorkdir(home, workdir);
    const file = writeTranscript(dir, "assistant.jsonl", [
      JSON.stringify({ role: "user", content: "one", timestamp: "2026-11-23T01:00:00Z" }),
      JSON.stringify({ role: "assistant", content: "two", timestamp: "2026-11-23T01:01:00Z" }),
    ]);
    const out = tempDir("muse-skill-out-");
    const cursors = loadSkillCursors(path.join(home, "cursors.json"));

    const first = exportIncrementalSkillTranscripts({
      home,
      workdir,
      since: 0,
      outDir: out,
      cursors,
    });
    expect(first.files).toHaveLength(1);
    expect(fs.readFileSync(first.files[0]!.path, "utf-8")).toContain("one");

    const second = exportIncrementalSkillTranscripts({
      home,
      workdir,
      since: 0,
      outDir: out,
      cursors: first.cursors,
    });
    expect(second.files).toHaveLength(0);

    fs.appendFileSync(
      file,
      `${JSON.stringify({ role: "user", content: "three", timestamp: "2026-11-24T01:00:00Z" })}\n`,
      "utf-8",
    );
    const third = exportIncrementalSkillTranscripts({
      home,
      workdir,
      since: 0,
      outDir: out,
      cursors: first.cursors,
    });
    expect(third.files).toHaveLength(1);
    const appended = fs.readFileSync(third.files[0]!.path, "utf-8");
    expect(appended).toContain("three");
    expect(appended).not.toContain("one");
  });

  it("processes the oldest unprocessed transcripts instead of the newest batch", () => {
    const home = tempDir("muse-skill-home-");
    const workdir = tempDir("muse-skill-work-");
    const dir = transcriptDirForWorkdir(home, workdir);
    for (let i = 0; i < 8; i += 1) {
      const file = writeTranscript(dir, `t${i}.jsonl`, [
        JSON.stringify({
          role: "user",
          content: `msg-${i}`,
          timestamp: `2026-11-2${i}T01:00:00Z`,
        }),
      ]);
      const at = new Date(2026, 10, 20, 0, i, 0);
      fs.utimesSync(file, at, at);
    }
    const out = tempDir("muse-skill-out-");
    const cursors = { version: 1 as const, transcripts: {} };

    const first = exportIncrementalSkillTranscripts({
      home,
      workdir,
      since: 0,
      outDir: out,
      cursors,
    });
    expect(first.files).toHaveLength(6);
    const firstText = first.files
      .map((file) => fs.readFileSync(file.path, "utf-8"))
      .join("\n");
    for (let i = 0; i < 6; i += 1) expect(firstText).toContain(`msg-${i}`);
    expect(firstText).not.toContain("msg-7");

    const second = exportIncrementalSkillTranscripts({
      home,
      workdir,
      since: 0,
      outDir: out,
      cursors: first.cursors,
    });
    expect(second.files).toHaveLength(2);
    const secondText = second.files
      .map((file) => fs.readFileSync(file.path, "utf-8"))
      .join("\n");
    expect(secondText).toContain("msg-6");
    expect(secondText).toContain("msg-7");
  });

  it("backs up and removes the cursor on reset", () => {
    const home = tempDir("muse-skill-reset-");
    const file = cursorsPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, transcripts: {} }), "utf-8");
    const result = resetLearningCursors({ home });
    expect(result.removed).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(result.backupPath && fs.existsSync(result.backupPath)).toBe(true);
  });

  it("re-reads a rewritten transcript", () => {
    const home = tempDir("muse-skill-home-");
    const workdir = tempDir("muse-skill-work-");
    const dir = transcriptDirForWorkdir(home, workdir);
    const file = writeTranscript(dir, "assistant.jsonl", [
      JSON.stringify({ role: "user", content: "old", timestamp: "2026-11-23T01:00:00Z" }),
    ]);
    const out = tempDir("muse-skill-out-");
    const first = exportIncrementalSkillTranscripts({
      home,
      workdir,
      since: 0,
      outDir: out,
      cursors: { version: 1, transcripts: {} },
    });
    expect(first.files).toHaveLength(1);
    fs.writeFileSync(
      file,
      `${JSON.stringify({ type: "metadata", workdir: "/tmp/work" })}\n${JSON.stringify({ role: "user", content: "new", timestamp: "2026-11-24T01:00:00Z" })}\n`,
      "utf-8",
    );
    const second = exportIncrementalSkillTranscripts({
      home,
      workdir,
      since: 0,
      outDir: out,
      cursors: first.cursors,
    });
    expect(second.files).toHaveLength(1);
    expect(fs.readFileSync(second.files[0]!.path, "utf-8")).toContain("new");
  });
});

describe("skillDream adopt", () => {
  it("copies a draft into the assistant workdir and backs up an existing skill", () => {
    const draftDir = tempDir("muse-skill-draft-");
    const workdir = tempDir("muse-skill-work-");
    const backupRoot = tempDir("muse-skill-backup-");
    expect(
      writeSkillDrafts({
        draftDir,
        candidates: [
          {
            action: "create",
            name: "progress-review",
            description: "Use when the user asks for a progress review.",
            content: skillContent("progress-review"),
            evidence: [],
            confidence: 0.8,
            occurrenceDays: 2,
          },
        ],
        runId: "run-1",
        day: "2026-11-24",
      }),
    ).toHaveLength(1);

    const first = adoptSkillDraft({
      draftDir,
      name: "progress-review",
      workdir,
      backupRoot,
    });
    expect(first.ok).toBe(true);
    const live = path.join(skillRootForWorkdir(workdir), "progress-review", "SKILL.md");
    expect(fs.readFileSync(live, "utf-8")).toContain("测试");
    expect(
      fs.existsSync(path.join(skillRootForWorkdir(workdir), "progress-review", "meta.json")),
    ).toBe(false);

    fs.writeFileSync(
      path.join(draftDir, "skills", "progress-review", "SKILL.md"),
      skillContent("progress-review", "Updated."),
      "utf-8",
    );
    const second = adoptSkillDraft({
      draftDir,
      name: "progress-review",
      workdir,
      backupRoot,
    });
    expect(second.ok).toBe(true);
    expect(second.backupPath).toBeTruthy();
    expect(
      fs.readFileSync(path.join(second.backupPath!, "SKILL.md"), "utf-8"),
    ).toContain("测试");
    expect(fs.readFileSync(live, "utf-8")).toContain("Updated.");
  });
});

describe("memoryDreamEngine skill pass", () => {
  it("writes an assistant-only draft from the extractor JSON", async () => {
    const home = tempDir("muse-skill-dream-home-");
    const workdir = tempDir("muse-skill-dream-work-");
    const memoryDir = tempDir("muse-skill-dream-memory-");
    fs.writeFileSync(
      path.join(memoryDir, "MEMORY.md"),
      "# Memory\n\n- [a](a.md) — a\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(memoryDir, "a.md"),
      "---\nname: a\ndescription: a\ntype: feedback\n---\n\n- rule\n",
      "utf-8",
    );
    const transcriptDir = transcriptDirForWorkdir(home, workdir);
    writeTranscript(transcriptDir, "assistant.jsonl", [
      JSON.stringify({ role: "user", content: "汇总上周进展", timestamp: new Date().toISOString() }),
    ]);

    const created: Array<{ id: string; title?: string }> = [];
    let engine: ReturnType<typeof createMemoryDreamEngine>;
    const sessions = {
      create(input: { title?: string }) {
        const session = { id: `s-${created.length + 1}`, ...input };
        created.push(session);
        return session;
      },
      list() {
        return [{ id: "assistant", origin: "assistant", workdir }];
      },
    } as unknown as SessionStore;
    const skillJson = JSON.stringify({
      rules: [
        {
          name: "report-timing",
          description: "只在需要拍板时主动发消息。",
          text: "只有失败、卡住或需要用户拍板时才主动发消息。",
          evidence: [{ day: "2026-11-24" }],
          occurrenceDays: 2,
          confidence: 0.8,
        },
      ],
      candidates: [
        {
          action: "create",
          name: "progress-review",
          intent: "progress_review",
          description: "Use when the user asks for a progress review.",
          content: skillContent("progress-review"),
          evidence: [{ day: "2026-11-24" }],
          confidence: 0.8,
          occurrenceDays: 2,
        },
      ],
    });
    const runner = {
      async sendMessage(sessionId: string) {
        queueMicrotask(() => engine.handleTurnSettled(sessionId, { ok: true }));
        return { accepted: true as const };
      },
      async abortMessage() {
        return { ok: true as const };
      },
      async getMessages(sessionId: string) {
        const session = created.find((item) => item.id === sessionId);
        const text = session?.title?.includes("技能") ? skillJson : "summary";
        return [{ role: "assistant", blocks: [{ type: "text", content: text }] }];
      },
      async disposeSession() {},
    } as unknown as SessionRunner;

    engine = createMemoryDreamEngine({
      home,
      sessions,
      runner,
      draftRoot: path.join(home, "dreams"),
      memoryDirFor: () => memoryDir,
      skillPass: true,
    });
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
      createdAt: 0,
      updatedAt: 0,
    };

    const result = await engine.run({ target, runId: "run-1", since: 0 });
    expect(result.ok, result.error).toBe(true);
    expect(result.skills).toHaveLength(1);
    expect(result.rules).toHaveLength(1);
    expect(
      fs.existsSync(path.join(result.draftDir, "rules", "report-timing.md")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(result.draftDir, "skills", "progress-review", "SKILL.md"),
      ),
    ).toBe(true);
    expect(fs.readFileSync(observationsPath(home), "utf-8")).toContain(
      "progress-review",
    );

    const second = await engine.run({ target, runId: "run-2", since: 0 });
    expect(second.ok).toBe(true);
    expect(second.skills ?? []).toHaveLength(0);
    expect(created.filter((item) => item.title?.includes("技能"))).toHaveLength(1);
  });
});
