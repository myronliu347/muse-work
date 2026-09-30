import { initSkill } from "./skills/init.js";
import { settingsSkills } from "./skills/settings.js";
import { subagents } from "./subagents.js";

export const BUILTIN_CONTENT: Record<string, string> = {
  ...initSkill,
  ...settingsSkills,
  ...subagents,
};
