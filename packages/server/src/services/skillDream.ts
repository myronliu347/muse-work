import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathEncoder } from "@muse-work/agent";
import { getMuseHomeDir } from "@muse-work/provider";

/**
 * Assistant-only skill drafts.
 *
 * This module is deliberately separate from memoryDreams: memory has its own
 * diff/lint/adopt flow, while skills are private to the assistant workdir.
 * Nothing here writes live skills; adoption copies a validated draft into the
 * assistant's project skill directory.
 */

const MAX_SKILL_BYTES = 32 * 1024;
const MAX_DESCRIPTION_CHARS = 200;
const MAX_CANDIDATES = 5;
const MAX_TRANSCRIPTS = 6;
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const OBSERVATION_DAYS = 30;
const OBSERVATION_LIMIT = 100;
const NAME_RE = /^[a-z0-9-]+$/;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

export interface SkillEvidence {
  day?: string;
  quote?: string;
  episodeId?: string;
}

export interface SkillCandidate {
  action: "create" | "update";
  name: string;
  description: string;
  intent?: string;
  content: string;
  evidence: SkillEvidence[];
  confidence: number;
  /** The user explicitly asked for this to be a standing practice. */
  explicit?: boolean;
  /** Distinct days this class was observed, including the current transcript. */
  occurrenceDays?: number;
}

export interface SkillDraft extends SkillCandidate {
  lint: { ok: boolean; issues: string[] };
}

export interface SkillCursorEntry {
  inode: number;
  offset: number;
  size: number;
  mtimeMs: number;
  lastMessageId?: string;
}

export interface SkillCursors {
  version: 1;
  transcripts: Record<string, SkillCursorEntry>;
}

export function configDirName(): string {
  return process.env.MUSE_HOME_DIR ?? ".muse-work";
}

/** Project-scoped skill root for the assistant workdir. */
export function skillRootForWorkdir(workdir: string): string {
  return path.join(workdir, configDirName(), "skills");
}

export function learningRoot(home: string): string {
  return path.join(getMuseHomeDir(home), "assistant", "learning");
}

export function cursorsPath(home: string): string {
  return path.join(learningRoot(home), "cursors.json");
}

export function observationsPath(home: string): string {
  return path.join(learningRoot(home), "observations.jsonl");
}

export function suppressedPath(home: string): string {
  return path.join(learningRoot(home), "suppressed.json");
}

export function learningContentHash(
  kind: "rule" | "skill",
  content: string,
): string {
  // Whitespace/case differences should not resurrect a rejected lesson.
  const normalized = content.replace(/\s+/g, " ").trim().toLowerCase();
  return crypto
    .createHash("sha1")
    .update(`${kind}\n${normalized}`)
    .digest("hex");
}

export interface SuppressedEntry {
  kind: "rule" | "skill";
  name: string;
  hash: string;
  at: string;
  description: string;
}

export function loadSuppressedEntries(file: string): SuppressedEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      entries?: unknown;
    };
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(
      (entry): entry is SuppressedEntry =>
        Boolean(entry) &&
        typeof entry === "object" &&
        (entry as { kind?: unknown }).kind !== undefined &&
        ((entry as { kind?: unknown }).kind === "rule" ||
          (entry as { kind?: unknown }).kind === "skill") &&
        typeof (entry as { name?: unknown }).name === "string" &&
        typeof (entry as { hash?: unknown }).hash === "string" &&
        typeof (entry as { description?: unknown }).description === "string",
    );
  } catch {
    return [];
  }
}

export function loadSuppressed(file: string): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      hashes?: unknown;
    };
    if (Array.isArray(parsed.hashes)) {
      return new Set(
        parsed.hashes.filter((hash): hash is string => typeof hash === "string"),
      );
    }
  } catch {
    // Missing/corrupt suppression only re-proposes previously rejected items.
  }
  return new Set();
}

