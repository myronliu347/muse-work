/**
 * 用户偏好设置（三端设置页读写的子集）的读写工具。
 *
 * 落点唯一 = 用户级 `~/.muse-work/settings.json`（`getUserConfigPaths()[0]`）：
 * 设置页保存的 AI 回复语言、上下文长度、自动记忆开关/轮次都写这个文件，由 SDK
 * 的实时重载（LiveConfigManager）在各会话下一轮开始时生效——不经 `AgentOptions`
 * 覆盖层下发（覆盖层优先级高于 settings.json，会永久遮蔽实时配置）。
 *
 * 上下文长度的键 = `env.MUSE_MAX_INPUT_TOKENS`（全局默认，K×1000 落盘、
 * 回读按同一换算），UI 与线协议都传 K 值。仍兼容 `WAVE_MAX_INPUT_TOKENS`。
 *
 * 写入是「读-改-写」：只覆盖这些键，其余顶层键与 `env` 下其它键原样保留。
 *
 * `readUserPreferenceView` 额外回答**当前生效值来自哪一层**：用户级文件是用户
 * 偏好的**落点**，机器上的环境变量可以盖过它。
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname } from "path";
import { atomicWriteFile } from "./atomicWrite.js";
import { getUserConfigPaths } from "./configPaths.js";
import { envGet, MUSE_ENV, museEnvLegacy } from "./museEnv.js";
import type {
  UserPreferenceKey,
  UserPreferenceSettings,
  UserPreferenceSource,
  MuseConfiguration,
} from "../types/configuration.js";

export type { UserPreferenceSettings };

/** 上下文长度在 settings.json 中的落点（全局默认，spec 边界说明「上下文长度的落点」）。 */
export const MAX_INPUT_TOKENS_ENV_KEY = MUSE_ENV.MAX_INPUT_TOKENS;

/**
 * 自动记忆的 env 键，与 `ConfigurationService.resolveAutoMemoryEnabledFrom` /
 * `resolveAutoMemoryFrequency` 读取的键名一致（本视图只按同一优先级归因，
 * 不改变解析行为）。读时兼容 `WAVE_*`。
 */
export const DISABLE_AUTO_MEMORY_ENV_KEY = MUSE_ENV.DISABLE_AUTO_MEMORY;
export const AUTO_MEMORY_FREQUENCY_ENV_KEY = MUSE_ENV.AUTO_MEMORY_FREQUENCY;

function envBlockGet(
  env: Record<string, unknown>,
  museKey: string,
): unknown {
  const value = env[museKey];
  if (value !== undefined) return value;
  return env[museEnvLegacy(museKey)];
}

function writeEnvKey(
  env: Record<string, unknown>,
  museKey: string,
  value: string,
): void {
  env[museKey] = value;
  delete env[museEnvLegacy(museKey)];
}

/** 用户偏好键（设置页控件）。 */
export type { UserPreferenceKey, UserPreferenceSource };

/** 生效偏好 + 每个键的来源。 */
export interface UserPreferenceView {
  /** 生效值；键缺失 = 该偏好没有任何提供者（落 SDK 默认/未设置态）。 */
  values: UserPreferenceSettings;
  /** 每个键恒有来源（缺省即 `default`）。 */
  sources: Record<UserPreferenceKey, UserPreferenceSource>;
}

/**
 * 上下文长度的 env 值（token 字符串）→ UI 的 K 值；非数字/非正数视作未提供。
 */
function envContextLength(raw: unknown): number | undefined {
  return typeof raw === "string"
    ? maxInputTokensToContextLength(raw)
    : undefined;
}

/** `MUSE_DISABLE_AUTO_MEMORY`（兼容 `WAVE_*`）→ 关闭(false) / 未提供(undefined)。 */
function envDisableAutoMemory(raw: unknown): boolean | undefined {
  return raw === "1" || raw === "true" ? false : undefined;
}

