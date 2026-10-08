import type { Skill, SkillMetadata } from "../types/skills.js";
import { discoverDiskSkills } from "./diskSkillDiscovery.js";
import { PluginLoader } from "../services/pluginLoader.js";

function pluginSkillMetadata(pluginName: string, skill: Skill): SkillMetadata {
  const namespacedName = `${pluginName}:${skill.name}`;
  return {
    name: namespacedName,
    description: skill.description,
    type: skill.type,
    skillPath: skill.skillPath,
    allowedTools: skill.allowedTools,
    context: skill.context,
    agent: skill.agent,
    model: skill.model,
    disableModelInvocation: skill.disableModelInvocation,
    userInvocable: skill.userInvocable,
    pluginName,
    pluginRoot: skill.pluginRoot,
  };
}

/**
 * List skill metadata for a workdir without starting a full Agent runtime.
 * Disk discovery matches SkillManager; plugin dirs mirror registerPluginSkills naming.
 */
export async function listSkillMetadataForWorkdir(
  workdir: string,
  pluginDirs: string[] = [],
): Promise<SkillMetadata[]> {
  const snapshot = await discoverDiskSkills({ workdir });
  const merged = new Map<string, SkillMetadata>();
  snapshot.metadata.forEach((metadata, name) => {
    merged.set(name, metadata);
  });

  for (const pluginPath of pluginDirs) {
    try {
      const manifest = await PluginLoader.loadManifest(pluginPath);
      const skills = await PluginLoader.loadSkills(pluginPath);
      for (const skill of skills) {
        if (!skill.isValid) continue;
        const metadata = pluginSkillMetadata(manifest.name, skill);
        merged.set(metadata.name, metadata);
      }
    } catch {
      // Skip broken plugin paths; same tolerance as partial plugin load at startup.
    }
  }

  return Array.from(merged.values());
}
