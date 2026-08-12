import type { AiProvider, CodeMakerProviderConfig } from "../types.js";
import {
  isExpired,
  loadCodeMakerCredentials,
} from "./credentials.js";
import { createCodeMakerFetch } from "./sign.js";
import type { CodeMakerCreds } from "./types.js";

export const CODEMAKER_BASE_URL = "https://api-code-maker.nie.netease.com";

const LOGIN_STUB_MESSAGE =
  "CodeMaker SSO login is not implemented yet (Task 6)";

export interface CodeMakerProviderDeps {
  getConfig: () => CodeMakerProviderConfig;
  loadCredentials?: () => CodeMakerCreds | null;
  home?: string;
}

export function createCodeMakerProvider(
  deps: CodeMakerProviderDeps,
): AiProvider {
  const loadCredentials =
    deps.loadCredentials ??
    (() => loadCodeMakerCredentials(deps.home));

  return {
    id: "codemaker",
    displayName: "CodeMaker",

    async getAuthStatus() {
      const creds = loadCredentials();
      if (!creds) {
        return { state: "unauthenticated", providerId: "codemaker" };
      }
      if (isExpired(creds)) {
        return {
          state: "expired",
          user: creds.accessUser,
          providerId: "codemaker",
        };
      }
      return {
        state: "authenticated",
        user: creds.accessUser,
        providerId: "codemaker",
      };
    },

    async beginLogin() {
      throw new Error(LOGIN_STUB_MESSAGE);
    },

    async completeLogin() {
      throw new Error(LOGIN_STUB_MESSAGE);
    },

    async logout() {
      // Task 6: clear muse auth; no-op for now
    },

    async listModels() {
      return deps.getConfig().models;
    },

    async resolveGateway(modelId: string) {
      const creds = loadCredentials();
      if (!creds || isExpired(creds)) {
        throw new Error("CodeMaker credentials missing or expired");
      }
      return {
        baseURL: `${CODEMAKER_BASE_URL}/openai/v1`,
        model: modelId,
        fetch: createCodeMakerFetch(creds),
      };
    },
  };
}
