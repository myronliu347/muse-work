#!/usr/bin/env node
/**
 * One-off cleanup: drop the sessions that closed issues still own.
 *
 * Closing an issue is supposed to delete its planning/execution sessions. The
 * assistant's `CloseIssue` tool skipped that step for a while, so closed issues
 * keep holding session records that no longer belong in the store.
 *
 * Safe by default: without `--apply` it only reports what would be removed.
 * With `--apply` it backs up sessions.json, removes the records and rewrites
 * the file atomically. Transcript files stay on disk unless
 * `--delete-transcripts` is passed.
 *
 * Stop Muse before running with `--apply`: the running server keeps
 * sessions.json in memory and would overwrite the rewrite on its next save.
 *
 * Usage:
 *   node scripts/cleanup-closed-issue-sessions.mjs                 # dry run
 *   node scripts/cleanup-closed-issue-sessions.mjs --apply         # rewrite
 *   node scripts/cleanup-closed-issue-sessions.mjs --apply --delete-transcripts
 *   node scripts/cleanup-closed-issue-sessions.mjs --home /path/to/.muse-work
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const apply = flag("--apply");
const deleteTranscripts = flag("--delete-transcripts");
const home = path.resolve(option("--home", path.join(os.homedir(), ".muse-work")));
const sessionsFile = path.join(home, "sessions.json");
const closedDir = path.join(home, "db", "issues-closed");
const projectsDir = path.join(home, "projects");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(sessionsFile)) fail(`sessions.json not found at ${sessionsFile}`);

const raw = JSON.parse(fs.readFileSync(sessionsFile, "utf8"));
const sessions = Array.isArray(raw) ? raw : raw.sessions;
if (!Array.isArray(sessions)) fail("sessions.json has no sessions array");

/** @returns {Array<{id: string, title?: string, status?: string, planningSessionId?: string, executionSessionId?: string}>} */
function loadClosedIssues() {
  if (!fs.existsSync(closedDir)) return [];
  const issues = [];
  for (const name of fs.readdirSync(closedDir).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    const body = fs.readFileSync(path.join(closedDir, name), "utf8");
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        issues.push(JSON.parse(trimmed));
      } catch {
        // Skip a corrupt archive line rather than aborting the whole sweep.
      }
    }
  }
  return issues;
}

const closedIssues = loadClosedIssues();
if (closedIssues.length === 0) fail(`no closed issues found under ${closedDir}`);

/** sessionId -> owning issue id */
const ownedSessionIds = new Map();
for (const issue of closedIssues) {
  for (const sessionId of [issue.planningSessionId, issue.executionSessionId]) {
    if (typeof sessionId === "string" && sessionId) ownedSessionIds.set(sessionId, issue.id);
  }
}

const doomed = sessions.filter((session) => ownedSessionIds.has(session.id));
const kept = sessions.filter((session) => !ownedSessionIds.has(session.id));
const alreadyGone = [...ownedSessionIds.keys()].filter(
  (id) => !sessions.some((session) => session.id === id),
);

const byMonth = new Map();
for (const session of doomed) {
  const issue = closedIssues.find((entry) => entry.id === ownedSessionIds.get(session.id));
  const stamp = new Date(issue?.updatedAt ?? 0).toISOString().slice(0, 7);
  byMonth.set(stamp, (byMonth.get(stamp) ?? 0) + 1);
}

console.log(`home            ${home}`);
console.log(`closed issues   ${closedIssues.length}`);
console.log(`owned sessions  ${ownedSessionIds.size}`);
console.log(`in store        ${doomed.length}`);
console.log(`already gone    ${alreadyGone.length}`);
console.log("by close month  " + [...byMonth.entries()].sort().map(([m, n]) => `${m}:${n}`).join("  "));
console.log("");
console.log("first 10 to remove:");
for (const session of doomed.slice(0, 10)) {
  console.log(`  ${session.id}  ${(session.title ?? "").slice(0, 48)}`);
}

if (!apply) {
  console.log("");
  console.log("dry run — nothing written. Re-run with --apply to remove them.");
  process.exit(0);
}

if (doomed.length === 0 && !deleteTranscripts) {
  console.log("nothing to do");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = `${sessionsFile}.${stamp}.bak`;
fs.copyFileSync(sessionsFile, backupFile);
console.log(`\nbackup          ${backupFile}`);

const next = Array.isArray(raw) ? kept : { ...raw, sessions: kept };
if (!Array.isArray(raw) && raw.activeSessionId && ownedSessionIds.has(raw.activeSessionId)) {
  delete next.activeSessionId;
}
const tmpFile = `${sessionsFile}.${process.pid}.tmp`;
fs.writeFileSync(tmpFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
fs.renameSync(tmpFile, sessionsFile);
console.log(`removed         ${doomed.length} session records`);

if (deleteTranscripts) {
  let removed = 0;
  const transcriptIds = new Set(
    doomed.map((session) => session.museSessionId).filter(Boolean),
  );
  if (fs.existsSync(projectsDir)) {
    for (const projectDirName of fs.readdirSync(projectsDir)) {
      const projectDir = path.join(projectsDir, projectDirName);
      if (!fs.statSync(projectDir).isDirectory()) continue;
      for (const name of fs.readdirSync(projectDir)) {
        if (!name.endsWith(".jsonl")) continue;
        const id = name.slice(0, -".jsonl".length);
        if (!transcriptIds.has(id)) continue;
        fs.rmSync(path.join(projectDir, name), { force: true });
        removed += 1;
      }
    }
  }
  console.log(`transcripts     removed ${removed} files`);
} else {
  console.log("transcripts     kept on disk (pass --delete-transcripts to remove them)");
}

console.log("\ndone. Start Muse again.");
