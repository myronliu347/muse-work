import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSkillMetadataForWorkdir } from "../../src/shared/skillMetadataPreview.js";
import { CONFIG_DIR_NAME } from "../../src/utils/constants.js";

describe("listSkillMetadataForWorkdir", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-preview-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("includes project skills from disk without Agent.create", async () => {
    const skillDir = path.join(tmp, CONFIG_DIR_NAME, "skills", "demo-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: demo-skill
description: Demo skill for preview list
---
body
`,
      "utf8",
    );

    const skills = await listSkillMetadataForWorkdir(tmp, []);
    expect(skills.some((s) => s.name === "demo-skill")).toBe(true);
  });
});
