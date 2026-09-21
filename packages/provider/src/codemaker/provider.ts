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
import { renewCodeMakerCredentials } from "./refresh.js";
import {
  createCodeMakerModelsLoader,
  mergeModels,
  sortModels,
  type CodeMakerModelsLoader,
} from "./models.js";
import { createCodeMakerFetch, tokenHashPrefix } from "./sign.js";
import type { CodeMakerCreds } from "./types.js";

export const CODEMAKER_BASE_URL = "https://api-code-maker.nie.netease.com";
const ACCESS_PROBE_PATH = "/api/v1/user_quota/usage?quota_type=global";

export interface CodeMakerProviderDeps {
  getConfig: () => CodeMakerProviderConfig;
  loadCredentials?: () => CodeMakerCreds | null;
  home?: string;
  openBrowser?: (url: string) => void;
  fetch?: typeof fetch;
  createUuid?: () => string;
  /** Test hook: override renew implementation. */
  renewCredentials?: typeof renewCodeMakerCredentials;
  /** Test hook: override the remote model loader. */
  modelsLoader?: CodeMakerModelsLoader;
}

export function createCodeMakerProvider(
  deps: CodeMakerProviderDeps,
): AiProvider {
  const loadCredentials =
    deps.loadCredentials ??
    (() => loadCodeMakerCredentials(deps.home));
  const renew = deps.renewCredentials ?? renewCodeMakerCredentials;
  const modelsLoader =
    deps.modelsLoader ??
    createCodeMakerModelsLoader({ home: deps.home, fetch: deps.fetch });

  let activeLogin: CodeMakerLoginStart | null = null;
  /** In-memory override after a successful refresh within this process. */
  let refreshedCreds: CodeMakerCreds | null = null;

  function readCreds(): CodeMakerCreds | null {
    return refreshedCreds ?? loadCredentials();
  }

  async function ensureFreshCreds(): Promise<CodeMakerCreds | null> {
    const creds = readCreds();
    if (!creds) return null;
    if (!isExpired(creds)) return creds;
    if (!creds.refreshKey) {
      clearCodeMakerCredentials(deps.home);
      refreshedCreds = null;
      return null;
    }
    try {
      const next = await renew({
        creds,
        home: deps.home,
        fetch: deps.fetch,
      });
      refreshedCreds = next;
      return next;
    } catch {
      clearCodeMakerCredentials(deps.home);
      refreshedCreds = null;
      return null;
    }
  }

  const ACCESS_REJECTED_RE =
    /auth failed|token.*(?:expired|invalid|revoked)|unauthorized/i;

  /** Live check: local expire can still look valid after the API revoked the token. */
  async function probeAccess(
    creds: CodeMakerCreds,
    fetchImpl: typeof fetch,
  ): Promise<"ok" | "rejected" | "unknown"> {
    try {
      const signed = createCodeMakerFetch(creds, fetchImpl);
      const res = await signed(
        `${CODEMAKER_BASE_URL}${ACCESS_PROBE_PATH}`,
      );
      if (res.ok) return "ok";
      const body = await res.text().catch(() => "");
      if (res.status === 401 || ACCESS_REJECTED_RE.test(body)) {
        return "rejected";
      }
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  return {
    id: "codemaker",
    displayName: "CodeMaker",

    async getAuthStatus() {
      const creds = await ensureFreshCreds();
      if (!creds) {
        return { state: "unauthenticated", providerId: "codemaker" };
      }
      if (deps.fetch) {
        const probe = await probeAccess(creds, deps.fetch);
        if (probe === "rejected") {
          clearCodeMakerCredentials(deps.home);
          refreshedCreds = null;
          return { state: "unauthenticated", providerId: "codemaker" };
        }
      }
      return {
        state: "authenticated",
        user: creds.accessUser,
        providerId: "codemaker",
      };
    },

    async beginLogin(opts?: { openBrowser?: (url: string) => void }) {
      // Reuse an in-progress login so a later wait:true does not mint a new uuid.
      if (activeLogin && "authUrl" in activeLogin && activeLogin.authUrl) {
        return { authUrl: activeLogin.authUrl };
      }
      const start = await beginCodeMakerLogin({
        home: deps.home,
        loadCredentials: readCreds,
        openBrowser: opts?.openBrowser ?? deps.openBrowser,
        fetch: deps.fetch,
        createUuid: deps.createUuid,
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
      refreshedCreds = null;
      return status;
    },

    async logout() {
      clearCodeMakerCredentials(deps.home);
      activeLogin = null;
      refreshedCreds = null;
    },

    async listModels() {
      const remote = await modelsLoader.list();
      if (remote) {
        return sortModels(mergeModels(remote, deps.getConfig().models));
      }
      // Remote catalog unreachable → fall back to the bundled config list.
      return sortModels(deps.getConfig().models);
    },

    async resolveGateway(modelId: string) {
      const creds = await ensureFreshCreds();
      if (!creds) {
        throw new Error("CodeMaker credentials missing or expired");
      }
      return {
        baseURL: `${CODEMAKER_BASE_URL}/openai/v1`,
        credentialFingerprint: tokenHashPrefix(creds.accessToken),
        model: modelId,
        fastModel: modelId,
        fetch: createCodeMakerFetch(creds),
      };
    },
  };
}
