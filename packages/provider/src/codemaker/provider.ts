import type { AiProvider, AuthStatus, CodeMakerProviderConfig } from "../types.js";
import {
  clearCodeMakerCredentials,
  isExpired,
  loadCodeMakerCredentials,
} from "./credentials.js";
import {
  beginCodeMakerLogin,
  type CodeMakerLoginStart,
} from "./login.js";
import { createCodeMakerFetch } from "./sign.js";
import type { CodeMakerCreds } from "./types.js";

export const CODEMAKER_BASE_URL = "https://api-code-maker.nie.netease.com";

export interface CodeMakerProviderDeps {
  getConfig: () => CodeMakerProviderConfig;
  loadCredentials?: () => CodeMakerCreds | null;
  home?: string;
  openBrowser?: (url: string) => void;
  fetch?: typeof fetch;
}

export function createCodeMakerProvider(
  deps: CodeMakerProviderDeps,
): AiProvider {
  const loadCredentials =
    deps.loadCredentials ??
    (() => loadCodeMakerCredentials(deps.home));

  let activeLogin: CodeMakerLoginStart | null = null;

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

    async beginLogin(opts?: { openBrowser?: (url: string) => void }) {
      const start = await beginCodeMakerLogin({
        home: deps.home,
        loadCredentials,
        openBrowser: opts?.openBrowser ?? deps.openBrowser,
        fetch: deps.fetch,
      });
      activeLogin = start;
      if ("reused" in start && start.reused) {
        return { reused: true };
      }
      return { authUrl: (start as { authUrl: string }).authUrl };
    },

    async completeLogin(): Promise<AuthStatus> {
      if (!activeLogin) {
        throw new Error("No CodeMaker login in progress; call beginLogin first");
      }
      const status = await activeLogin.waitUntilComplete();
      activeLogin = null;
      return status;
    },

    async logout() {
      clearCodeMakerCredentials(deps.home);
      activeLogin = null;
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
