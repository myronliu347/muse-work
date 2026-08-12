import type { CodeMakerCreds } from "./types.js";
import { saveCodeMakerCredentials } from "./credentials.js";
import { CODEMAKER_API_BASE_URL } from "./login.js";

/** CodeMaker CLI `NetEaseCodeMakerAuthPlugin` renew endpoint. */
export const CODEMAKER_RENEW_TOKEN_PATH = "/renew_token";

export interface RenewResponse {
  token?: string;
  user?: string;
  ttl?: string | number;
  expire?: string | number;
}

export interface RenewCodeMakerCredentialsOptions {
  creds: CodeMakerCreds;
  fetch?: typeof fetch;
  baseUrl?: string;
  home?: string;
  save?: (creds: CodeMakerCreds, home?: string) => void;
}

/**
 * Refresh an expired CodeMaker access token using refresh_key.
 * Matches CLI: POST /renew_token body `{ key: refresh_key, user: access_user }`.
 */
export async function renewCodeMakerCredentials(
  opts: RenewCodeMakerCredentialsOptions,
): Promise<CodeMakerCreds> {
  const { creds } = opts;
  if (!creds.refreshKey) {
    throw new Error("CodeMaker credentials missing refresh_key");
  }
  if (!creds.accessUser) {
    throw new Error("CodeMaker credentials missing access_user");
  }

  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const baseUrl = opts.baseUrl ?? CODEMAKER_API_BASE_URL;
  const res = await fetchImpl(`${baseUrl}${CODEMAKER_RENEW_TOKEN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: creds.refreshKey, user: creds.accessUser }),
  });

  if (!res.ok) {
    throw new Error(`CodeMaker token renew failed (${res.status})`);
  }

  const body = (await res.json()) as RenewResponse;
  if (!body.token) {
    throw new Error("CodeMaker token renew response missing token");
  }

  const next: CodeMakerCreds = {
    accessToken: body.token,
    accessUser: body.user ?? creds.accessUser,
    refreshKey: creds.refreshKey,
  };

  if (body.expire != null && body.expire !== "") {
    // CLI stores expire as parseInt(expire) * 1000 (seconds → ms).
    next.expire = parseInt(String(body.expire), 10) * 1000;
  } else if (body.ttl != null && body.ttl !== "") {
    next.expire = Date.now() + parseInt(String(body.ttl), 10) * 1000;
  }

  const save = opts.save ?? saveCodeMakerCredentials;
  save(next, opts.home);
  return next;
}
