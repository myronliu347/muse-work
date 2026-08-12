#!/usr/bin/env node
/**
 * Local probe: try candidate signature algorithms against CodeMaker API.
 * Reads ~/.local/share/codemaker/auth.json — never prints tokens/keys.
 *
 * Usage: node packages/provider/scripts/probe-sign.mjs
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = "https://api-code-maker.nie.netease.com";
const CLIENT_KEY = "3a056620226481312c2e74da0320b6a6";

function loadAuth() {
  const path = join(homedir(), ".local", "share", "codemaker", "auth.json");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const entry = raw["netease-codemaker"];
  if (!entry?.access_token || !entry?.access_user) {
    throw new Error("missing netease-codemaker credentials in auth.json");
  }
  return {
    token: entry.access_token,
    user: entry.access_user,
    refreshKey: entry.refresh_key ?? "",
  };
}

function tokenHash16(token) {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16);
}

function hmacHex(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

function candidates(auth, method, path, timestamp, nonce) {
  const t16 = tokenHash16(auth.token);
  const keys = [
    ["clientKey", CLIENT_KEY],
    ["refreshKey", auth.refreshKey],
    ["accessToken", auth.token],
  ].filter(([, k]) => !!k);

  const strings = [
    ["nonce.ts.t16", `${nonce}.${timestamp}.${t16}`],
    ["method.path.nonce.ts.t16", `${method}.${path}.${nonce}.${timestamp}.${t16}`],
    ["method\\npath\\nnonce\\nts\\nt16", `${method}\n${path}\n${nonce}\n${timestamp}\n${t16}`],
    ["token.nonce.ts", `${auth.token}.${nonce}.${timestamp}`],
    ["nonce.ts.token", `${nonce}.${timestamp}.${auth.token}`],
    ["ts.nonce.t16", `${timestamp}.${nonce}.${t16}`],
  ];

  const out = [];
  for (const [keyName, key] of keys) {
    for (const [canonName, canon] of strings) {
      out.push({
        id: `${keyName}|${canonName}`,
        signature: hmacHex(key, canon),
      });
    }
  }
  return out;
}

function isSignatureFailure(status, body) {
  const text = body.toLowerCase();
  if (status === 401 || status === 403) {
    return /signature|sig|auth failed|unauthorized|invalid/.test(text);
  }
  return /signature|auth failed/.test(text);
}

async function probeOne(auth, cand, method, path, timestamp, nonce) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-Access-Token": auth.token,
      "X-Auth-User": auth.user,
      "X-Timestamp": String(timestamp),
      "X-Nonce": nonce,
      "X-Sig-Version": "v1",
      "X-Signature": cand.signature,
      Accept: "application/json",
    },
  });
  const body = await res.text();
  const sigFail = isSignatureFailure(res.status, body);
  return {
    id: cand.id,
    status: res.status,
    sigFail,
    // only print a short body class, never tokens
    bodyClass: body.slice(0, 80).replace(/\s+/g, " "),
  };
}

async function main() {
  const auth = loadAuth();
  console.log("probe-sign: credentials loaded (values not printed)");
  console.log(`tokenHash16 prefix: ${tokenHash16(auth.token).slice(0, 4)}…`);
  console.log(
    "CLI lock formula: HMAC-SHA256(clientKey, `${nonce}.${ts}.${sha256(token)[:16]}`)",
  );

  // Prefer /validate (auth-bearing) then /openai/v1/models.
  const targets = [
    { method: "GET", path: "/validate" },
    { method: "GET", path: "/openai/v1/models" },
  ];

  let best = null;
  for (const { method, path } of targets) {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(8).toString("hex");
    const list = candidates(auth, method, path, timestamp, nonce);
    // Put CLI formula first
    list.sort((a, b) => {
      const rank = (id) => (id === "clientKey|nonce.ts.t16" ? 0 : 1);
      return rank(a.id) - rank(b.id);
    });
    console.log(`trying ${list.length} candidates against ${method} ${path}`);

    for (const cand of list) {
      const result = await probeOne(auth, cand, method, path, timestamp, nonce);
      const mark = result.sigFail ? "SIG_FAIL" : "NON_SIG";
      console.log(
        `[${mark}] status=${result.status} id=${result.id} body=${result.bodyClass}`,
      );
      if (!result.sigFail && (!best || result.status < best.status)) {
        best = { ...result, path };
      }
      if (!result.sigFail && result.status >= 200 && result.status < 300) {
        if (cand.id === "clientKey|nonce.ts.t16") {
          console.log(
            `LOCKED candidate: ${cand.id} via ${path} (status=${result.status})`,
          );
          process.exit(0);
        }
        best = { ...result, path };
        break;
      }
    }
  }

  if (best && !best.sigFail) {
    console.log(
      `BEST NON_SIG candidate: ${best.id} via ${best.path} (status=${best.status})`,
    );
    console.log(
      "Note: live API may not reject bad signatures; CLI binary formula remains source of truth.",
    );
    process.exit(0);
  }
  console.log("NO_LOCK: all candidates looked like signature/auth failures");
  process.exit(2);
}

main().catch((err) => {
  console.error("probe-sign error:", err.message);
  process.exit(1);
});
