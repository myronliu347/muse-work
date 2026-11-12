import type {
  AiProvider,
  AuthStatus,
  DeepSeekProviderConfig,
  ModelInfo,
} from "../types.js";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_DEFAULT_MODEL_ID = "deepseek-flash";
export const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";

const SSO_MESSAGE = "DeepSeek 使用 API Key 配置，无需 SSO";

export const DEEPSEEK_FALLBACK_MODELS: ModelInfo[] = [
  { id: DEEPSEEK_DEFAULT_MODEL_ID, label: "DeepSeek Flash" },
];

type RemoteModel = { id?: unknown; name?: unknown };

export function parseDeepSeekModels(payload: unknown): ModelInfo[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const models: ModelInfo[] = [];
  for (const item of data as RemoteModel[]) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!id) continue;
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    models.push({ id, label: name || id });
  }
  return models;
}

export function normalizeDeepSeekBalance(payload: unknown): {
  is_available: boolean;
  balance_infos: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
} {
  const body = (payload ?? {}) as {
    is_available?: unknown;
    balance_infos?: unknown;
  };
  const infos = Array.isArray(body.balance_infos) ? body.balance_infos : [];
  return {
    is_available: body.is_available === true,
    balance_infos: infos
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const row = item as Record<string, unknown>;
        return {
          ...(typeof row.currency === "string" ? { currency: row.currency } : {}),
          ...(typeof row.total_balance === "string"
            ? { total_balance: row.total_balance }
            : {}),
          ...(typeof row.granted_balance === "string"
            ? { granted_balance: row.granted_balance }
            : {}),
          ...(typeof row.topped_up_balance === "string"
            ? { topped_up_balance: row.topped_up_balance }
            : {}),
        };
      }),
  };
}

export interface DeepSeekProviderDeps {
  getConfig: () => DeepSeekProviderConfig;
  getApiKey?: () => string | undefined;
  fetch?: typeof fetch;
}

export function createDeepSeekProvider(deps: DeepSeekProviderDeps): AiProvider {
  const fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const readKey =
    deps.getApiKey ??
    (() => {
      const config = deps.getConfig();
      if (config.apiKey?.trim()) return config.apiKey.trim();
      const envName = config.apiKeyEnv ?? DEEPSEEK_API_KEY_ENV;
      const value = process.env[envName];
      return value?.trim() || undefined;
    });

  async function authorizedGet(path: string): Promise<unknown> {
    const key = readKey();
    if (!key) throw new Error("DeepSeek 未配置密钥");
    const res = await fetchImpl(`${DEEPSEEK_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      // Metadata calls back the model picker; a hung API must not pin it.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(detail || `DeepSeek ${res.status}`);
    }
    return res.json();
  }

  return {
    id: "deepseek",
    displayName: "DeepSeek",

    async getAuthStatus(): Promise<AuthStatus> {
      if (readKey()) return { state: "authenticated", providerId: "deepseek" };
      return { state: "needs_config", providerId: "deepseek" };
    },

    async beginLogin() {
      throw new Error(SSO_MESSAGE);
    },

    async completeLogin() {
      throw new Error(SSO_MESSAGE);
    },

    async logout() {},

    async listModels() {
      if (!readKey()) return DEEPSEEK_FALLBACK_MODELS;
      try {
        const remote = parseDeepSeekModels(await authorizedGet("/models"));
        return remote.length > 0 ? remote : DEEPSEEK_FALLBACK_MODELS;
      } catch {
        return DEEPSEEK_FALLBACK_MODELS;
      }
    },

    async getQuota() {
      return normalizeDeepSeekBalance(await authorizedGet("/user/balance"));
    },

    async resolveGateway(modelId: string) {
      const key = readKey();
      if (!key) throw new Error("DeepSeek 未配置密钥");
      return {
        apiKey: key,
        baseURL: DEEPSEEK_BASE_URL,
        model: modelId,
        fastModel: modelId,
      };
    },
  };
}
