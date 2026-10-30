import { createHash, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import type { AuthStatus, LoginStart } from "../types.js";
import {
  loadCodexCredentials,
  saveCodexCredentials,
  type CodexCreds,
} from "./credentials.js";
import { parseChatGptClaims } from "./jwt.js";

/** Public OAuth client registered for the Codex CLI callback ports. */
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_ISSUER = "https://auth.openai.com";
export const CODEX_ORIGINATOR = "codex_cli_rs";
export const CODEX_OAUTH_SCOPES =
  "openid profile email offline_access api.connectors.read api.connectors.invoke";

const DEFAULT_PORT = 1455;
const FALLBACK_PORT = 1457;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export interface BeginCodexLoginOptions {
  openBrowser?: (url: string) => void;
  fetch?: typeof fetch;
  home?: string;
  issuer?: string;
  clientId?: string;
  /** `0` binds an ephemeral port. Production uses 1455, then 1457. */
  port?: number;
  loadCredentials?: () => CodexCreds | null;
  forcedWorkspaceIds?: string[];
  loginTimeoutMs?: number;
}

export type CodexLoginStart = LoginStart & {
  waitUntilComplete: () => Promise<AuthStatus>;
};

interface ExchangedTokens {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function toAuthStatus(creds: CodexCreds): AuthStatus {
  return {
    state: "authenticated",
    user: creds.email,
    providerId: "codex",
  };
}

function assertWorkspaceAllowed(
  expected: string[] | undefined,
  accountId: string | undefined,
): void {
  if (!expected || expected.length === 0) return;
  if (accountId && expected.includes(accountId)) return;
  throw new Error(
    `Login is restricted to workspace id(s) ${expected.join(", ")}.`,
  );
}

function buildAuthorizeUrl(opts: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(`${opts.issuer.replace(/\/$/, "")}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("scope", CODEX_OAUTH_SCOPES);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", CODEX_ORIGINATOR);
  return url.toString();
}

async function exchangeCode(opts: {
  fetchImpl: typeof fetch;
  issuer: string;
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<ExchangedTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: opts.clientId,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.verifier,
  });
  const response = await opts.fetchImpl(
    `${opts.issuer.replace(/\/$/, "")}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status})`);
  }
  const parsed = (await response.json()) as ExchangedTokens;
  if (!parsed.id_token || !parsed.access_token || !parsed.refresh_token) {
    throw new Error("Token exchange returned no tokens");
  }
  return parsed;
}

function listen(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const onError = (err: Error) => {
      server.close();
      reject(err);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(server);
    });
  });
}

async function bindLoginServer(port: number | undefined): Promise<{
  server: http.Server;
  port: number;
}> {
  const chosen =
    port === undefined ? [DEFAULT_PORT, FALLBACK_PORT] : [port];
  let lastError: unknown;
  for (const candidate of chosen) {
    try {
      const server = await listen(candidate);
      const address = server.address();
      const actual =
        typeof address === "object" && address ? address.port : candidate;
      return { server, port: actual };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to bind the Codex login callback");
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  headers?: Record<string, string>,
): Promise<void> {
  return new Promise((resolve) => {
    res.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      Connection: "close",
      ...headers,
    });
    res.end(body, () => resolve());
  });
}

export async function beginCodexLogin(
  opts: BeginCodexLoginOptions = {},
): Promise<CodexLoginStart> {
  const home = opts.home ?? os.homedir();
  const load = opts.loadCredentials ?? (() => loadCodexCredentials(home));
  const existing = load();
  if (existing?.accessToken && existing.refreshToken) {
    return {
      reused: true,
      waitUntilComplete: async () => toAuthStatus(existing),
    };
  }

  const issuer = opts.issuer ?? CODEX_ISSUER;
  const clientId = opts.clientId ?? CODEX_CLIENT_ID;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const openBrowser = opts.openBrowser;
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(16).toString("base64url");
  const { server, port } = await bindLoginServer(opts.port);
  server.unref();
  const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
  const authUrl = buildAuthorizeUrl({
    issuer,
    clientId,
    redirectUri,
    challenge,
    state,
  });

  let settled = false;
  let resolveLogin: (status: AuthStatus) => void = () => {};
  let rejectLogin: (err: Error) => void = () => {};
  const done = new Promise<AuthStatus>((resolve, reject) => {
    resolveLogin = resolve;
    rejectLogin = reject;
  });
  // The callback may settle before the caller awaits this promise.
  done.catch(() => {});

  const finish = (action: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    action();
    server.close();
  };

  const timer = setTimeout(() => {
    finish(() => rejectLogin(new Error("Codex login timed out")));
  }, opts.loginTimeoutMs ?? LOGIN_TIMEOUT_MS);
  timer.unref();

  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/cancel") {
      await send(res, 200, "Login cancelled");
      finish(() => rejectLogin(new Error("Login cancelled")));
      return;
    }
    if (url.pathname === "/success") {
      await send(res, 200, "Signed in. You can close this window.");
      return;
    }
    if (url.pathname !== "/auth/callback") {
      await send(res, 404, "Not Found");
      return;
    }
    if (settled) {
      await send(res, 409, "Login already finished");
      return;
    }

    const callbackState = url.searchParams.get("state") ?? "";
    if (callbackState !== state) {
      await send(res, 400, "State mismatch");
      finish(() => rejectLogin(new Error("State mismatch")));
      return;
    }
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      const description = url.searchParams.get("error_description") ?? oauthError;
      await send(res, 400, description);
      finish(() => rejectLogin(new Error(description)));
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      await send(res, 400, "Missing authorization code");
      finish(() => rejectLogin(new Error("Missing authorization code")));
      return;
    }

    try {
      const tokens = await exchangeCode({
        fetchImpl,
        issuer,
        clientId,
        redirectUri,
        code,
        verifier,
      });
      const claims = parseChatGptClaims(tokens.id_token!);
      assertWorkspaceAllowed(opts.forcedWorkspaceIds, claims.accountId);
      const stored: CodexCreds = {
        idToken: tokens.id_token!,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token!,
        accountId: claims.accountId,
        email: claims.email,
        issuer,
        clientId,
        loginOwnerId: randomUUID(),
        lastRefresh: new Date().toISOString(),
      };
      saveCodexCredentials(stored, home);
      await send(res, 302, "", { Location: "/success" });
      finish(() => resolveLogin(toAuthStatus(stored)));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /workspace/i.test(message) ? 403 : 502;
      await send(res, status, message);
      finish(() => rejectLogin(err instanceof Error ? err : new Error(message)));
    }
  }

  openBrowser?.(authUrl);
  return { authUrl, waitUntilComplete: () => done };
}
