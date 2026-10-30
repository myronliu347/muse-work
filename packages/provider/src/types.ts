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

export interface ProvidersFile {
  activeProviderId: string;
  activeModelId?: string;
  providers: {
    codemaker: CodeMakerProviderConfig;
    codex: CodexProviderConfig;
    "openai-compatible": OpenAiCompatibleProviderConfig;
  };
}
