import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverDiskSkills } from "../../src/shared/diskSkillDiscovery.js";

describe("discoverDiskSkills", () => {
  let workdir: string;

  afterEach(() => {
    if (workdir) {
      fs.rmSync(workdir, { recursive: true, force: true });
      workdir = "";
    }
  });

  it("finds a project skill under .muse-work/skills", async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-disk-skills-"));
    const configDir = process.env.MUSE_HOME_DIR ?? ".muse-work";
    const skillDir = path.join(workdir, configDir, "skills", "demo-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: from workdir\n---\n\n# Demo\n",
    );

    const snapshot = await discoverDiskSkills({ workdir });
    expect(snapshot.metadata.get("demo-skill")).toMatchObject({
      name: "demo-skill",
      description: "from workdir",
      type: "project",
    });
    expect(snapshot.content.get("demo-skill")?.content).toContain("# Demo");
  });
});
