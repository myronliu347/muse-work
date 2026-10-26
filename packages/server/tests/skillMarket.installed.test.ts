import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listInstalledSkills,
  personalSkillRoots,
  uninstallInstalledSkill,
} from "../src/services/skillMarket/installedSkills.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function home(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "muse-installed-"));
  homes.push(dir);
  return dir;
}

async function writeSkill(dir: string, name: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: about ${name}\n---\n`,
  );
}

describe("installed skills", () => {
  it("lists skills from the three personal roots and skips invalid dirs", async () => {
    const dir = await home();
    const [agents, claude, muse] = personalSkillRoots(dir, ".muse-work");
    await writeSkill(path.join(agents, "find-skills"), "find-skills");
    await writeSkill(path.join(claude, "grill"), "grill");
    await mkdir(path.join(muse, "empty"), { recursive: true });
    const skills = await listInstalledSkills(dir, ".muse-work");
    expect(skills.map((skill) => skill.name).sort()).toEqual([
      "find-skills",
      "grill",
    ]);
  });

  it("unlinks a direct-child symlink and refuses a path outside the roots", async () => {
    const dir = await home();
    const [agents] = personalSkillRoots(dir, ".muse-work");
    const real = path.join(dir, "real");
    await writeSkill(real, "real");
    await mkdir(agents, { recursive: true });
    const link = path.join(agents, "real");
    await symlink(real, link);
    await uninstallInstalledSkill(dir, link, ".muse-work");
    await expect(listInstalledSkills(dir, ".muse-work")).resolves.toEqual([]);
    await expect(
      uninstallInstalledSkill(dir, real, ".muse-work"),
    ).rejects.toMatchObject({ status: 400 });
  });
});
