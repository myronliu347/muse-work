import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import type { Issue, IssuesFile } from "./issueStore.js";

/** Local calendar month bucket for closed-issue JSONL files (`YYYY-MM.jsonl`). */
export function closedIssuesMonthKey(updatedAt: number): string {
  const d = new Date(updatedAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function getClosedIssuesDir(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "issues-closed");
}

export function getLegacyClosedIssuesIndexPath(home: string): string {
  return path.join(getMuseHomeDir(home), "db", "issues-closed.json");
}

function closedJsonlPath(home: string, monthKey: string): string {
  return path.join(getClosedIssuesDir(home), `${monthKey}.jsonl`);
}

function writeAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function loadLegacyClosedFile(home: string): IssuesFile {
  const filePath = getLegacyClosedIssuesIndexPath(home);
  if (!fs.existsSync(filePath)) {
    return { version: 1, issues: [] };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as IssuesFile;
}

function mergeById(into: Map<string, Issue>, issue: Issue): void {
  const prev = into.get(issue.id);
  if (!prev || issue.updatedAt >= prev.updatedAt) {
    into.set(issue.id, issue);
  }
}

function readJsonlRecords(home: string): Map<string, Issue> {
  const byId = new Map<string, Issue>();
  const dir = getClosedIssuesDir(home);
  if (!fs.existsSync(dir)) {
    return byId;
  }
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    const filePath = path.join(dir, name);
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed) as Issue;
        if (!record?.id) continue;
        mergeById(byId, record);
      } catch {
        // skip corrupt lines
      }
    }
  }
  return byId;
}

/** Load closed issues from monthly JSONL (and one-time legacy index if present). */
export function loadClosedIssues(
  home: string,
  hydrate: (record: Issue) => Issue,
  isTerminal: (status: Issue["status"]) => boolean,
): Issue[] {
  const byId = readJsonlRecords(home);
  const legacyPath = getLegacyClosedIssuesIndexPath(home);
  if (fs.existsSync(legacyPath)) {
    for (const record of loadLegacyClosedFile(home).issues) {
      if (!record?.id) continue;
      const issue = hydrate(record);
      if (isTerminal(issue.status)) {
        mergeById(byId, issue);
      }
    }
  }
  return [...byId.values()];
}

/** Rewrite monthly JSONL from the closed set; removes empty month files. */
export function saveClosedIssues(
  home: string,
  closedIssues: Issue[],
): void {
  const dir = getClosedIssuesDir(home);
  fs.mkdirSync(dir, { recursive: true });

  const byMonth = new Map<string, Issue[]>();
  for (const issue of closedIssues) {
    const key = closedIssuesMonthKey(issue.updatedAt);
    const list = byMonth.get(key) ?? [];
    list.push(issue);
    byMonth.set(key, list);
  }

  const activeMonths = new Set(byMonth.keys());
  for (const [monthKey, list] of byMonth) {
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    const body = list.map((issue) => JSON.stringify(issue)).join("\n");
    writeAtomically(
      closedJsonlPath(home, monthKey),
      body ? `${body}\n` : "",
    );
  }

  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const monthKey = name.slice(0, -".jsonl".length);
      if (!activeMonths.has(monthKey)) {
        fs.unlinkSync(path.join(dir, name));
      }
    }
  }
}

/** After JSONL persist, retire legacy monolithic index if it still exists. */
export function finalizeLegacyClosedIndexMigration(home: string): void {
  const legacyPath = getLegacyClosedIssuesIndexPath(home);
  if (!fs.existsSync(legacyPath)) return;
  const migrated = `${legacyPath}.migrated`;
  if (fs.existsSync(migrated)) {
    fs.unlinkSync(legacyPath);
    return;
  }
  fs.renameSync(legacyPath, migrated);
}
