import { readdir, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { Skill, SkillCollection, SkillError, SkillMetadata } from "../types/index.js";
import { parseSkillFile } from "../utils/skillParser.js";
import { getBuiltinSkillsDir } from "../utils/configPaths.js";
import { logger } from "../utils/globalLogger.js";
import { CONFIG_DIR_NAME } from "../utils/constants.js";

export type DiskSkillSnapshot = {
  metadata: Map<string, SkillMetadata>;
  content: Map<string, Skill>;
  errors: SkillError[];
};

export type DiskSkillDiscoveryOptions = {
  workdir: string;
  personalSkillsPath?: string;
  personalClaudeSkillsPath?: string;
  personalAgentsSkillsPath?: string;
};

export async function discoverDiskSkills(
  options: DiskSkillDiscoveryOptions,
): Promise<DiskSkillSnapshot> {
  const workdir = options.workdir;
  const personalSkillsPath =
    options.personalSkillsPath ?? join(homedir(), CONFIG_DIR_NAME, "skills");
  const personalClaudeSkillsPath =
    options.personalClaudeSkillsPath ?? join(homedir(), ".claude", "skills");
  const personalAgentsSkillsPath =
    options.personalAgentsSkillsPath ?? join(homedir(), ".agents", "skills");

  const contentSink = new Map<string, Skill>();

  const builtinCollection = await discoverSkillCollection(
    getBuiltinSkillsDir(),
    "builtin",
    contentSink,
  );
  const personalAgentsCollection = await discoverSkillCollection(
    personalAgentsSkillsPath,
    "personal",
    contentSink,
  );
  const personalClaudeCollection = await discoverSkillCollection(
    personalClaudeSkillsPath,
    "personal",
    contentSink,
  );
  const personalCollection = await discoverSkillCollection(
    personalSkillsPath,
    "personal",
    contentSink,
  );
  const projectCollection = await discoverSkillCollection(
    workdir,
    "project",
    contentSink,
  );

  const metadata = new Map<string, SkillMetadata>();
  for (const collection of [
    builtinCollection,
    {
      skills: new Map([
        ...personalAgentsCollection.skills,
        ...personalClaudeCollection.skills,
        ...personalCollection.skills,
      ]),
      errors: [
        ...personalAgentsCollection.errors,
        ...personalClaudeCollection.errors,
        ...personalCollection.errors,
      ],
    },
    projectCollection,
  ]) {
    collection.skills.forEach((skill, name) => {
      metadata.set(name, skill);
    });
  }

  const errors: SkillError[] = [
    ...builtinCollection.errors,
    ...personalAgentsCollection.errors,
    ...personalClaudeCollection.errors,
    ...personalCollection.errors,
    ...projectCollection.errors,
  ];

  const content = new Map<string, Skill>();
  for (const name of metadata.keys()) {
    const skill = contentSink.get(name);
    if (skill) {
      content.set(name, skill);
    }
  }

  return { metadata, content, errors };
}

async function discoverSkillCollection(
  basePath: string,
  type: "personal" | "project" | "builtin",
  contentSink: Map<string, Skill>,
): Promise<SkillCollection> {
  const collection: SkillCollection = {
    type,
    basePath,
    skills: new Map(),
    errors: [],
  };

  if (type === "project") {
    const agentsPath = join(basePath, ".agents", "skills");
    const claudePath = join(basePath, ".claude", "skills");
    const museSkillsPath = join(basePath, CONFIG_DIR_NAME, "skills");
    await scanSkillPath(agentsPath, collection, contentSink);
    await scanSkillPath(claudePath, collection, contentSink);
    await scanSkillPath(museSkillsPath, collection, contentSink);
  } else {
    await scanSkillPath(basePath, collection, contentSink);
  }

  return collection;
}

async function scanSkillPath(
  skillsPath: string,
  collection: SkillCollection,
  contentSink: Map<string, Skill>,
): Promise<void> {
  try {
    const skillDirs = await findSkillDirectories(skillsPath);
    logger?.debug(
      `Found ${skillDirs.length} potential skill directories in ${skillsPath}`,
    );
    await processSkillDirs(skillDirs, collection, contentSink);
  } catch (error) {
    logger?.debug(
      `Could not scan ${skillsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function processSkillDirs(
  skillDirs: string[],
  collection: SkillCollection,
  contentSink: Map<string, Skill>,
): Promise<void> {
  for (const skillDir of skillDirs) {
    try {
      const skillFilePath = join(skillDir, "SKILL.md");
      try {
        await stat(skillFilePath);
      } catch {
        continue;
      }

      const parsed = parseSkillFile(skillFilePath, {
        basePath: skillDir,
        validateMetadata: true,
      });

      if (parsed.isValid) {
        const skillMetadata: SkillMetadata = {
          ...parsed.skillMetadata,
          type: collection.type,
        };
        const skill: Skill = {
          ...skillMetadata,
          content: parsed.content,
          frontmatter: parsed.frontmatter,
          isValid: parsed.isValid,
          errors: parsed.validationErrors,
          warnings: parsed.warnings,
        };
        collection.skills.set(skillMetadata.name, skillMetadata);
        contentSink.set(skillMetadata.name, skill);
      } else {
        collection.errors.push({
          skillPath: skillDir,
          message: parsed.validationErrors.join("; "),
        });
      }
    } catch (error) {
      collection.errors.push({
        skillPath: skillDir,
        message: `Failed to process skill: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

async function findSkillDirectories(skillsPath: string): Promise<string[]> {
  const directories: string[] = [];
  try {
    const entries = await readdir(skillsPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(skillsPath, entry.name);
      if (entry.isDirectory()) {
        directories.push(fullPath);
      } else if (entry.isSymbolicLink()) {
        try {
          const s = await stat(fullPath);
          if (s.isDirectory()) {
            directories.push(fullPath);
          }
        } catch {
          // Ignore broken symlinks
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return directories;
}
