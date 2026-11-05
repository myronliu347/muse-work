import { createHash } from "node:crypto";
import os from "node:os";
import type { AiProvider, AuthStatus, CodexProviderConfig } from "../types.js";
import {
  clearCodexCredentials,
  loadCodexCredentials,
  type CodexCreds,
} from "./credentials.js";
import { beginCodexLogin, type CodexLoginStart } from "./login.js";
import {
  CODEX_API_BASE_URL,
  createCodexModelsLoader,
  type CodexModelsLoader,
} from "./models.js";
import {
  accessTokenNeedsRefresh,
  CodexRefreshError,
  refreshCodexCredentials,
} from "./refresh.js";

export { CODEX_API_BASE_URL } from "./models.js";

export interface CodexProviderDeps {
  getConfig: () => CodexProviderConfig;
  home?: string;
  openBrowser?: (url: string) => void;
  fetch?: typeof fetch;
  loadCredentials?: () => CodexCreds | null;
  /** Test hook: override the remote model catalog loader. */
  modelsLoader?: CodexModelsLoader;
}

function fingerprint(accessToken: string): string {
  return createHash("sha256").update(accessToken, "utf8").digest("hex").slice(0, 16);
}

export function createCodexProvider(deps: CodexProviderDeps): AiProvider {
  const home = deps.home ?? os.homedir();
  const loadCredentials =
    deps.loadCredentials ?? (() => loadCodexCredentials(home));
  let activeLogin: CodexLoginStart | null = null;
  let refreshed: CodexCreds | null = null;

  function readCreds(): CodexCreds | null {
    return refreshed ?? loadCredentials();
  }

  async function ensureFreshCreds(): Promise<CodexCreds | null> {
    const creds = readCreds();
    if (!creds) return null;
    if (!accessTokenNeedsRefresh(creds)) return creds;
    try {
      const next = await refreshCodexCredentials({
        creds,
        home,
        fetch: deps.fetch,
      });
      refreshed = next;
      return next;
    } catch (err) {
      if (err instanceof CodexRefreshError && err.permanent) {
        refreshed = null;
        clearCodexCredentials(home);
        return null;
      }
      throw err;
    }
  }

  const modelsLoader =
    deps.modelsLoader ??
    createCodexModelsLoader({
      home,
      fetch: deps.fetch,
      getCredentials: () => ensureFreshCreds(),
    });

  function statusFrom(creds: CodexCreds | null): AuthStatus {
    if (!creds) return { state: "unauthenticated", providerId: "codex" };
    return {
      state: "authenticated",
      user: creds.email,
      providerId: "codex",
    };
  }

  return {
    id: "codex",
    displayName: "ChatGPT",
    revokeOnUnauthorized: true,

    async getAuthStatus() {
      try {
        return statusFrom(await ensureFreshCreds());
      } catch (err) {
        if (err instanceof CodexRefreshError && !err.permanent) {
          return statusFrom(readCreds());
        }
        throw err;
      }
    },

    async beginLogin(opts?: { openBrowser?: (url: string) => void }) {
      if (activeLogin && "authUrl" in activeLogin && activeLogin.authUrl) {
        return { authUrl: activeLogin.authUrl };
      }
      const start = await beginCodexLogin({
        home,
        loadCredentials: readCreds,
        openBrowser: opts?.openBrowser ?? deps.openBrowser,
        fetch: deps.fetch,
        forcedWorkspaceIds: deps.getConfig().forcedWorkspaceIds,
      });
      activeLogin = start;
      if ("reused" in start && start.reused) {
        return { reused: true };
      }
      return { authUrl: (start as { authUrl: string }).authUrl };
    },

    async completeLogin(): Promise<AuthStatus> {
      if (!activeLogin) {
        throw new Error("No Codex login in progress; call beginLogin first");
      }
      const status = await activeLogin.waitUntilComplete();
      activeLogin = null;
      refreshed = null;
      return status;
    },

    async logout() {
      clearCodexCredentials(home);
      activeLogin = null;
      refreshed = null;
    },

    async listModels() {
      try {
        const remote = await modelsLoader.list();
        if (remote && remote.length > 0) return remote;
      } catch {
        // A catalog failure still leaves the bundled fallback usable.
      }
      return deps.getConfig().models;
    },

    async resolveGateway(modelId: string) {
      const creds = await ensureFreshCreds();
      if (!creds) {
        throw new Error("Codex credentials missing or expired");
      }
      return {
        baseURL: CODEX_API_BASE_URL,
        apiKey: creds.accessToken,
        credentialFingerprint: fingerprint(creds.accessToken),
        model: modelId,
        fastModel: modelId,
        ...(creds.accountId
          ? { defaultHeaders: { "chatgpt-account-id": creds.accountId } }
          : {}),
      };
    },
  };
}
