import { lstat, readdir, readFile, realpath, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { SkillMarketError } from "./errors.js";
import { parseSkillMarkdown } from "./locateSkill.js";

export type InstalledSkill = {
  name: string;
  description: string;
  path: string;
};

export function personalSkillRoots(
  home: string,
  configDirName = process.env.MUSE_HOME_DIR ?? ".muse-work",
): string[] {
  return [
    path.join(home, ".agents", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, configDirName, "skills"),
  ];
}

export async function listInstalledSkills(
  home: string,
  configDirName?: string,
): Promise<InstalledSkill[]> {
  const skills: InstalledSkill[] = [];
  for (const root of personalSkillRoots(home, configDirName)) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const dir = path.join(root, entry.name);
      try {
        const parsed = parseSkillMarkdown(
          await readFile(path.join(dir, "SKILL.md"), "utf8"),
        );
        if (!parsed) continue;
        skills.push({ ...parsed, path: dir });
      } catch {
        continue;
      }
    }
  }
  return skills;
}

export async function readInstalledSkillDetail(
  home: string,
  targetPath: string,
  configDirName?: string,
): Promise<InstalledSkill & { body: string }> {
  const resolved = path.resolve(targetPath);
  const roots = personalSkillRoots(home, configDirName).map((root) =>
    path.resolve(root),
  );
  if (!roots.includes(path.dirname(resolved))) {
    throw new SkillMarketError("不能读取这个路径", 400);
  }
  let raw: string;
  try {
    raw = await readFile(path.join(resolved, "SKILL.md"), "utf8");
  } catch {
    throw new SkillMarketError("找不到这个技能", 404);
  }
  const parsed = parseSkillMarkdown(raw);
  if (!parsed) throw new SkillMarketError("找不到这个技能", 404);
  const end = raw.indexOf("\n---", 3);
  const body = raw.slice(end + 4).trim().slice(0, 12_000);
  return { ...parsed, path: resolved, body };
}

export async function uninstallInstalledSkill(
  home: string,
  targetPath: string,
  configDirName?: string,
): Promise<void> {
  const resolved = path.resolve(targetPath);
  const roots = personalSkillRoots(home, configDirName).map((root) =>
    path.resolve(root),
  );
  const parent = path.dirname(resolved);
  if (!roots.includes(parent)) {
    throw new SkillMarketError("不能卸载这个路径", 400);
  }
  const info = await lstat(resolved);
  if (info.isSymbolicLink()) {
    await unlink(resolved);
    return;
  }
  if (!info.isDirectory()) {
    throw new SkillMarketError("不能卸载这个路径", 400);
  }
  const real = await realpath(resolved);
  if (real !== resolved && !real.startsWith(parent + path.sep)) {
    throw new SkillMarketError("不能卸载这个路径", 400);
  }
  await rm(resolved, { recursive: true, force: true });
}
