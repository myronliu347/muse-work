export type {
  AiProvider,
  AuthStatus,
  CodeMakerProviderConfig,
  GatewayResolution,
  LoginStart,
  ModelInfo,
  OpenAiCompatibleProviderConfig,
  ProvidersFile,
} from "./types.js";

export {
  getCodeMakerAuthPath,
  getMuseHomeDir,
  getProvidersConfigPath,
  getSessionsConfigPath,
  getSharedCodeMakerAuthPath,
} from "./paths.js";

export {
  createDefaultProjectWorkdir,
  getProjectsDir,
  getTodoWorkdir,
} from "./defaultProject.js";

export {
  DEFAULT_ACTIVE_MODEL_ID,
  loadProvidersConfig,
  saveProvidersConfig,
} from "./configStore.js";

export {
  createProviderRegistry,
  type ActiveSelection,
  type ProviderRegistry,
} from "./registry.js";

export { createOpenAiCompatibleProvider } from "./openaiCompatible.js";

export type { CodeMakerCreds } from "./codemaker/types.js";

export {
  clearCodeMakerCredentials,
  isExpired,
  loadCodeMakerCredentials,
  saveCodeMakerCredentials,
} from "./codemaker/credentials.js";

export {
  beginCodeMakerLogin,
  CODEMAKER_API_BASE_URL,
  CODEMAKER_AUTH_API_URL,
  CODEMAKER_AUTH_KEY_PATH,
  CODEMAKER_LOGIN_INFO_PATH,
  CODEMAKER_LOGIN_PATH,
  type BeginCodeMakerLoginOptions,
  type CodeMakerLoginStart,
} from "./codemaker/login.js";

export {
  CODEMAKER_RENEW_TOKEN_PATH,
  renewCodeMakerCredentials,
} from "./codemaker/refresh.js";

export {
  buildCanonicalString,
  buildCodeMakerClientHeaders,
  buildCodeMakerHeaders,
  createCodeMakerFetch,
  getSigningKey,
  resolveCodeMakerCliVersion,
  signCanonical,
  tokenHashPrefix,
} from "./codemaker/sign.js";

export {
  CODEMAKER_BASE_URL,
  createCodeMakerProvider,
} from "./codemaker/provider.js";

export {
  CODEMAKER_USER_QUOTA_USAGE_PATH,
  fetchCodeMakerQuotaUsage,
  normalizeQuotaUsage,
  type CodeMakerQuotaUsage,
} from "./codemaker/quota.js";
