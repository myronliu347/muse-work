import { describe, expect, it } from "vitest";
import {
  findUnresolvedSkillPlaceholders,
  substituteSkillPlaceholders,
} from "../../src/utils/skillPlaceholders.js";

describe("skill placeholders", () => {
  it("replaces skill-dir tokens, including the legacy names", () => {
    const text = substituteSkillPlaceholders(
      "Bash(node ${MUSE_SKILL_DIR}/a.mjs*) Bash(node ${WAVE_SKILL_DIR}/b.mjs*) Bash(node ${CLAUDE_SKILL_DIR}/c.mjs*)",
      { skillPath: "/skills/demo" },
    );
    expect(text).toBe(
      "Bash(node /skills/demo/a.mjs*) Bash(node /skills/demo/b.mjs*) Bash(node /skills/demo/c.mjs*)",
    );
  });

  it("leaves a plugin-root token in place when the skill is not from a plugin", () => {
    const text = substituteSkillPlaceholders("run ${MUSE_PLUGIN_ROOT}/x", {
      skillPath: "/skills/demo",
    });
    expect(findUnresolvedSkillPlaceholders(text)).toEqual([
      "${MUSE_PLUGIN_ROOT}",
    ]);
  });

  it("replaces the plugin root when one is known", () => {
    const text = substituteSkillPlaceholders(
      "Bash(python3 ${CLAUDE_PLUGIN_ROOT}/scripts/render.py*)",
      { skillPath: "/plugins/p/skills/demo", pluginRoot: "/plugins/p" },
    );
    expect(text).toBe("Bash(python3 /plugins/p/scripts/render.py*)");
    expect(findUnresolvedSkillPlaceholders(text)).toEqual([]);
  });
});