export function suppressLearningContent(input: {
  file: string;
  kind: "rule" | "skill";
  name: string;
  content: string;
  now?: Date;
}): string {
  const hash = learningContentHash(input.kind, input.content);
  const hashes = loadSuppressed(input.file);
  hashes.add(hash);
  const at = (input.now ?? new Date()).toISOString();
  const frontmatter =
    input.kind === "skill" ? parseFrontmatter(input.content) : undefined;
  const description = (
    frontmatter?.description ||
    input.content.replace(/\s+/g, " ").trim()
  ).slice(0, 160);
  const entries = loadSuppressedEntries(input.file).filter(
    (entry) => !(entry.kind === input.kind && entry.name === input.name),
  );
  entries.push({
    kind: input.kind,
    name: input.name,
    hash,
    at,
    description,
  });
  fs.mkdirSync(path.dirname(input.file), { recursive: true });
  const tmp = `${input.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      {
        version: 2,
        hashes: [...hashes].sort(),
        entries,
        last: { kind: input.kind, name: input.name, at },
      },
      null,
      2,
    ),
    "utf-8",
  );
  fs.renameSync(tmp, input.file);
  return hash;
}

export function transcriptDirForWorkdir(home: string, workdir: string): string {
  return path.join(
    getMuseHomeDir(home),
    "projects",
    pathEncoder.encodeSync(workdir),
  );
}

export function loadSkillCursors(file: string): SkillCursors {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<SkillCursors>;
    if (raw && raw.version === 1 && raw.transcripts && typeof raw.transcripts === "object") {
      return { version: 1, transcripts: { ...raw.transcripts } };
    }
  } catch {
    // Missing or corrupt cursors restart at the first-run window; never fail a dream.
  }
  return { version: 1, transcripts: {} };
}

export function saveSkillCursors(file: string, cursors: SkillCursors): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cursors, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function readFirstLine(file: string): string {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, read).toString("utf-8");
    const end = text.indexOf("\n");
    return end >= 0 ? text.slice(0, end) : text;
  } finally {
    fs.closeSync(fd);
  }
}

function readFrom(file: string, start: number): { buffer: Buffer; start: number } {
  const fd = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(fd);
    const available = Math.max(0, stat.size - start);
    if (available === 0) return { buffer: Buffer.alloc(0), start };
    // A very long-lived assistant transcript must not be read into memory in
    // one allocation. Keep the newest window; the cursor still advances to EOF.
    const length = Math.min(available, MAX_TRANSCRIPT_BYTES);
    const readStart = start + (available - length);
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const chunk = fs.readSync(fd, buffer, read, length - read, readStart + read);
      if (chunk <= 0) break;
      read += chunk;
    }
    return { buffer: buffer.subarray(0, read), start: readStart };
  } finally {
    fs.closeSync(fd);
  }
}

function parseTimestamp(line: string): number | undefined {
  try {
    const parsed = JSON.parse(line) as { timestamp?: unknown };
    if (typeof parsed.timestamp === "string") {
      const at = Date.parse(parsed.timestamp);
      return Number.isFinite(at) ? at : undefined;
    }
  } catch {
    // A torn or non-JSON line is kept only when the caller wants everything.
  }
  return undefined;
}

function lastMessageId(text: string): string | undefined {
  const lines = text.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as { id?: unknown; messageId?: unknown };
      if (typeof parsed.id === "string") return parsed.id;
      if (typeof parsed.messageId === "string") return parsed.messageId;
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

function sliceCompleteLines(buffer: Buffer): { text: string; consumed: number } {
  const text = buffer.toString("utf-8");
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline < 0) return { text: "", consumed: 0 };
  const complete = text.slice(0, lastNewline + 1);
  // `consumed` is a byte offset; lastIndexOf() counts UTF-16 code units, so a
  // CJK prompt would otherwise leave a few bytes unread and re-export forever.
  return { text: complete, consumed: Buffer.byteLength(complete, "utf-8") };
}

function filterSince(text: string, since: number): string {
  return text
    .split("\n")
    .filter((line) => {
      if (!line.trim()) return false;
      if (line.includes('"type":"metadata"') || line.includes('"type": "metadata"')) {
        return true;
      }
      const at = parseTimestamp(line);
      return at === undefined || at >= since;
    })
    .join("\n")
    .concat("\n");
}

function readIncrementalTranscript(input: {
  file: string;
  cursor: SkillCursorEntry | undefined;
  since: number;
}): { text: string; next: SkillCursorEntry } | undefined {
  const stat = fs.statSync(input.file);
  const cursor = input.cursor;
  let start = 0;
  let mode: "initial" | "append" | "rewrite" = "initial";

  if (cursor) {
    if (stat.ino !== cursor.inode || stat.size < cursor.offset) {
      mode = "rewrite";
    } else if (stat.size === cursor.offset && stat.mtimeMs > cursor.mtimeMs) {
      mode = "rewrite";
    } else if (stat.size > cursor.offset) {
      mode = "append";
      start = cursor.offset;
    } else {
      return undefined;
    }
  }

  const read = readFrom(input.file, start);
  const { text: complete, consumed } = sliceCompleteLines(read.buffer);
  if (!complete.trim()) return undefined;

  const metadata = readFirstLine(input.file);
  const body =
    mode === "initial"
      ? filterSince(complete, input.since)
      : mode === "rewrite" && complete.length > MAX_TRANSCRIPT_BYTES
        ? complete.slice(-MAX_TRANSCRIPT_BYTES)
        : complete;

  if (!body.trim()) return undefined;
  const joined = metadata && !body.startsWith(metadata)
    ? `${metadata}\n${body}`
    : body;
  const bounded =
    Buffer.byteLength(joined, "utf-8") > MAX_TRANSCRIPT_BYTES
      ? joined.slice(-MAX_TRANSCRIPT_BYTES)
      : joined;

  return {
    text: bounded,
    next: {
      inode: stat.ino,
      offset: read.start + consumed,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      lastMessageId: lastMessageId(complete),
    },
  };
}

/**
 * Export only transcripts that are new, appended to, or rewritten since the
 * last successful skill pass. Returns the exported files plus the cursor state
 * the caller must persist after the pass succeeds.
 */
export function exportIncrementalSkillTranscripts(input: {
  home: string;
  workdir: string;
  since: number;
  outDir: string;
  cursors: SkillCursors;
}): { files: Array<{ path: string; name: string }>; cursors: SkillCursors } {
  const dir = transcriptDirForWorkdir(input.home, input.workdir);
  const files: Array<{ path: string; name: string }> = [];
  const cursors: SkillCursors = {
    version: 1,
    transcripts: { ...input.cursors.transcripts },
  };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { files, cursors };
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => {
      const file = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(file);
        const cursor = input.cursors.transcripts[file];
        const changed =
          !cursor ||
          stat.ino !== cursor.inode ||
          stat.size < cursor.offset ||
          stat.size > cursor.offset ||
          (stat.size === cursor.offset && stat.mtimeMs > cursor.mtimeMs);
        return changed ? { file, mtimeMs: stat.mtimeMs } : undefined;
      } catch {
        return undefined;
      }
    })
    .filter(
      (item): item is { file: string; mtimeMs: number } => item !== undefined,
    )
    // Process the oldest unprocessed transcript first. Picking the newest N
    // every run starves older sessions forever once the store has more than
    // N transcripts.
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .slice(0, MAX_TRANSCRIPTS)
    .map((item) => item.file);

  fs.mkdirSync(input.outDir, { recursive: true });
  for (const [index, file] of candidates.entries()) {
    try {
      const result = readIncrementalTranscript({
        file,
        cursor: input.cursors.transcripts[file],
        since: input.since,
      });
      if (!result) {
        // Nothing in this window (or only an incomplete line). Advance the
        // cursor so the same file does not hold a slot in every run.
        try {
          const stat = fs.statSync(file);
          cursors.transcripts[file] = {
            inode: stat.ino,
            offset: stat.size,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          };
        } catch {
          // The next run will try again.
        }
        continue;
      }
      const outName = `${String(index + 1).padStart(2, "0")}-${path.basename(file)}`;
      const outPath = path.join(input.outDir, outName);
      fs.writeFileSync(outPath, result.text, "utf-8");
      files.push({ path: outPath, name: outName });
      cursors.transcripts[file] = result.next;
    } catch {
      // One unreadable transcript must not lose the run; leave its cursor alone.
    }
  }

  return { files, cursors };
}

export function readAssistantSkills(workdir: string): Array<{ name: string; description: string; content: string }> {
  const root = skillRootForWorkdir(workdir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: Array<{ name: string; description: string; content: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = path.join(root, entry.name, "SKILL.md");
    try {
      const content = fs.readFileSync(file, "utf-8").slice(0, 12_000);
      const frontmatter = parseFrontmatter(content);
      skills.push({
        name: frontmatter.name || entry.name,
        description: frontmatter.description,
        content,
      });
    } catch {
      // not a skill directory
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function readOptionalText(file: string, maxChars: number): string {
  try {
    return fs.readFileSync(file, "utf-8").slice(0, maxChars);
  } catch {
    return "";
  }
}

export function readRecentObservations(file: string, now = Date.now()): string {
  let lines: string[];
  try {
    lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
  } catch {
    return "";
  }
  const cutoff = now - OBSERVATION_DAYS * 24 * 60 * 60 * 1000;
  const kept = lines.filter((line) => {
    try {
      const parsed = JSON.parse(line) as { day?: unknown };
      if (typeof parsed.day !== "string") return false;
      const at = Date.parse(parsed.day);
      return Number.isFinite(at) ? at >= cutoff : true;
    } catch {
      return false;
    }
  });
  return kept.slice(-OBSERVATION_LIMIT).join("\n");
}

export function appendSkillObservations(input: {
  file: string;
  candidates: SkillCandidate[];
  drafts: SkillDraft[];
  runId: string;
  day: string;
}): void {
  if (input.candidates.length === 0) return;
  fs.mkdirSync(path.dirname(input.file), { recursive: true });
  const draftNames = new Set(input.drafts.map((draft) => draft.name));
  const lines = input.candidates.map((candidate) =>
    JSON.stringify({
      type: "skill",
      intent: candidate.intent ?? candidate.name,
      name: candidate.name,
      day: input.day,
      runId: input.runId,
      action: candidate.action,
      created: draftNames.has(candidate.name),
      explicit: candidate.explicit === true,
      occurrenceDays: candidate.occurrenceDays ?? 1,
      description: candidate.description,
      summary: candidate.content.slice(0, 800),
      evidence: candidate.evidence,
    }),
  );
  fs.appendFileSync(input.file, `${lines.join("\n")}\n`, "utf-8");
}

function parseFrontmatter(content: string): { name: string; description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return { name: "", description: "", body: content };
  const raw = match[1];
  const field = (key: string): string => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(raw)?.[1] ?? "";
    return line.trim().replace(/^['"]|['"]$/g, "");
  };
  return {
    name: field("name"),
    description: field("description"),
    body: content.slice(match[0].length),
  };
}

export function lintSkillContent(name: string, content: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!NAME_RE.test(name) || name.length > 64) {
    issues.push("name must be lowercase letters, digits and hyphens, at most 64 chars");
  }
  if (Buffer.byteLength(content, "utf-8") > MAX_SKILL_BYTES) {
    issues.push(`SKILL.md is larger than ${MAX_SKILL_BYTES} bytes`);
  }
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter.name) issues.push("frontmatter is missing name");
  if (frontmatter.name && frontmatter.name !== name) {
    issues.push(`frontmatter name '${frontmatter.name}' does not match '${name}'`);
  }
  if (!frontmatter.description) issues.push("frontmatter is missing description");
  if (frontmatter.description.length > MAX_DESCRIPTION_CHARS) {
    issues.push(`description is longer than ${MAX_DESCRIPTION_CHARS} chars`);
  }
  if (!frontmatter.body.trim()) issues.push("SKILL.md has no body");
  if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
    issues.push("SKILL.md appears to contain a secret");
  }
  return { ok: issues.length === 0, issues };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEvidence(value: unknown): SkillEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      ...(typeof item.day === "string" ? { day: item.day } : {}),
      ...(typeof item.quote === "string" ? { quote: item.quote.slice(0, 300) } : {}),
      ...(typeof item.episodeId === "string" ? { episodeId: item.episodeId } : {}),
    }));
}

function normalizeCandidate(value: unknown): SkillCandidate | undefined {
  if (!isRecord(value)) return undefined;
  const name = typeof value.name === "string" ? value.name.trim().toLowerCase() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const content = typeof value.content === "string" ? value.content : "";
  if (!name || !description || !content) return undefined;
  const action = value.action === "update" ? "update" : "create";
  const confidence =
    typeof value.confidence === "number" && Number.isFinite(value.confidence)
      ? Math.max(0, Math.min(1, value.confidence))
      : 0.5;
  const occurrenceDays =
    typeof value.occurrenceDays === "number" && Number.isFinite(value.occurrenceDays)
      ? Math.max(1, Math.floor(value.occurrenceDays))
      : 1;
  return {
    action,
    name,
    description,
    ...(typeof value.intent === "string" ? { intent: value.intent.slice(0, 80) } : {}),
    content,
    evidence: normalizeEvidence(value.evidence),
    confidence,
    explicit: value.explicit === true,
    occurrenceDays,
  };
}

function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].pop();
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export function parseSkillCandidates(text: string): SkillCandidate[] {
  const parsed = extractJson(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) return [];
  return parsed.candidates
    .map(normalizeCandidate)
    .filter((candidate): candidate is SkillCandidate => Boolean(candidate))
    .slice(0, MAX_CANDIDATES);
}

export function writeSkillDrafts(input: {
  draftDir: string;
  candidates: SkillCandidate[];
  existingSkills?: Array<{ name: string; description?: string; content: string }>;
  suppressed?: Set<string>;
  suppressedNames?: Set<string>;
  runId: string;
  day: string;
}): SkillDraft[] {
  const drafts: SkillDraft[] = [];
  const seen = new Set<string>();
  const live = new Map(
    (input.existingSkills ?? []).map((skill) => [skill.name, skill]),
  );
  for (const candidate of input.candidates) {
    if (seen.has(candidate.name)) continue;
    seen.add(candidate.name);
    // Single occurrences still become reviewable drafts: the review page is
    // where a person decides whether one instance is enough. Bulk "adopt all
    // safe" excludes them; per-item adoption shows a first-occurrence warning.
    if (
      input.suppressedNames?.has(candidate.name) ||
      input.suppressed?.has(learningContentHash("skill", candidate.content))
    ) {
      continue;
    }
    const lint = lintSkillContent(candidate.name, candidate.content);
    if (!lint.ok) continue;
    const exists = live.has(candidate.name);
    const requested = candidate.action;
    let action: "create" | "update" = requested;
    if (requested === "update" && !exists) action = "create";
    if (requested === "create" && exists) action = "update";
    const dir = path.join(input.draftDir, "skills", candidate.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), candidate.content, "utf-8");
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify(
        {
          name: candidate.name,
          description: candidate.description,
          action,
          requestedAction: requested,
          intent: candidate.intent,
          evidence: candidate.evidence,
          confidence: candidate.confidence,
          explicit: candidate.explicit === true,
          occurrenceDays: candidate.occurrenceDays ?? 1,
          runId: input.runId,
          generatedAt: input.day,
        },
        null,
        2,
      ),
      "utf-8",
    );
    drafts.push({ ...candidate, action, lint });
  }
  return drafts;
}

export function readSkillDrafts(draftDir: string): SkillDraft[] {
  const root = path.join(draftDir, "skills");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const drafts: SkillDraft[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(root, entry.name);
    try {
      const content = fs.readFileSync(path.join(dir, "SKILL.md"), "utf-8");
      const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf-8")) as Partial<SkillCandidate>;
      const lint = lintSkillContent(entry.name, content);
      drafts.push({
        action: meta.action === "update" ? "update" : "create",
        name: entry.name,
        description: typeof meta.description === "string" ? meta.description : parseFrontmatter(content).description,
        ...(typeof meta.intent === "string" ? { intent: meta.intent } : {}),
        content,
        evidence: normalizeEvidence(meta.evidence),
        confidence: typeof meta.confidence === "number" ? meta.confidence : 0.5,
        explicit: meta.explicit === true,
        occurrenceDays:
          typeof meta.occurrenceDays === "number" ? meta.occurrenceDays : 1,
        lint,
      });
    } catch {
      // Half-written draft: not reviewable yet.
    }
  }
  return drafts.sort((a, b) => a.name.localeCompare(b.name));
}

export interface AdoptSkillOutcome {
  ok: boolean;
  error?: string;
  backupPath?: string;
  targetDir?: string;
}

export function adoptSkillDraft(input: {
  draftDir: string;
  name: string;
  workdir: string;
  backupRoot: string;
  now?: Date;
}): AdoptSkillOutcome {
  if (!NAME_RE.test(input.name) || input.name.length > 64) {
    return { ok: false, error: "invalid skill name" };
  }
  const draftSkillDir = path.join(input.draftDir, "skills", input.name);
  const draftFile = path.join(draftSkillDir, "SKILL.md");
  if (!fs.existsSync(draftFile)) {
    return { ok: false, error: "draft skill not found" };
  }
  const content = fs.readFileSync(draftFile, "utf-8");
  const lint = lintSkillContent(input.name, content);
  if (!lint.ok) {
    return { ok: false, error: `draft skill is invalid: ${lint.issues.join("; ")}` };
  }

  const liveRoot = skillRootForWorkdir(input.workdir);
  const targetDir = path.join(liveRoot, input.name);
  const at = input.now ?? new Date();
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(input.backupRoot, "skills", stamp, input.name);
  let backedUp: string | undefined;

  try {
    fs.mkdirSync(liveRoot, { recursive: true });
    if (fs.existsSync(targetDir)) {
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.cpSync(targetDir, backupPath, { recursive: true });
      backedUp = backupPath;
    }
    const temp = path.join(liveRoot, `.tmp-${crypto.randomUUID()}`);
    fs.cpSync(draftSkillDir, temp, { recursive: true });
    // Draft metadata is review state, not skill content.
    fs.rmSync(path.join(temp, "meta.json"), { force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(temp, targetDir);
    return { ok: true, backupPath: backedUp, targetDir };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      backupPath: backedUp,
    };
  }
}

export function resetLearningCursors(input: {
  home: string;
  now?: Date;
}): { removed: boolean; backupPath?: string } {
  const source = cursorsPath(input.home);
  if (!fs.existsSync(source)) return { removed: false };
  const stamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(learningRoot(input.home), "backups", stamp, "cursors.json");
  try {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(source, backupPath);
    fs.rmSync(source, { force: true });
    return { removed: true, backupPath };
  } catch {
    return { removed: false };
  }
}
