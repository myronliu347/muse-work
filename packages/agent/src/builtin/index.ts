import { code_reviewSkill } from "./skills/code-review.js";
import { deep_researchSkill } from "./skills/deep-research.js";
import { initSkill } from "./skills/init.js";
import { simplifySkill } from "./skills/simplify.js";
import { settingsSkills } from "./skills/settings.js";
import { subagents } from "./subagents.js";

export const BUILTIN_CONTENT: Record<string, string> = {
  ...code_reviewSkill,
  ...deep_researchSkill,
  ...initSkill,
  ...simplifySkill,
  ...settingsSkills,
  ...subagents,
};
