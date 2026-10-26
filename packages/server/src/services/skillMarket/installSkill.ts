import { lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copySkillDirectory } from "./copySkill.js";
import { SkillMarketError } from "./errors.js";
import {
  isGitHubSource,
  isInstallDirName,
  isSafeSkillId,
  locateSkill,
} from "./locateSkill.js";

export async function installMarketSkill(input: {
  source: string;
  skillId: string;
  home: string;
  clone: (repoUrl: string, dest: string) => Promise<void>;
}): Promise<{ name: string; path: string }> {
  const source = isGitHubSource(input.source);
  if (!source || !isSafeSkillId(input.skillId)) {
    throw new SkillMarketError("技能来源不正确", 400);
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "muse-skill-src-"));
  try {
    try {
      await input.clone(
        `https://github.com/${source.owner}/${source.repo}.git`,
        temp,
      );
    } catch (error) {
      if (error instanceof SkillMarketError) throw error;
      throw new SkillMarketError("仓库克隆失败", 502);
    }
    const located = await locateSkill(temp, input.skillId);
    if (!isInstallDirName(located.name)) {
      throw new SkillMarketError("技能名不能作为目录", 400);
    }
    const dest = path.join(input.home, ".agents", "skills", located.name);
    try {
      await lstat(dest);
      throw new SkillMarketError("已经安装", 409);
    } catch (error) {
      if (error instanceof SkillMarketError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw new SkillMarketError("已经安装", 409);
    }
    await copySkillDirectory(located.dir, dest);
    return { name: located.name, path: dest };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
