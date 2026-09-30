/**
 * Muse environment variable names.
 *
 * New keys are `MUSE_*`. Reads also accept legacy `WAVE_*` so existing
 * `settings.json` / OS env / plugin templates keep working.
 * `WAVE_*` 名刻意保留（双读契约），暂不删、不改名。
 */

export const MUSE_ENV = {
  API_KEY: "MUSE_API_KEY",
  BASE_URL: "MUSE_BASE_URL",
  SERVER_URL: "MUSE_SERVER_URL",
  CUSTOM_HEADERS: "MUSE_CUSTOM_HEADERS",
  MODEL: "MUSE_MODEL",
  FAST_MODEL: "MUSE_FAST_MODEL",
  VISION_MODEL: "MUSE_VISION_MODEL",
  MAX_INPUT_TOKENS: "MUSE_MAX_INPUT_TOKENS",
  MAX_OUTPUT_TOKENS: "MUSE_MAX_OUTPUT_TOKENS",
  DISABLE_AUTO_MEMORY: "MUSE_DISABLE_AUTO_MEMORY",
  AUTO_MEMORY_FREQUENCY: "MUSE_AUTO_MEMORY_FREQUENCY",
  TASK_LIST_ID: "MUSE_TASK_LIST_ID",
  PLUGIN_GIT_TIMEOUT_MS: "MUSE_PLUGIN_GIT_TIMEOUT_MS",
  SHELL: "MUSE_SHELL",
  GIT_BASH_PATH: "MUSE_GIT_BASH_PATH",
  OFFICIAL_MARKET_MIRROR_BASE_URL: "MUSE_OFFICIAL_MARKET_MIRROR_BASE_URL",
  PLUGIN_ROOT: "MUSE_PLUGIN_ROOT",
  SKILL_DIR: "MUSE_SKILL_DIR",
  PROJECT_DIR: "MUSE_PROJECT_DIR",
  SESSION_ID: "MUSE_SESSION_ID",
} as const;

export type MuseEnvKey = (typeof MUSE_ENV)[keyof typeof MUSE_ENV];

export function museEnvLegacy(museKey: string): string {
  // 刻意保留 WAVE_* 别名；旧 settings / 插件模板仍走这条。
  return museKey.replace(/^MUSE_/, "WAVE_");
}

/** First defined value across sources; each source prefers MUSE_* then WAVE_*. */
export function envGet(
  museKey: string,
  ...sources: Array<Record<string, string | undefined> | undefined>
): string | undefined {
  const legacy = museEnvLegacy(museKey);
  for (const src of sources) {
    if (!src) continue;
    const value = src[museKey] ?? src[legacy];
    if (value !== undefined) return value;
  }
  return undefined;
}

export function pluginRootEnv(pluginRoot: string): Record<string, string> {
  return {
    [MUSE_ENV.PLUGIN_ROOT]: pluginRoot,
    WAVE_PLUGIN_ROOT: pluginRoot,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
  };
}

export function projectDirEnv(projectDir: string): Record<string, string> {
  return {
    [MUSE_ENV.PROJECT_DIR]: projectDir,
    WAVE_PROJECT_DIR: projectDir,
  };
}

export function substitutePluginRoot(text: string, pluginRoot: string): string {
  return text
    .replace(/\$\{MUSE_PLUGIN_ROOT\}/g, pluginRoot)
    .replace(/\$\{WAVE_PLUGIN_ROOT\}/g, pluginRoot)
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot);
}

export function substituteSkillDir(text: string, skillPath: string): string {
  return text
    .replace(/\$\{MUSE_SKILL_DIR\}/g, skillPath)
    .replace(/\$\{WAVE_SKILL_DIR\}/g, skillPath)
    .replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillPath);
}

/** Placeholder names left untouched until spawn-time substitution. */
export const PLUGIN_ROOT_TEMPLATE_VARS: string[] = [
  MUSE_ENV.PLUGIN_ROOT,
  "WAVE_PLUGIN_ROOT",
  "CLAUDE_PLUGIN_ROOT",
];
