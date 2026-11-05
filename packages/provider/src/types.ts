export interface AuthStatus {
  state: "authenticated" | "unauthenticated" | "needs_config" | "expired";
  user?: string;
  providerId: string;
}

export type LoginStart = { authUrl: string } | { reused: true };

export interface ModelInfo {
  id: string;
  label: string;
  capabilities?: { vision?: boolean; thinking?: boolean };
  group?: string;
}

export interface GatewayResolution {
  apiKey?: string;
  baseURL: string;
  /** Stable hash/prefix of active credentials (e.g. access token); used to detect renew. */
  credentialFingerprint?: string;
  defaultHeaders?: Record<string, string>;
  fetch?: typeof fetch;
  model: string;
  fastModel?: string;
}

export interface AiProvider {
  id: string;
  displayName: string;

  getAuthStatus(): Promise<AuthStatus>;
  beginLogin(opts?: unknown): Promise<LoginStart>;
  completeLogin(input: unknown): Promise<AuthStatus>;
  logout(): Promise<void>;

  listModels(): Promise<ModelInfo[]>;
  resolveGateway(modelId: string): Promise<GatewayResolution>;

  /** Account usage or balance. Absent when this provider has none. */
  getQuota?(): Promise<unknown>;
  /** Drop stored credentials when the API rejects the session. */
  revokeOnUnauthorized?: boolean;
}

export interface CodeMakerProviderConfig {
  enabled: boolean;
  models: ModelInfo[];
}

export interface OpenAiCompatibleProviderConfig {
  enabled: boolean;
  baseURL?: string;
  /** Optional key stored in providers.json (preferred over env when set). */
  apiKey?: string;
  apiKeyEnv?: string;
  models: ModelInfo[];
}

export interface CodexProviderConfig {
  enabled: boolean;
  models: ModelInfo[];
  /** When set, ChatGPT login must land in one of these account ids. */
  forcedWorkspaceIds?: string[];
}

export interface DeepSeekProviderConfig {
  enabled: boolean;
  models: ModelInfo[];
  /** Stored key. Environment `DEEPSEEK_API_KEY` is used when this is empty. */
  apiKey?: string;
  apiKeyEnv?: string;
}

export interface ProvidersFile {
  activeProviderId: string;
  activeModelId?: string;
  providers: {
    deepseek: DeepSeekProviderConfig;
    codemaker?: CodeMakerProviderConfig;
    codex: CodexProviderConfig;
    "openai-compatible": OpenAiCompatibleProviderConfig;
  };
}
