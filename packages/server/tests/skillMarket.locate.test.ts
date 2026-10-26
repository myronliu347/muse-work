import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillMarketError } from "../src/services/skillMarket/errors.js";
import {
  isGitHubSource,
  isSafeSkillId,
  locateSkill,
} from "../src/services/skillMarket/locateSkill.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function repo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "muse-skill-"));
  homes.push(dir);
  return dir;
}

async function skill(dir: string, name: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: about ${name}\n---\n`,
  );
}

describe("locateSkill", () => {
  it("rejects unsafe source and skill id", () => {
    expect(isGitHubSource("vercel-labs/skills")).toEqual({
      owner: "vercel-labs",
      repo: "skills",
    });
    expect(isGitHubSource("a/../b")).toBeNull();
    expect(isGitHubSource("https://github.com/a/b")).toBeNull();
    expect(isSafeSkillId("find-skills")).toBe(true);
    expect(isSafeSkillId("a/b")).toBe(false);
  });

  it("keeps only the root skill when the repo root has SKILL.md", async () => {
    const root = await repo();
    await skill(root, "root-skill");
    await skill(path.join(root, "skills", "other"), "other");
    await expect(locateSkill(root, "other")).rejects.toMatchObject({
      message: "仓库里没有这个技能",
      status: 404,
    });
    await expect(locateSkill(root, "Root-Skill")).resolves.toMatchObject({
      name: "root-skill",
    });
  });

  it("matches skills/name and a three-level container path by frontmatter", async () => {
    const root = await repo();
    await skill(path.join(root, "skills", "find-skills"), "find-skills");
    const hit = await locateSkill(root, "Find-Skills");
    expect(hit.dir).toBe(path.join(root, "skills", "find-skills"));

    const nested = await repo();
    await skill(path.join(nested, "skills", "a", "b", "deep"), "deep");
    await expect(locateSkill(nested, "deep")).resolves.toMatchObject({
      name: "deep",
    });
  });

  it("does not recurse to a fourth level when another container skill exists", async () => {
    const root = await repo();
    await skill(path.join(root, "skills", "other"), "other");
    await skill(path.join(root, "skills", "a", "b", "c", "hidden"), "hidden");
    await expect(locateSkill(root, "hidden")).rejects.toBeInstanceOf(
      SkillMarketError,
    );
  });

  it("recurses when no container skill exists", async () => {
    const root = await repo();
    await skill(path.join(root, "examples", "a", "b", "c", "hidden"), "hidden");
    await expect(locateSkill(root, "hidden")).resolves.toMatchObject({
      name: "hidden",
    });
  });

  it("does not match the directory name, and rejects duplicates", async () => {
    const root = await repo();
    await skill(path.join(root, "skills", "find-skills"), "something-else");
    await expect(locateSkill(root, "find-skills")).rejects.toMatchObject({
      message: "仓库里没有这个技能",
    });

    const dup = await repo();
    await skill(path.join(dup, "skills", "one"), "same");
    await skill(path.join(dup, ".claude", "skills", "two"), "same");
    await expect(locateSkill(dup, "same")).rejects.toMatchObject({
      message: "仓库里有多份同名技能",
      status: 409,
    });
  });
});
