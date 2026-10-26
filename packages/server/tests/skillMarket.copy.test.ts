import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copySkillDirectory } from "../src/services/skillMarket/copySkill.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "muse-copy-"));
  homes.push(dir);
  return dir;
}

describe("copySkillDirectory", () => {
  it("copies files and turns an internal symlink into file contents", async () => {
    const root = await tmp();
    const src = path.join(root, "src");
    const dest = path.join(root, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "SKILL.md"), "hello");
    await symlink("SKILL.md", path.join(src, "alias.md"));
    await copySkillDirectory(src, dest);
    expect(await readFile(path.join(dest, "alias.md"), "utf8")).toBe("hello");
    expect((await lstat(path.join(dest, "alias.md"))).isSymbolicLink()).toBe(
      false,
    );
  });

  it("removes the destination when a symlink escapes the skill", async () => {
    const root = await tmp();
    const src = path.join(root, "src");
    const dest = path.join(root, "dest");
    const outside = path.join(root, "secret.txt");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "SKILL.md"), "hello");
    await writeFile(outside, "secret");
    await symlink(outside, path.join(src, "leak.md"));
    await expect(copySkillDirectory(src, dest)).rejects.toMatchObject({
      message: "技能含有指向目录外的链接",
    });
    await expect(lstat(dest)).rejects.toThrow();
  });

  it("removes the destination when a file is over 10 MiB", async () => {
    const root = await tmp();
    const src = path.join(root, "src");
    const dest = path.join(root, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "SKILL.md"), "hello");
    await writeFile(path.join(src, "big.bin"), Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(copySkillDirectory(src, dest)).rejects.toMatchObject({
      message: "技能文件过大",
    });
    await expect(lstat(dest)).rejects.toThrow();
  });
});
