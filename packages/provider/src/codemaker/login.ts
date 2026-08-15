import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import type { AuthStatus, LoginStart } from "../types.js";
import {
  isExpired,
  loadCodeMakerCredentials,
  saveCodeMakerCredentials,
} from "./credentials.js";
import type { CodeMakerCreds } from "./types.js";

/** Same origin as CLI `codeMaker` prod API (`NetEaseCodeMakerAuthPlugin`). */
export const CODEMAKER_API_BASE_URL = "https://api-code-maker.nie.netease.com";

/** Documented for probes; browser SSO uses API base, not auth.nie. */
export const CODEMAKER_AUTH_API_URL = "https://auth.nie.netease.com";

export const CODEMAKER_LOGIN_PATH = "/vs_login";
export const CODEMAKER_LOGIN_INFO_PATH = "/vs_login_info";
export const CODEMAKER_AUTH_KEY_PATH = "/get_auth_key";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_TIMEOUT_MS = 600_000;

const execFileAsync = promisify(execFile);

export interface BeginCodeMakerLoginOptions {
  openBrowser?: (url: string) => void;
  fetch?: typeof fetch;
  home?: string;
  baseUrl?: string;
  loadCredentials?: () => CodeMakerCreds | null;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  createUuid?: () => string;
}

export type CodeMakerLoginStart = LoginStart & {
  waitUntilComplete: () => Promise<AuthStatus>;
};

interface LoginInfoResponse {
  access_user?: string;
  access_token?: string;
  access_sso_token?: string;
  expire?: number;
  ttl?: number;
}

interface AuthKeyResponse {
  auth_key?: string;
}

function defaultOpenBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") {
    void execFileAsync("open", [url]).catch(() => {});
    return;
  }
  if (platform === "win32") {
    void execFileAsync("cmd", ["/c", "start", "", url]).catch(() => {});
    return;
  }
  void execFileAsync("xdg-open", [url]).catch(() => {});
}

function buildLoginUrl(baseUrl: string, uuid: string): string {
  const url = new URL(`${baseUrl}${CODEMAKER_LOGIN_PATH}`);
  url.searchParams.set("ide", "cli");
  url.searchParams.set("uuid", uuid);
  url.searchParams.set("redirect_uri", `vs://cli?uuid=${uuid}`);
  return url.toString();
}

async function pollLoginInfo(
  fetchImpl: typeof fetch,
  baseUrl: string,
  uuid: string,
  pollIntervalMs: number,
  pollTimeoutMs: number,
): Promise<LoginInfoResponse> {
  const started = Date.now();
  while (Date.now() - started < pollTimeoutMs) {
    const res = await fetchImpl(`${baseUrl}${CODEMAKER_LOGIN_INFO_PATH}/${uuid}`);
    if (res.ok) {
      const body = (await res.json()) as LoginInfoResponse;
      if (body.access_user && body.access_token) {
        return body;
      }
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error("CodeMaker login timed out");
}

async function fetchAuthKey(
  fetchImpl: typeof fetch,
  baseUrl: string,
  accessToken: string,
): Promise<string | undefined> {
  const res = await fetchImpl(`${baseUrl}${CODEMAKER_AUTH_KEY_PATH}`, {
    headers: { "X-Access-Token": accessToken },
  });
  if (!res.ok) {
    throw new Error(`Failed to get auth key (${res.status})`);
  }
  const body = (await res.json()) as AuthKeyResponse;
  return body.auth_key;
}

function toAuthStatus(creds: CodeMakerCreds | null): AuthStatus {
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
}

/**
 * Start CodeMaker browser SSO (matches CLI NetEaseCodeMakerAuthPlugin):
 * open `/vs_login?ide=cli&uuid=&redirect_uri=`, poll `/vs_login_info/:uuid`,
 * then `GET /get_auth_key` for refresh_key and persist under ~/.muse-work.
 */
export async function beginCodeMakerLogin(
  opts: BeginCodeMakerLoginOptions = {},
): Promise<CodeMakerLoginStart> {
  const home = opts.home ?? os.homedir();
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const baseUrl = opts.baseUrl ?? CODEMAKER_API_BASE_URL;
  const load =
    opts.loadCredentials ?? (() => loadCodeMakerCredentials(home));
  const openBrowser = opts.openBrowser ?? defaultOpenBrowser;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pollTimeoutMs = opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const createUuid = opts.createUuid ?? randomUUID;

  const existing = load();
  if (existing && !isExpired(existing)) {
    return {
      reused: true,
      waitUntilComplete: async () => toAuthStatus(existing),
    };
  }

  const uuid = createUuid();
  const authUrl = buildLoginUrl(baseUrl, uuid);
  openBrowser(authUrl);

  let completed: Promise<AuthStatus> | undefined;

  const waitUntilComplete = async (): Promise<AuthStatus> => {
    if (!completed) {
      completed = (async () => {
        const info = await pollLoginInfo(
          fetchImpl,
          baseUrl,
          uuid,
          pollIntervalMs,
          pollTimeoutMs,
        );
        const refreshKey = await fetchAuthKey(
          fetchImpl,
          baseUrl,
          info.access_token!,
        );
        const creds: CodeMakerCreds = {
          accessToken: info.access_token!,
          accessUser: info.access_user!,
          refreshKey,
        };
        if (typeof info.expire === "number") {
          creds.expire = info.expire;
        } else if (typeof info.ttl === "number") {
          creds.expire = Date.now() + info.ttl * 1000;
        }
        saveCodeMakerCredentials(creds, home);
        return toAuthStatus(creds);
      })();
    }
    return completed;
  };

  return { authUrl, waitUntilComplete };
}