/** `MUSE_AUTO_MEMORY_FREQUENCY`（兼容 `WAVE_*`）→ 正数轮次 / 未提供。 */
function envAutoMemoryFrequency(raw: unknown): number | undefined {
  const parsed = Number.parseInt(typeof raw === "string" ? raw : "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** 按优先级取第一个提供了值的层。 */
function selectPreference<T>(
  candidates: Array<[UserPreferenceSource, T | undefined]>,
): { value: T; source: UserPreferenceSource } | undefined {
  for (const [source, value] of candidates) {
    if (value !== undefined) return { value, source };
  }
  return undefined;
}

/** UI 的 K 值 → settings.json 的 token 数（K×1000）。 */
export function contextLengthToMaxInputTokens(contextLengthK: number): number {
  return Math.round(contextLengthK * 1000);
}

/** settings.json 的 token 数 → UI 的 K 值（回读按同一换算）。 */
export function maxInputTokensToContextLength(
  maxInputTokens: string | undefined,
): number | undefined {
  if (maxInputTokens === undefined) return undefined;
  const parsed = Number.parseInt(maxInputTokens, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed / 1000);
}

/** 用户级 settings.json 路径（`~/.muse-work/settings.json`）。 */
export function userSettingsFilePath(): string {
  return getUserConfigPaths()[0];
}

function parseSettingsFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, "utf-8");
  if (raw.trim() === "") return {};
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath} 的顶层必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

