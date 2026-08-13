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

/**
 * Fallback when `CODEMAKER_CLI_VERSION` is unset. Keep in sync with a known
 * working CodeMaker CLI release so the gateway does not rewrite models.
 */
const DEFAULT_CODEMAKER_CLI_VERSION = "1.18.9-prod-0.3.70-26.8.12";

/** Prefer `CODEMAKER_CLI_VERSION` env; otherwise use the bundled default. */
export function resolveCodeMakerCliVersion(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.CODEMAKER_CLI_VERSION?.trim();
  return fromEnv && fromEnv.length > 0
    ? fromEnv
    : DEFAULT_CODEMAKER_CLI_VERSION;
}

/**
 * Client identity headers mirroring CodeMaker CLI (`netease-codemaker` fetch).
 * Without both `ide` and `codemaker-version`, the gateway may rewrite the
 * requested model (e.g. deepseek-v4-flash → kimi-k2.5).
 */
export function buildCodeMakerClientHeaders(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const version = resolveCodeMakerCliVersion(env);
  return {
    ide: "cli",
    "codemaker-version": version,
    "User-Agent": `opencode/${version}`,
    mode_type: "build",
  };
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
    ...buildCodeMakerClientHeaders(),
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

    // Debug: log outbound chat body model / image presence (no raw base64 dump).
    if (process.env.MUSE_DEBUG_CODEMAKER_FETCH === "1") {
      logOutboundBody(method, url, init?.body);
    }

    return baseFetch(input, { ...init, headers });
  };
}

function bodyToString(body: BodyInit | null | undefined): string | null {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString("utf8");
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }
  return null;
}

function logOutboundBody(
  method: string,
  url: URL,
  body: BodyInit | null | undefined,
): void {
  const raw = bodyToString(body);
  if (!raw) {
    console.error(
      `[muse-codemaker-fetch] ${method} ${url.pathname} (no string body)`,
    );
    return;
  }
  try {
    const parsed = JSON.parse(raw) as {
      model?: unknown;
      messages?: unknown;
      stream?: unknown;
    };
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    let imageParts = 0;
    for (const msg of messages) {
      const content = (msg as { content?: unknown })?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (
          part &&
          typeof part === "object" &&
          (part as { type?: string }).type === "image_url"
        ) {
          imageParts += 1;
        }
      }
    }
    console.error(
      `[muse-codemaker-fetch] ${method} ${url.pathname} model=${String(parsed.model)} messages=${messages.length} image_url_parts=${imageParts} stream=${String(parsed.stream)} body_bytes=${Buffer.byteLength(raw)}`,
    );
  } catch {
    console.error(
      `[muse-codemaker-fetch] ${method} ${url.pathname} body_bytes=${Buffer.byteLength(raw)} (non-json)`,
    );
  }
}
