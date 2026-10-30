import os from "node:os";
import {
  clearCodexCredentials,
  loadCodexCredentials,
  saveCodexCredentials,
  type CodexCreds,
} from "./credentials.js";
import { parseChatGptClaims } from "./jwt.js";

/** Refresh when the access token expires inside this window. */
export const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
/** Fallback when the access token has no `exp` claim. */
export const SCHEDULED_REFRESH_MS = 8 * 24 * 60 * 60 * 1000;

const PERMANENT_ERROR_CODES = new Set([
  "invalid_grant",
  "refresh_token_expired",
  "refresh_token_reused",
  "refresh_token_invalidated",
]);

export class CodexRefreshError extends Error {
  readonly permanent: boolean;

  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "CodexRefreshError";
    this.permanent = permanent;
  }
}

export function accessTokenNeedsRefresh(creds: CodexCreds, now = Date.now()): boolean {
  const exp = parseChatGptClaims(creds.accessToken).exp;
  if (exp !== undefined) {
    return exp * 1000 <= now + ACCESS_TOKEN_REFRESH_WINDOW_MS;
  }
  const last = Date.parse(creds.lastRefresh);
  if (Number.isNaN(last)) return true;
  return last < now - SCHEDULED_REFRESH_MS;
}

interface RefreshBody {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

export async function refreshCodexCredentials(opts: {
  creds: CodexCreds;
  home?: string;
  fetch?: typeof fetch;
  now?: Date;
}): Promise<CodexCreds> {
  const home = opts.home ?? os.homedir();
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const endpoint = `${opts.creds.issuer.replace(/\/$/, "")}/oauth/token`;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: opts.creds.refreshToken,
        client_id: opts.creds.clientId,
      }),
    });
  } catch (err) {
    throw new CodexRefreshError(
      err instanceof Error ? err.message : "Codex token refresh failed",
      false,
    );
  }

  const text = await response.text();
  let body: RefreshBody = {};
  if (text) {
    try {
      body = JSON.parse(text) as RefreshBody;
    } catch {
      body = {};
    }
  }

  if (!response.ok) {
    const code = typeof body.error === "string" ? body.error.toLowerCase() : "";
    const permanent =
      response.status === 401 || PERMANENT_ERROR_CODES.has(code);
    if (permanent) {
      clearCodexCredentials(home);
    }
    throw new CodexRefreshError(
      permanent
        ? "Codex refresh token was rejected. Sign in again."
        : `Codex token refresh failed (${response.status})`,
      permanent,
    );
  }

  if (!body.access_token || !body.refresh_token) {
    throw new CodexRefreshError("Codex token refresh returned no tokens", false);
  }

  const stored = loadCodexCredentials(home);
  if (
    !stored ||
    stored.loginOwnerId !== opts.creds.loginOwnerId ||
    stored.refreshToken !== opts.creds.refreshToken
  ) {
    throw new CodexRefreshError(
      "Account credentials changed during refresh.",
      false,
    );
  }

  const idToken = body.id_token ?? stored.idToken;
  const claims = parseChatGptClaims(idToken);
  const next: CodexCreds = {
    ...stored,
    idToken,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    accountId: claims.accountId ?? stored.accountId,
    email: claims.email ?? stored.email,
    lastRefresh: (opts.now ?? new Date()).toISOString(),
  };
  saveCodexCredentials(next, home);
  return next;
}