/** settings.json 的 `env`（用户手写文件，须容忍非对象值）。 */
function asEnvBlock(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toSettings(data: Record<string, unknown>): UserPreferenceSettings {
  const env = asEnvBlock(data.env);
  const rawMax = envBlockGet(env, MAX_INPUT_TOKENS_ENV_KEY);
  const settings: UserPreferenceSettings = {};
  if (typeof data.language === "string") settings.language = data.language;
  const contextLength = maxInputTokensToContextLength(
    typeof rawMax === "string" ? rawMax : undefined,
  );
  if (contextLength !== undefined) settings.contextLength = contextLength;
  if (typeof data.autoMemoryEnabled === "boolean") {
    settings.autoMemoryEnabled = data.autoMemoryEnabled;
  }
  if (typeof data.autoMemoryFrequency === "number") {
    settings.autoMemoryFrequency = data.autoMemoryFrequency;
  }
  return settings;
}

/** 容忍损坏的读取：文件缺失或损坏时视作没有设置（只影响展示，不阻塞设置页）。 */
function readSettingsFileTolerant(filePath: string): Record<string, unknown> {
  try {
    return parseSettingsFile(filePath);
  } catch {
    return {};
  }
}

/**
 * 读取当前用户偏好。文件缺失或损坏时返回空对象；
 * 写入路径则会明确报错而不是覆盖用户文件。
 */
export function readUserPreferenceSettings(
  filePath: string = userSettingsFilePath(),
): UserPreferenceSettings {
  return toSettings(readSettingsFileTolerant(filePath));
}

/**
 * 读取**生效**用户偏好及其来源层。
 *
 * 优先级：Remote 组织下发（若仍传入）> 用户级文件 > 机器环境变量 > 默认。
 */
export function readUserPreferenceView(
  remote: MuseConfiguration | null = null,
  filePath: string = userSettingsFilePath(),
  env: Record<string, string | undefined> = process.env,
): UserPreferenceView {
  const fileData = readSettingsFileTolerant(filePath);
  const user = toSettings(fileData);
  const userEnv = asEnvBlock(fileData.env);
  const remoteEnv = asEnvBlock(remote?.env);

  const values: UserPreferenceSettings = {};
  const sources: Record<UserPreferenceKey, UserPreferenceSource> = {
    language: "default",
    contextLength: "default",
    autoMemoryEnabled: "default",
    autoMemoryFrequency: "default",
  };

  const language = selectPreference<string>([
    ["remote", remote?.language],
    ["user", user.language],
  ]);
  if (language) {
    values.language = language.value;
    sources.language = language.source;
  }

  const contextLength = selectPreference<number>([
    [
      "remote",
      envContextLength(envBlockGet(remoteEnv, MAX_INPUT_TOKENS_ENV_KEY)),
    ],
    ["user", user.contextLength],
    ["env", envContextLength(envGet(MAX_INPUT_TOKENS_ENV_KEY, env))],
  ]);
  if (contextLength) {
    values.contextLength = contextLength.value;
    sources.contextLength = contextLength.source;
  }

  const autoMemoryEnabled = selectPreference<boolean>([
    ["remote", remote?.autoMemoryEnabled],
    ["user", user.autoMemoryEnabled],
    [
      "remote",
      envDisableAutoMemory(envBlockGet(remoteEnv, DISABLE_AUTO_MEMORY_ENV_KEY)),
    ],
    [
      "user",
      envDisableAutoMemory(envBlockGet(userEnv, DISABLE_AUTO_MEMORY_ENV_KEY)),
    ],
    [
      "env",
      envDisableAutoMemory(envGet(DISABLE_AUTO_MEMORY_ENV_KEY, env)),
    ],
  ]);
  if (autoMemoryEnabled) {
    values.autoMemoryEnabled = autoMemoryEnabled.value;
    sources.autoMemoryEnabled = autoMemoryEnabled.source;
  }

  const autoMemoryFrequency = selectPreference<number>([
    ["remote", remote?.autoMemoryFrequency],
    ["user", user.autoMemoryFrequency],
    [
      "remote",
      envAutoMemoryFrequency(
        envBlockGet(remoteEnv, AUTO_MEMORY_FREQUENCY_ENV_KEY),
      ),
    ],
    [
      "user",
      envAutoMemoryFrequency(
        envBlockGet(userEnv, AUTO_MEMORY_FREQUENCY_ENV_KEY),
      ),
    ],
    [
      "env",
      envAutoMemoryFrequency(envGet(AUTO_MEMORY_FREQUENCY_ENV_KEY, env)),
    ],
  ]);
  if (autoMemoryFrequency) {
    values.autoMemoryFrequency = autoMemoryFrequency.value;
    sources.autoMemoryFrequency = autoMemoryFrequency.source;
  }

  return { values, sources };
}

/**
 * 把 `patch` 里的键合并进用户级 settings.json，返回写入后的完整用户偏好。
 * 未提供的键保持文件中现值；`patch` 为空时只回读、不落盘（无差异保存）。
 */
export async function updateUserPreferenceSettings(
  patch: UserPreferenceSettings,
  filePath: string = userSettingsFilePath(),
): Promise<UserPreferenceSettings> {
  const data = parseSettingsFile(filePath);

  const hasLanguage = patch.language !== undefined;
  const hasContextLength = patch.contextLength !== undefined;
  const hasEnabled = patch.autoMemoryEnabled !== undefined;
  const hasFrequency = patch.autoMemoryFrequency !== undefined;
  if (!hasLanguage && !hasContextLength && !hasEnabled && !hasFrequency) {
    return toSettings(data);
  }

  if (hasLanguage) data.language = patch.language;

  if (
    typeof patch.contextLength === "number" &&
    Number.isFinite(patch.contextLength)
  ) {
    const env = asEnvBlock(data.env);
    writeEnvKey(
      env,
      MAX_INPUT_TOKENS_ENV_KEY,
      String(contextLengthToMaxInputTokens(patch.contextLength)),
    );
    data.env = env;
  }

  if (hasEnabled) data.autoMemoryEnabled = patch.autoMemoryEnabled;
  if (
    typeof patch.autoMemoryFrequency === "number" &&
    Number.isFinite(patch.autoMemoryFrequency)
  ) {
    data.autoMemoryFrequency = patch.autoMemoryFrequency;
  }

  mkdirSync(dirname(filePath), { recursive: true });
  await atomicWriteFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return toSettings(data);
}
