import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { SkillMarketError } from "./errors.js";

export type LocatedSkill = {
  name: string;
  description: string;
  dir: string;
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
]);
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const CONTAINERS = [
  "skills",
  "skills/.curated",
  "skills/.experimental",
  "skills/.system",
  ".agents/skills",
  ".claude/skills",
  ".cline/skills",
  ".codebuddy/skills",
  ".codex/skills",
  ".commandcode/skills",
  ".continue/skills",
  ".factory/skills",
  ".github/skills",
  ".goose/skills",
  ".grok/skills",
  ".iflow/skills",
  ".junie/skills",
  ".kilo/skills",
  ".kilocode/skills",
  ".kimchi/skills",
  ".kiro/skills",
  ".minimax/skills",
  ".mux/skills",
  ".neovate/skills",
  ".opencode/skills",
  ".openhands/skills",
  ".pi/skills",
  ".posit/assistant/skills",
  ".qoder/skills",
  ".roo/skills",
  ".trae/skills",
  ".windsurf/skills",
  ".zcode/skills",
  ".zencoder/skills",
];

export function parseSkillMarkdown(
  raw: string,
): { name: string; description: string } | null {
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return null;
  const block = raw.slice(raw.indexOf("\n") + 1, end);
  let name = "";
  let description = "";
  for (const line of block.split("\n")) {
    const match = /^(name|description):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (match[1] === "name") name = value;
    else description = value;
  }
  if (!name || !description) return null;
  return { name, description };
}

export function isGitHubSource(
  source: string,
): { owner: string; repo: string } | null {
  const parts = source.split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    return null;
  }
  return { owner, repo };
}

export function isSafeSkillId(skillId: string): boolean {
  return (
    skillId.length > 0 &&
    skillId.length <= 128 &&
    !skillId.includes("/") &&
    !skillId.includes("\\") &&
    !skillId.includes("\0")
  );
}

export function isInstallDirName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0")
  );
}

async function readSkill(dir: string): Promise<LocatedSkill | null> {
  try {
    const file = path.join(dir, "SKILL.md");
    const info = await stat(file);
    if (!info.isFile()) return null;
    const parsed = parseSkillMarkdown(await readFile(file, "utf8"));
    if (!parsed) return null;
    return { ...parsed, dir };
  } catch {
    return null;
  }
}

async function walk(
  dir: string,
  maxDepth: number,
  depth: number,
  out: LocatedSkill[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const child = path.join(dir, entry.name);
    const found = await readSkill(child);
    if (found) {
      out.push(found);
      continue;
    }
    if (depth >= maxDepth) continue;
    await walk(child, maxDepth, depth + 1, out);
  }
}

async function walkAll(dir: string, out: LocatedSkill[]): Promise<void> {
  const found = await readSkill(dir);
  if (found) out.push(found);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    await walkAll(path.join(dir, entry.name), out);
  }
}

export async function locateSkill(
  repoRoot: string,
  skillId: string,
): Promise<LocatedSkill> {
  const rootSkill = await readSkill(repoRoot);
  const found: LocatedSkill[] = [];
  if (rootSkill) found.push(rootSkill);
  else {
    for (const container of CONTAINERS) {
      await walk(path.join(repoRoot, container), 3, 1, found);
    }
    if (found.length === 0) await walkAll(repoRoot, found);
  }
  const matches = found.filter(
    (skill) => skill.name.toLowerCase() === skillId.toLowerCase(),
  );
  if (matches.length === 0) {
    throw new SkillMarketError("仓库里没有这个技能", 404);
  }
  if (matches.length > 1) {
    throw new SkillMarketError("仓库里有多份同名技能", 409);
  }
  return matches[0];
}
