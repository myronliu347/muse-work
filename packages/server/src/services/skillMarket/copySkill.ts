import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SkillMarketError } from "./errors.js";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 1000;
const MAX_FILE = 10 * 1024 * 1024;

type Budget = { bytes: number; files: number };

function insideRoot(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

async function writeWithinBudget(
  from: string,
  to: string,
  budget: Budget,
): Promise<void> {
  const data = await readFile(from);
  if (data.byteLength > MAX_FILE || budget.bytes + data.byteLength > MAX_BYTES) {
    throw new SkillMarketError("技能文件过大", 400);
  }
  budget.files += 1;
  if (budget.files > MAX_FILES) throw new SkillMarketError("技能文件过大", 400);
  budget.bytes += data.byteLength;
  await writeFile(to, data);
}

async function copyTree(
  srcRoot: string,
  current: string,
  dest: string,
  budget: Budget,
  seen: Set<string>,
): Promise<void> {
  if (seen.has(current)) return;
  seen.add(current);
  const entries = await readdir(current, { withFileTypes: true });
  await mkdir(dest, { recursive: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const from = path.join(current, entry.name);
    const to = path.join(dest, entry.name);
    const listed = await lstat(from);
    if (listed.isSymbolicLink()) {
      let target: string;
      try {
        target = await realpath(from);
      } catch {
        throw new SkillMarketError("技能含有指向目录外的链接", 400);
      }
      if (!insideRoot(srcRoot, target)) {
        throw new SkillMarketError("技能含有指向目录外的链接", 400);
      }
      const linked = await lstat(target);
      if (linked.isDirectory()) {
        await copyTree(srcRoot, target, to, budget, seen);
        continue;
      }
      await writeWithinBudget(target, to, budget);
      continue;
    }
    if (listed.isDirectory()) {
      await copyTree(srcRoot, from, to, budget, seen);
      continue;
    }
    if (!listed.isFile()) continue;
    await writeWithinBudget(from, to, budget);
  }
}

export async function copySkillDirectory(src: string, dest: string): Promise<void> {
  const srcRoot = await realpath(src);
  await mkdir(dest, { recursive: true });
  try {
    await copyTree(srcRoot, srcRoot, dest, { bytes: 0, files: 0 }, new Set());
  } catch (error) {
    await rm(dest, { recursive: true, force: true });
    throw error;
  }
}
