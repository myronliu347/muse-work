import { rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";
import type { DiskSkillSnapshot } from "../shared/diskSkillDiscovery.js";
import { discoverDiskSkills } from "../shared/diskSkillDiscovery.js";
import {
  acquireSkillCatalog,
  requestSkillCatalogRefresh,
  type SkillCatalogHandle,
} from "../shared/sharedSkillCatalog.js";
import type {
  SkillManagerOptions,
  SkillMetadata,
  Skill,
  SkillToolArgs,
  SkillInvocationContext,
} from "../types/index.js";
import { formatSkillError } from "../utils/skillParser.js";
import { substituteCommandParameters } from "../utils/commandArgumentParser.js";
import {
  parseBashCommands,
  replaceBashCommandsWithOutput,
  executeBashCommands,
} from "../utils/markdownParser.js";
import { substitutePluginRoot, substituteSkillDir } from "../utils/museEnv.js";

import { Container } from "../utils/container.js";
import { logger } from "../utils/globalLogger.js";

import { CONFIG_DIR_NAME } from "../utils/constants.js";
/**
 * Manages skill discovery and loading
 */
export class SkillManager extends EventEmitter {
  private personalSkillsPath: string;
  private personalClaudeSkillsPath: string;
  private personalAgentsSkillsPath: string;
  private scanTimeout: number;
  private workdir: string;

  private skillMetadata = new Map<string, SkillMetadata>();
  private skillContent = new Map<string, Skill>();
  private pluginSkillMetadata = new Map<string, SkillMetadata>();
  private pluginSkillContent = new Map<string, Skill>();
  private initialized = false;
  /** Serializes full rescans (initialize / file-watcher events / deleteSkill
   *  convergence). Overlapping scans over the shared caches must not interleave:
   *  chaining them keeps the last completed scan in sync with the newest disk
   *  state instead of letting an older snapshot win a race. */
  private refreshChain: Promise<void> = Promise.resolve();
  private catalogHandle: SkillCatalogHandle | null = null;
  private watchEnabled: boolean;

  constructor(
    private container: Container,
    options: SkillManagerOptions = {},
  ) {
    super();
    this.personalSkillsPath =
      options.personalSkillsPath || join(homedir(), CONFIG_DIR_NAME, "skills");
    this.personalClaudeSkillsPath =
      options.personalClaudeSkillsPath || join(homedir(), ".claude", "skills");
    this.personalAgentsSkillsPath =
      options.personalAgentsSkillsPath || join(homedir(), ".agents", "skills");
    this.scanTimeout = options.scanTimeout || 5000;
    this.workdir = options.workdir || process.cwd();
    this.watchEnabled = options.watch ?? false;
  }

  /**
   * Initialize the skill manager by discovering available skills
   */
  async initialize(): Promise<void> {
    logger?.debug("Initializing SkillManager...");

    if (this.catalogHandle) {
      await requestSkillCatalogRefresh(this.workdir);
      return;
    }

    try {
      this.catalogHandle = await acquireSkillCatalog(
        this.workdir,
        {
          watch: this.watchEnabled,
          discovery: {
            personalSkillsPath: this.personalSkillsPath,
            personalClaudeSkillsPath: this.personalClaudeSkillsPath,
            personalAgentsSkillsPath: this.personalAgentsSkillsPath,
          },
        },
        async (snapshot) => {
          await this.applyDiskSnapshot(snapshot, { direct: true });
        },
      );

      this.initialized = true;
      logger?.debug(
        `SkillManager initialized with ${this.skillMetadata.size} skills`,
      );
    } catch (error) {
      logger?.error("Failed to initialize SkillManager:", error);
      throw error;
    }
  }

  /**
   * Refresh skills by re-discovering them
   */
  private refreshSkills(): Promise<void> {
    // Serialize rescans: initialize / file-watcher events / deleteSkill all
    // trigger full re-scans; running them concurrently makes a stale snapshot
    // or a partial cache (see performRefresh's atomic swap) observable to
    // metadata readers such as the settings-page skill list.
    const run = this.refreshChain.then(() => this.performRefresh());
    this.refreshChain = run.catch(() => {});
    return run;
  }

  private async performRefresh(): Promise<void> {
    if (this.catalogHandle) {
      await requestSkillCatalogRefresh(this.workdir);
      return;
    }

    const snapshot = await discoverDiskSkills({
      workdir: this.workdir,
      personalSkillsPath: this.personalSkillsPath,
      personalClaudeSkillsPath: this.personalClaudeSkillsPath,
      personalAgentsSkillsPath: this.personalAgentsSkillsPath,
    });
    await this.applyDiskSnapshot(snapshot);
  }

  private async applyDiskSnapshot(
    snapshot: DiskSkillSnapshot,
    options?: { direct?: boolean },
  ): Promise<void> {
    if (options?.direct) {
      this.swapDiskSnapshot(snapshot);
      return;
    }
    const run = this.refreshChain.then(() => this.swapDiskSnapshot(snapshot));
    this.refreshChain = run.catch(() => {});
    return run;
  }

  private swapDiskSnapshot(snapshot: DiskSkillSnapshot): void {
    const nextMetadata = new Map<string, SkillMetadata>();
    const nextContent = new Map<string, Skill>();

    snapshot.metadata.forEach((skill, name) => {
      nextMetadata.set(name, skill);
    });
    snapshot.content.forEach((skill, name) => {
      nextContent.set(name, skill);
    });

    this.pluginSkillMetadata.forEach((metadata, name) => {
      nextMetadata.set(name, metadata);
    });
    this.pluginSkillContent.forEach((skill, name) => {
      nextContent.set(name, skill);
    });

    if (snapshot.errors.length > 0) {
      logger?.warn(`Found ${snapshot.errors.length} skill discovery errors`);
      snapshot.errors.forEach((error) => {
        logger?.warn(`Skill error in ${error.skillPath}: ${error.message}`);
      });
    }

    this.skillMetadata = nextMetadata;
    this.skillContent = nextContent;
    this.emit("refreshed", Array.from(this.skillMetadata.values()));
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    this.catalogHandle?.unsubscribe();
    this.catalogHandle = null;
  }

  /**
   * Check if the skill manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get all available skills metadata
   */
  getAvailableSkills(): SkillMetadata[] {
    if (!this.initialized) {
      throw new Error("SkillManager not initialized. Call initialize() first.");
    }

    return Array.from(this.skillMetadata.values());
  }

  /**
   * Get metadata for a specific skill by name
   */
  getSkillMetadata(name: string): SkillMetadata | undefined {
    if (!this.initialized) {
      throw new Error("SkillManager not initialized. Call initialize() first.");
    }

    return this.skillMetadata.get(name);
  }

  /**
   * Load a specific skill by name
   * Returns the skill content that was loaded during initialization
   */
  async loadSkill(skillName: string): Promise<Skill | null> {
    if (!this.initialized) {
      throw new Error("SkillManager not initialized. Call initialize() first.");
    }

    // Return skill content that was loaded during initialization
    const skill = this.skillContent.get(skillName);
    if (skill) {
      logger?.debug(`Skill '${skillName}' retrieved from loaded content`);
      return skill;
    }

    logger?.debug(`Skill '${skillName}' not found`);
    return null;
  }

  /**
   * Re-scan skill directories after a live configuration reload so slash
   * commands stay in sync with files on disk.
   */
  async reloadFeatureGatedSkills(): Promise<void> {
    if (this.catalogHandle) {
      await requestSkillCatalogRefresh(this.workdir);
      return;
    }
    await this.refreshSkills();
  }

  /**
   * Execute a skill by name
   */
  async executeSkill(args: SkillToolArgs): Promise<{
    content: string;
    context?: SkillInvocationContext;
    allowedTools?: string[];
  }> {
    const { skill_name } = args;

    logger?.debug(`Invoking skill: ${skill_name}`);

    const prepared = await this.prepareSkill(args);
    if (!prepared.skill) {
      return { content: prepared.content };
    }

    try {
      const finalContent = await this.executeBashInSkillContent(
        prepared.content,
      );

      return {
        content: finalContent,
        context: {
          skillName: skill_name,
        },
        allowedTools: prepared.skill.allowedTools,
      };
    } catch (error) {
      logger?.error(`Failed to execute skill '${skill_name}':`, error);
      return {
        content: `**Error executing skill**: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Prepare a skill by name without executing bash commands
   */
  async prepareSkill(args: SkillToolArgs): Promise<
    | {
        content: string;
        skill: Skill;
      }
    | { content: string; skill?: undefined }
  > {
    const { skill_name, args: skillArgs } = args;

    try {
      const skill = await this.loadSkill(skill_name);

      if (!skill) {
        return {
          content: `**Skill not found**: "${skill_name}"\n\nAvailable skills:\n${this.formatAvailableSkills()}`,
        };
      }

      if (!skill.isValid) {
        const errorMsg = formatSkillError(skill.skillPath, skill.errors);
        return {
          content: `**Skill validation failed**:\n\n\`\`\`\n${errorMsg}\n\`\`\``,
        };
      }

      const preparedContent = this.prepareSkillContent(skill, skillArgs || "");
      return { content: preparedContent, skill };
    } catch (error) {
      logger?.error(`Failed to prepare skill '${skill_name}':`, error);
      return {
        content: `**Error preparing skill**: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Render a skill's body the way the model must see it: frontmatter stripped,
   * parameters substituted, `${MUSE_SKILL_DIR}` / `${CLAUDE_SKILL_DIR}` /
   * `${MUSE_PLUGIN_ROOT}` replaced with real paths, and the
   * `Base directory for this skill: <path>` header prepended.
   *
   * Public because the post-compaction re-injection has to render the same
   * text when it cannot reuse the content recorded at invocation time
   * (spec core/message-compact 场景 4).
   */
  renderSkillContent(skill: Skill, argsString = ""): string {
    return this.prepareSkillContent(skill, argsString);
  }

  /**
   * Prepare skill content with arguments but without bash execution
   */
  private prepareSkillContent(skill: Skill, argsString: string): string {
    const skillPath = `Base directory for this skill: ${skill.skillPath}\n\n`;

    // Extract content after frontmatter
    const contentMatch = skill.content.match(
      /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/,
    );
    let mainContent = contentMatch ? contentMatch[1].trim() : skill.content;

    // 1. Substitute parameters ($1, $ARGUMENTS, etc.)
    mainContent = substituteCommandParameters(mainContent, argsString);

    mainContent = substituteSkillDir(mainContent, skill.skillPath);
    if (skill.pluginRoot) {
      mainContent = substitutePluginRoot(mainContent, skill.pluginRoot);
    }

    return skillPath + mainContent;
  }

  /**
   * Execute bash commands in prepared skill content
   */
  private async executeBashInSkillContent(content: string): Promise<string> {
    const { commands } = parseBashCommands(content);
    if (commands.length > 0) {
      const currentWorkdir =
        this.container.get<string>("Workdir") ?? this.workdir;
      const results = await executeBashCommands(commands, currentWorkdir);
      return replaceBashCommandsWithOutput(content, results);
    }
    return content;
  }

  /**
   * Format available skills list for error messages
   */
  private formatAvailableSkills(): string {
    const skills = this.getAvailableSkills();

    if (skills.length === 0) {
      return "• No skills available\n\nTo create skills, add a SKILL.md under ~/.muse-work/skills or the project .muse-work/skills directory.";
    }

    return skills
      .map(
        (skill) => `• **${skill.name}** (${skill.type}): ${skill.description}`,
      )
      .join("\n");
  }

  /**
   * Register skills provided by a plugin
   */
  registerPluginSkills(pluginName: string, skills: Skill[]): void {
    for (const skill of skills) {
      const namespacedName = `${pluginName}:${skill.name}`;
      const metadata: SkillMetadata = {
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
      // Update the skill object itself to have the namespaced name
      skill.name = namespacedName;

      this.skillMetadata.set(namespacedName, metadata);
      this.skillContent.set(namespacedName, skill);
      // Also store in plugin-specific maps so they survive refreshSkills()
      this.pluginSkillMetadata.set(namespacedName, metadata);
      this.pluginSkillContent.set(namespacedName, skill);
    }
    logger?.debug(
      `Registered ${skills.length} plugin skills from ${pluginName}. Total skills: ${this.skillMetadata.size}`,
    );
  }

  /**
   * Drop every skill contributed by a plugin, addressed by its plugin name.
   * Clears the plugin-specific maps too: refreshSkills() re-seeds the visible
   * maps from them, so clearing only those would resurrect the skills on the
   * next disk refresh. Called by the in-place plugin reload path before
   * re-registering.
   */
  unregisterPluginSkills(pluginName: string): void {
    const prefix = `${pluginName}:`;
    for (const name of Array.from(this.pluginSkillMetadata.keys())) {
      if (name.startsWith(prefix)) {
        this.pluginSkillMetadata.delete(name);
      }
    }
    for (const name of Array.from(this.pluginSkillContent.keys())) {
      if (name.startsWith(prefix)) {
        this.pluginSkillContent.delete(name);
      }
    }
    for (const name of Array.from(this.skillMetadata.keys())) {
      if (name.startsWith(prefix)) {
        this.skillMetadata.delete(name);
      }
    }
    for (const name of Array.from(this.skillContent.keys())) {
      if (name.startsWith(prefix)) {
        this.skillContent.delete(name);
      }
    }
    logger?.debug(`Unregistered plugin skills from ${pluginName}`);
  }

  /**
   * Directory roots that may hold deletable copies of a skill in the given
   * discovery scope. Personal skills are scanned from three user-level dirs
   * (~/.muse-work|~/.claude|~/.agents/skills) and project skills from the current
   * project's three project dirs (.muse-work|.claude|.agents/skills). The discovery
   * map merges same-named copies from these roots into a single name-keyed
   * entry, so deleteSkill must sweep the whole set to remove a skill fully.
   */
  private scopeSkillRoots(type: string): string[] {
    if (type === "personal") {
      return [
        this.personalSkillsPath,
        this.personalClaudeSkillsPath,
        this.personalAgentsSkillsPath,
      ];
    }
    if (type === "project") {
      return [
        join(this.workdir, CONFIG_DIR_NAME, "skills"),
        join(this.workdir, ".claude", "skills"),
        join(this.workdir, ".agents", "skills"),
      ];
    }
    return [];
  }

  /**
   * Delete a user/personal or project skill by removing its directory
   * (containing SKILL.md). Builtin and plugin skills are read-only and
   * cannot be deleted.
   *
   * A same-named skill may physically live in several same-scope directories
   * (~/.muse-work/skills + ~/.claude/skills + ~/.agents/skills for user skills,
   * .muse-work/.claude/.agents/skills under the project for project skills) while
   * only the highest-priority copy is listed; every copy is removed so one
   * delete removes the skill completely instead of re-surfacing the next
   * copy on the next scan. Caches are then re-converged with disk before
   * returning so the caller's follow-up metadata read reflects the result.
   * @param name - The skill name as shown in skill metadata
   * @returns true if the skill was deleted
   */
  async deleteSkill(name: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("SkillManager not initialized. Call initialize() first.");
    }

    const metadata = this.skillMetadata.get(name);
    if (!metadata) {
      return false;
    }

    // Builtin and plugin skills are read-only
    if (metadata.type === "builtin" || metadata.pluginName) {
      return false;
    }

    if (!metadata.skillPath) {
      return false;
    }

    const dirsToRemove = new Set<string>([metadata.skillPath]);
    for (const root of this.scopeSkillRoots(metadata.type)) {
      dirsToRemove.add(join(root, name));
    }

    for (const dir of dirsToRemove) {
      await rm(dir, { recursive: true, force: true });
    }

    // Converge caches with disk: the serialized full refresh both drops the
    // deleted entries and reflects any copy that survived deletion. If the
    // refresh itself fails, fall back to dropping the entry from memory so
    // the deleted skill does not keep being served.
    try {
      await this.refreshSkills();
    } catch (error) {
      logger?.warn(
        `Failed to refresh skills after deleting '${name}': ${error}`,
      );
      this.skillMetadata.delete(name);
      this.skillContent.delete(name);
    }

    logger?.debug(`Deleted skill '${name}' at ${metadata.skillPath}`);
    return true;
  }
}
