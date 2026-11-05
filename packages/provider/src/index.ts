export type {
  AiProvider,
  AuthStatus,
  DeepSeekProviderConfig,
  GatewayResolution,
  LoginStart,
  ModelInfo,
  CodexProviderConfig,
  OpenAiCompatibleProviderConfig,
  ProviderBlock,
  ProvidersFile,
} from "./types.js";

export {
  getCodexAuthPath,
  getMuseHomeDir,
  getProvidersConfigPath,
  getSessionsConfigPath,
} from "./paths.js";

export {
  createDefaultProjectWorkdir,
  getProjectsDir,
} from "./defaultProject.js";

export {
  DEFAULT_ACTIVE_MODEL_ID,
  loadProvidersConfig,
  saveProvidersConfig,
} from "./configStore.js";

export {
  createProviderRegistry,
  reconcileActiveProvider,
  type ActiveSelection,
  type ProviderRegistry,
} from "./registry.js";

export { createOpenAiCompatibleProvider } from "./openaiCompatible.js";

export {
  createDeepSeekProvider,
  DEEPSEEK_API_KEY_ENV,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL_ID,
  DEEPSEEK_FALLBACK_MODELS,
  normalizeDeepSeekBalance,
  parseDeepSeekModels,
} from "./deepseek/provider.js";

export {
  deepSeekEnvFile,
  loadDeepSeekEnv,
  saveDeepSeekApiKey,
} from "./deepseek/envFile.js";

export {
  CODEX_API_BASE_URL,
  createCodexProvider,
} from "./codex/provider.js";
export {
  CODEX_CLIENT_ID,
  CODEX_ISSUER,
  beginCodexLogin,
  type BeginCodexLoginOptions,
  type CodexLoginStart,
} from "./codex/login.js";
export {
  clearCodexCredentials,
  loadCodexCredentials,
  saveCodexCredentials,
  type CodexCreds,
} from "./codex/credentials.js";
