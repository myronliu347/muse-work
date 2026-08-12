import type { AiProvider, ProvidersFile } from "./types.js";

const SSO_MESSAGE = "该 provider 使用 API Key 配置，无需 SSO";

export function createOpenAiCompatibleProvider(options: {
  getConfig: () => ProvidersFile["providers"]["openai-compatible"];
  getApiKey: () => string | undefined;
}): AiProvider {
  return {
    id: "openai-compatible",
    displayName: "OpenAI Compatible",

    async getAuthStatus() {
      const config = options.getConfig();
      const apiKey = options.getApiKey();
      if (config.baseURL && apiKey) {
        return { state: "authenticated", providerId: "openai-compatible" };
      }
      return { state: "needs_config", providerId: "openai-compatible" };
    },

    async beginLogin() {
      throw new Error(SSO_MESSAGE);
    },

    async completeLogin() {
      throw new Error(SSO_MESSAGE);
    },

    async logout() {
      // no-op: API key is managed via config/env, not session state
    },

    async listModels() {
      return options.getConfig().models;
    },

    async resolveGateway(modelId: string) {
      const config = options.getConfig();
      return {
        baseURL: config.baseURL!,
        apiKey: options.getApiKey(),
        model: modelId,
        fastModel: modelId,
      };
    },
  };
}
