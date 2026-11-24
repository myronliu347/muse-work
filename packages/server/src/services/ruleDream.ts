import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  configDirName,
  learningContentHash,
} from "./skillDream.js";

/**
 * Assistant-only rule drafts.
 *
 * Rules are always-on behavior instructions, not procedures. They live in the
 * assistant workdir's `.muse-work/rules/` so only that session's
 * MemoryRuleManager sees them. Drafts are reviewed and adopted one by one.
 */

const MAX_RULE_CHARS = 500;
const MAX_DESCRIPTION_CHARS = 200;
const MAX_CANDIDATES = 3;
const NAME_RE = /^[a-z0-9-]+$/;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

export interface RuleEvidence {
  day?: string;
  quote?: string;
  episodeId?: string;
}

export interface RuleCandidate {
  action?: "create" | "update";
  name: string;
  description: string;
  text: string;
  intent?: string;
  evidence: RuleEvidence[];
  confidence: number;
  explicit?: boolean;
  occurrenceDays?: number;
}

export interface RuleDraft extends RuleCandidate {
  action: "create" | "update";
  rendered: string;
  lint: { ok: boolean; issues: string[] };
}

export function ruleRootForWorkdir(workdir: string): string {
  return path.join(workdir, configDirName(), "rules");
}

function parseRuleFile(content: string): { name: string; description: string; text: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return { name: "", description: "", text: content.trim() };
  const raw = match[1];
  const field = (key: string): string => {
    const value = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(raw)?.[1] ?? "";
    return value.trim().replace(/^['"]|['"]$/g, "");
  };
  return {
    name: field("name"),
    description: field("description"),
    text: content.slice(match[0].length).trim(),
  };
}

export function readAssistantRules(
  workdir: string,
): Array<{ name: string; description: string; text: string }> {
  const root = ruleRootForWorkdir(workdir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const rules: Array<{ name: string; description: string; text: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    try {
      const parsed = parseRuleFile(
        fs.readFileSync(path.join(root, entry.name), "utf-8"),
      );
      rules.push({
        name: parsed.name || entry.name.slice(0, -".md".length),
        description: parsed.description,
        text: parsed.text,
      });
    } catch {
      // unreadable rule
    }
  }
  return rules.sort((a, b) => a.name.localeCompare(b.name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEvidence(value: unknown): RuleEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    ...(typeof item.day === "string" ? { day: item.day } : {}),
    ...(typeof item.quote === "string" ? { quote: item.quote.slice(0, 300) } : {}),
    ...(typeof item.episodeId === "string" ? { episodeId: item.episodeId } : {}),
  }));
}

function normalizeCandidate(value: unknown): RuleCandidate | undefined {
  if (!isRecord(value)) return undefined;
  const name = typeof value.name === "string" ? value.name.trim().toLowerCase() : "";
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!name || !text) return undefined;
  return {
    action: value.action === "update" ? "update" : "create",
    name,
    text,
    description:
      typeof value.description === "string"
        ? value.description.trim()
        : text.slice(0, 80),
    ...(typeof value.intent === "string" ? { intent: value.intent.slice(0, 80) } : {}),
    evidence: normalizeEvidence(value.evidence),
    confidence:
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? Math.max(0, Math.min(1, value.confidence))
        : 0.5,
    explicit: value.explicit === true,
    occurrenceDays:
      typeof value.occurrenceDays === "number" && Number.isFinite(value.occurrenceDays)
        ? Math.max(1, Math.floor(value.occurrenceDays))
        : 1,
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

export function parseRuleCandidates(text: string): RuleCandidate[] {
  const parsed = extractJson(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.rules)) return [];
  return parsed.rules
    .map(normalizeCandidate)
    .filter((candidate): candidate is RuleCandidate => Boolean(candidate))
    .slice(0, MAX_CANDIDATES);
}

function normalizeRuleText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function lintRuleContent(input: {
  name: string;
  text: string;
  description: string;
  agentsMd?: string;
  existingRules?: string[];
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!NAME_RE.test(input.name) || input.name.length > 64) {
    issues.push("name must be lowercase letters, digits and hyphens, at most 64 chars");
  }
  if (!input.text.trim()) issues.push("rule text is empty");
  if (input.text.length > MAX_RULE_CHARS) {
    issues.push(`rule is longer than ${MAX_RULE_CHARS} chars`);
  }
  if (input.description.length > MAX_DESCRIPTION_CHARS) {
    issues.push(`description is longer than ${MAX_DESCRIPTION_CHARS} chars`);
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(input.text))) {
    issues.push("rule appears to contain a secret");
  }
  const agents = normalizeRuleText(input.agentsMd ?? "");
  const rule = normalizeRuleText(input.text);
  if (agents && rule.length >= 12 && agents.includes(rule)) {
    issues.push("rule is already stated in AGENTS.md");
  }
  if (
    rule.length >= 12 &&
    (input.existingRules ?? []).some((existing) => normalizeRuleText(existing) === rule)
  ) {
    issues.push("rule already exists");
  }
  return { ok: issues.length === 0, issues };
}

function renderRuleFile(candidate: RuleCandidate): string {
  return [
    "---",
    `name: ${candidate.name}`,
    `description: ${JSON.stringify(candidate.description)}`,
    "---",
    "",
    candidate.text.trim(),
    "",
  ].join("\n");
}

export function writeRuleDrafts(input: {
  draftDir: string;
  candidates: RuleCandidate[];
  agentsMd?: string;
  existingRules?: Array<{ name: string; text: string }>;
  suppressed?: Set<string>;
  runId: string;
  day: string;
}): RuleDraft[] {
  const drafts: RuleDraft[] = [];
  const seen = new Set<string>();
  const live = new Map(
    (input.existingRules ?? []).map((rule) => [rule.name, rule]),
  );
  for (const candidate of input.candidates) {
    if (seen.has(candidate.name)) continue;
    seen.add(candidate.name);
    // Single occurrences still become reviewable drafts; bulk adopt excludes
    // them, per-item adoption warns.
    if (input.suppressed?.has(learningContentHash("rule", candidate.text))) {
      continue;
    }
    const lint = lintRuleContent({
      name: candidate.name,
      text: candidate.text,
      description: candidate.description,
      agentsMd: input.agentsMd,
      existingRules: (input.existingRules ?? []).map((rule) => rule.text),
    });
    if (!lint.ok) continue;
    const exists = live.has(candidate.name);
    const requested = candidate.action ?? "create";
    let action: "create" | "update" = requested;
    if (requested === "update" && !exists) action = "create";
    if (requested === "create" && exists) action = "update";
    const rendered = renderRuleFile(candidate);
    const dir = path.join(input.draftDir, "rules");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${candidate.name}.md`), rendered, "utf-8");
    fs.writeFileSync(
      path.join(dir, `${candidate.name}.json`),
      JSON.stringify(
        {
          action,
          requestedAction: requested,
          name: candidate.name,
          description: candidate.description,
          text: candidate.text,
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
    drafts.push({ ...candidate, action, rendered, lint });
  }
  return drafts;
}

export function readRuleDrafts(
  draftDir: string,
  agentsMd = "",
  existingRules: string[] = [],
): RuleDraft[] {
  const dir = path.join(draftDir, "rules");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const drafts: RuleDraft[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const name = entry.name.slice(0, -".json".length);
    try {
      const meta = JSON.parse(
        fs.readFileSync(path.join(dir, entry.name), "utf-8"),
      ) as Partial<RuleCandidate>;
      if (typeof meta.text !== "string") continue;
      const rendered = fs.readFileSync(path.join(dir, `${name}.md`), "utf-8");
      drafts.push({
        action: meta.action === "update" ? "update" : "create",
        name,
        description: typeof meta.description === "string" ? meta.description : "",
        text: meta.text,
        ...(typeof meta.intent === "string" ? { intent: meta.intent } : {}),
        evidence: normalizeEvidence(meta.evidence),
        confidence: typeof meta.confidence === "number" ? meta.confidence : 0.5,
        explicit: meta.explicit === true,
        occurrenceDays:
          typeof meta.occurrenceDays === "number" ? meta.occurrenceDays : 1,
        rendered,
        lint: lintRuleContent({
          name,
          text: meta.text,
          description: typeof meta.description === "string" ? meta.description : "",
          agentsMd,
          existingRules,
        }),
      });
    } catch {
      // half-written rule
    }
  }
  return drafts.sort((a, b) => a.name.localeCompare(b.name));
}

export function adoptRuleDraft(input: {
  draftDir: string;
  name: string;
  workdir: string;
  backupRoot: string;
  agentsMd?: string;
  existingRules?: string[];
  now?: Date;
}): { ok: boolean; error?: string; backupPath?: string; targetFile?: string } {
  if (!NAME_RE.test(input.name) || input.name.length > 64) {
    return { ok: false, error: "invalid rule name" };
  }
  const draftFile = path.join(input.draftDir, "rules", `${input.name}.md`);
  if (!fs.existsSync(draftFile)) {
    return { ok: false, error: "draft rule not found" };
  }
  const rendered = fs.readFileSync(draftFile, "utf-8");
  const metaFile = path.join(input.draftDir, "rules", `${input.name}.json`);
  let meta: Partial<RuleCandidate> = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaFile, "utf-8")) as Partial<RuleCandidate>;
  } catch {
    // fall through to a body-only lint below
  }
  const lint = lintRuleContent({
    name: input.name,
    text: typeof meta.text === "string" ? meta.text : rendered,
    description: typeof meta.description === "string" ? meta.description : "",
    agentsMd: input.agentsMd,
    existingRules: input.existingRules,
  });
  if (!lint.ok) {
    return { ok: false, error: `draft rule is invalid: ${lint.issues.join("; ")}` };
  }

  const liveRoot = ruleRootForWorkdir(input.workdir);
  const targetFile = path.join(liveRoot, `auto-${input.name}.md`);
  const stamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(
    input.backupRoot,
    "rules",
    stamp,
    `auto-${input.name}.md`,
  );
  let backupPath: string | undefined;
  try {
    fs.mkdirSync(liveRoot, { recursive: true });
    if (fs.existsSync(targetFile)) {
      fs.mkdirSync(path.dirname(backupFile), { recursive: true });
      fs.copyFileSync(targetFile, backupFile);
      backupPath = backupFile;
    }
    const temp = `${targetFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, rendered, "utf-8");
    fs.renameSync(temp, targetFile);
    return { ok: true, backupPath, targetFile };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      backupPath,
    };
  }
}

export function appendRuleObservations(input: {
  file: string;
  candidates: RuleCandidate[];
  drafts: RuleDraft[];
  runId: string;
  day: string;
}): void {
  if (input.candidates.length === 0) return;
  fs.mkdirSync(path.dirname(input.file), { recursive: true });
  const draftNames = new Set(input.drafts.map((draft) => draft.name));
  const lines = input.candidates.map((candidate) =>
    JSON.stringify({
      type: "rule",
      intent: candidate.intent ?? candidate.name,
      name: candidate.name,
      day: input.day,
      runId: input.runId,
      created: draftNames.has(candidate.name),
      explicit: candidate.explicit === true,
      occurrenceDays: candidate.occurrenceDays ?? 1,
      description: candidate.description,
      summary: candidate.text.slice(0, 500),
      evidence: candidate.evidence,
    }),
  );
  fs.appendFileSync(input.file, `${lines.join("\n")}\n`, "utf-8");
}

export function summarizeRuleDrafts(drafts: RuleDraft[]): Array<{
  name: string;
  description: string;
  text: string;
  confidence: number;
}> {
  return drafts.map((draft) => ({
    name: draft.name,
    description: draft.description,
    text: draft.text,
    confidence: draft.confidence,
  }));
}
