import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCodexAuthPath } from "../paths.js";
import { parseChatGptClaims } from "./jwt.js";

export interface CodexCreds {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  accountId?: string;
  email?: string;
  issuer: string;
  clientId: string;
  loginOwnerId: string;
  /** ISO timestamp of the last successful token issue or refresh. */
  lastRefresh: string;
}

interface CodexAuthFile {
  auth_mode: "chatgpt";
  tokens: {
    id_token: string;
    access_token: string;
    refresh_token: string;
    oauth_provenance: { issuer: string; client_id: string };
    login_owner_id: string;
    account_id?: string;
  };
  last_refresh: string;
}

function toCreds(file: CodexAuthFile): CodexCreds | null {
  const tokens = file.tokens;
  if (!tokens?.access_token || !tokens.refresh_token || !tokens.id_token) {
    return null;
  }
  const claims = parseChatGptClaims(tokens.id_token);
  return {
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accountId: tokens.account_id ?? claims.accountId,
    email: claims.email,
    issuer: tokens.oauth_provenance?.issuer,
    clientId: tokens.oauth_provenance?.client_id,
    loginOwnerId: tokens.login_owner_id,
    lastRefresh: file.last_refresh,
  };
}

function toFile(creds: CodexCreds): CodexAuthFile {
  return {
    auth_mode: "chatgpt",
    tokens: {
      id_token: creds.idToken,
      access_token: creds.accessToken,
      refresh_token: creds.refreshToken,
      oauth_provenance: {
        issuer: creds.issuer,
        client_id: creds.clientId,
      },
      login_owner_id: creds.loginOwnerId,
      ...(creds.accountId ? { account_id: creds.accountId } : {}),
    },
    last_refresh: creds.lastRefresh,
  };
}

export function loadCodexCredentials(home = os.homedir()): CodexCreds | null {
  const authPath = getCodexAuthPath(home);
  if (!fs.existsSync(authPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(authPath, "utf8")) as CodexAuthFile;
    const creds = toCreds(raw);
    if (!creds?.issuer || !creds.clientId || !creds.loginOwnerId || !creds.lastRefresh) {
      return null;
    }
    return creds;
  } catch {
    return null;
  }
}

export function saveCodexCredentials(
  creds: CodexCreds,
  home = os.homedir(),
): void {
  const authPath = getCodexAuthPath(home);
  fs.mkdirSync(path.dirname(authPath), { recursive: true, mode: 0o700 });
  const body = JSON.stringify(toFile(creds), null, 2) + "\n";
  fs.writeFileSync(authPath, body, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(authPath, 0o600);
  } catch {
    // chmod is best-effort on filesystems that ignore it
  }
}

export function clearCodexCredentials(home = os.homedir()): void {
  const authPath = getCodexAuthPath(home);
  if (fs.existsSync(authPath)) {
    fs.unlinkSync(authPath);
  }
}
