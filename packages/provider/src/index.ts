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
  getSharedCodeMakerAuthPath,
} from "./paths.js";

export { loadProvidersConfig, saveProvidersConfig } from "./configStore.js";

export {
  createProviderRegistry,
  type ActiveSelection,
  type ProviderRegistry,
} from "./registry.js";

export { createOpenAiCompatibleProvider } from "./openaiCompatible.js";

export type { CodeMakerCreds } from "./codemaker/types.js";

export {
  isExpired,
  loadCodeMakerCredentials,
  saveCodeMakerCredentials,
} from "./codemaker/credentials.js";
