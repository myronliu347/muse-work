import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  lintMemoryDir,
  memoryDirStats,
  type MemoryDirStats,
  type MemoryLintResult,
} from "./memoryDreamLint.js";

/**
 * Adopt a dream draft: verify, back up, swap, verify again.
 *
 * The model never writes the live memory directory — it only writes the
 * draft. Adoption is a deterministic code path so an unattended night can be
 * rolled back without trusting the model's own report.
 */

export interface ApplyDreamResult {
  ok: boolean;
  reason?: "draft_missing" | "draft_lint" | "post_lint";
  backupPath?: string;
  stats?: MemoryDirStats;
  lint?: MemoryLintResult;
}

function timestampSlug(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return [
    at.getFullYear(),
    pad(at.getMonth() + 1),
    pad(at.getDate()),
    "T",
    pad(at.getHours()),
    "-",
    pad(at.getMinutes()),
    "-",
    pad(at.getSeconds()),
    "-",
    pad(at.getMilliseconds(), 3),
    // Two backups in the same millisecond (adopt immediately followed by a
    // rollback) must not share a directory: the second copy would merge into
    // the first and destroy the thing we are trying to restore.
    crypto.randomBytes(2).toString("hex"),
  ].join("");
}

function copyDir(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true });
}

export function backupMemoryDir(options: {
  memoryDir: string;
  backupRoot: string;
  targetId: string;
  now?: Date;
}): string {
  const at = options.now ?? new Date();
  const dir = path.join(options.backupRoot, options.targetId, timestampSlug(at));
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  copyDir(options.memoryDir, dir);
  return dir;
}

export function applyDream(options: {
  memoryDir: string;
  draftDir: string;
  backupRoot: string;
  targetId: string;
  now?: Date;
}): ApplyDreamResult {
  const { memoryDir, draftDir } = options;
  if (!fs.existsSync(draftDir)) {
    return { ok: false, reason: "draft_missing" };
  }

  const draftLint = lintMemoryDir(draftDir);
  if (!draftLint.ok) {
    return { ok: false, reason: "draft_lint", lint: draftLint };
  }

  // The draft is a complete store, so the swap is a directory replace rather
  // than a merge: files the dream retired disappear here, but the backup keeps
  // them recoverable.
  const backupPath = backupMemoryDir({
    memoryDir,
    backupRoot: options.backupRoot,
    targetId: options.targetId,
    now: options.now,
  });

  fs.rmSync(memoryDir, { recursive: true, force: true });
  copyDir(draftDir, memoryDir);

  const liveLint = lintMemoryDir(memoryDir);
  if (!liveLint.ok) {
    fs.rmSync(memoryDir, { recursive: true, force: true });
    copyDir(backupPath, memoryDir);
    return {
      ok: false,
      reason: "post_lint",
      backupPath,
      lint: liveLint,
    };
  }

  return {
    ok: true,
    backupPath,
    stats: memoryDirStats(memoryDir),
    lint: liveLint,
  };
}

export function rollbackMemoryDir(options: {
  memoryDir: string;
  backupPath: string;
  backupRoot: string;
  targetId: string;
  now?: Date;
}): ApplyDreamResult {
  if (!fs.existsSync(options.backupPath)) {
    return { ok: false, reason: "draft_missing" };
  }

  // Back up the current state first, so a rollback can itself be undone.
  const safety = backupMemoryDir({
    memoryDir: options.memoryDir,
    backupRoot: options.backupRoot,
    targetId: options.targetId,
    now: options.now,
  });

  fs.rmSync(options.memoryDir, { recursive: true, force: true });
  copyDir(options.backupPath, options.memoryDir);
  const lint = lintMemoryDir(options.memoryDir);
  if (!lint.ok) {
    // Leave the live store exactly as it was before the failed rollback.
    fs.rmSync(options.memoryDir, { recursive: true, force: true });
    copyDir(safety, options.memoryDir);
    return {
      ok: false,
      reason: "post_lint",
      backupPath: safety,
      stats: memoryDirStats(options.memoryDir),
      lint,
    };
  }
  return {
    ok: true,
    backupPath: safety,
    stats: memoryDirStats(options.memoryDir),
    lint,
  };
}

export function listBackups(backupRoot: string, targetId: string): string[] {
  const dir = path.join(backupRoot, targetId);
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
