import { createHash, createHmac, randomBytes } from "node:crypto";
import type { CodeMakerCreds } from "./types.js";

/**
 * Client HMAC key embedded in CodeMaker CLI (netease-fetch signer).
 * Not the user refresh_key — signature input is token-derived.
 */
const CODEMAKER_CLIENT_SIGNING_KEY = "3a056620226481312c2e74da0320b6a6";

export interface SignParts {
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
}

export function getSigningKey(): string {
  return CODEMAKER_CLIENT_SIGNING_KEY;
}

export function tokenHashPrefix(accessToken: string): string {
  return createHash("sha256")
    .update(accessToken, "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** Canonical string: `${nonce}.${timestamp}.${sha256(token).hex[:16]}` */
export function buildCanonicalString(parts: {
  accessToken: string;
  timestamp: number;
  nonce: string;
}): string {
  return `${parts.nonce}.${parts.timestamp}.${tokenHashPrefix(parts.accessToken)}`;
}

export function signCanonical(canonical: string, key = getSigningKey()): string {
  return createHmac("sha256", key).update(canonical, "utf8").digest("hex");
}

export function buildCodeMakerHeaders(
  creds: CodeMakerCreds,
  parts: SignParts,
): Record<string, string> {
  // method/path are accepted for API symmetry; CLI signer does not include them.
  void parts.method;
  void parts.path;

  const canonical = buildCanonicalString({
    accessToken: creds.accessToken,
    timestamp: parts.timestamp,
    nonce: parts.nonce,
  });

  return {
    "X-Access-Token": creds.accessToken,
    "X-Auth-User": creds.accessUser,
    "X-Timestamp": String(parts.timestamp),
    "X-Nonce": parts.nonce,
    "X-Sig-Version": "v1",
    "X-Signature": signCanonical(canonical),
  };
}

function resolveUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  return new URL(input.url);
}

function newNonce(): string {
  return randomBytes(8).toString("hex");
}

export function createCodeMakerFetch(
  creds: CodeMakerCreds,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const url = resolveUrl(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );

    const signed = buildCodeMakerHeaders(creds, {
      method,
      path: url.pathname + url.search,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: newNonce(),
    });

    for (const [key, value] of Object.entries(signed)) {
      headers.set(key, value);
    }

    return baseFetch(input, { ...init, headers });
  };
}
