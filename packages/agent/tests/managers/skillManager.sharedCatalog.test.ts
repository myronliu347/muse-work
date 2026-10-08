import { describe, it, expect, afterEach } from "vitest";
import { SkillManager } from "../../src/managers/skillManager.js";
import { Container } from "../../src/utils/container.js";
import { resetSharedCatalogsForTests } from "../../src/shared/testing.js";
import type { Skill } from "../../src/types/index.js";

describe("SkillManager shared catalog isolation", () => {
  const workdir = "/tmp/shared-catalog-isolation-wd";

  afterEach(async () => {
    await resetSharedCatalogsForTests();
  });

  it("plugin skills on manager A are not visible on manager B for same workdir", async () => {
    const containerA = new Container();
    const managerA = new SkillManager(containerA, { workdir, watch: false });
    await managerA.initialize();

    const pluginSkill: Skill = {
      name: "only-a",
      description: "plugin",
      type: "project",
      skillPath: "/plugin/skills/only-a",
      content: "---\nname: only-a\n---\n",
      frontmatter: { name: "only-a", description: "plugin" },
      isValid: true,
      errors: [],
      pluginRoot: "/plugin",
    };
    managerA.registerPluginSkills("my-plugin", [pluginSkill]);

    const containerB = new Container();
    const managerB = new SkillManager(containerB, { workdir, watch: false });
    await managerB.initialize();

    expect(
      managerA.getAvailableSkills().some((s) => s.name === "my-plugin:only-a"),
    ).toBe(true);
    expect(
      managerB.getAvailableSkills().some((s) => s.name === "my-plugin:only-a"),
    ).toBe(false);

    await managerA.destroy();
    await managerB.destroy();
  });
});
