import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root =
  process.env.MUSE_PLUGIN_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let skill = "";
try {
  skill = fs.readFileSync(
    path.join(root, "skills", "using-superpowers", "SKILL.md"),
    "utf8",
  );
} catch {
  skill = "";
}

const additionalContext = skill
  ? `<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**Below is the full content of your 'superpowers:using-superpowers' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${skill}\n</EXTREMELY_IMPORTANT>`
  : "";

process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { additionalContext } }),
);
