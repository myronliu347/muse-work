import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getCodeMakerAuthPath,
  getSharedCodeMakerAuthPath,
} from "../paths.js";
import type { CodeMakerCreds } from "./types.js";

interface SharedCodeMakerEntry {
  access_token?: string;
  refresh_key?: string;
  access_user?: string;
  expire?: number;
}

interface SharedAuthFile {
  "netease-codemaker"?: SharedCodeMakerEntry;
}

function normalizeSharedEntry(entry: SharedCodeMakerEntry): CodeMakerCreds | null {
  if (!entry.access_token || !entry.access_user) {
    return null;
  }
  return {
    accessToken: entry.access_token,
    refreshKey: entry.refresh_key,
    accessUser: entry.access_user,
    expire: entry.expire,
  };
}

function loadFromMuse(home: string): CodeMakerCreds | null {
  const musePath = getCodeMakerAuthPath(home);
  if (!fs.existsSync(musePath)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(musePath, "utf-8")) as
    | CodeMakerCreds
    | SharedAuthFile;

  if ("accessToken" in raw && raw.accessToken && raw.accessUser) {
    return raw as CodeMakerCreds;
  }

  const entry = (raw as SharedAuthFile)["netease-codemaker"];
  if (!entry) {
    return null;
  }
  return normalizeSharedEntry(entry);
}

function loadFromShared(home: string): CodeMakerCreds | null {
  const sharedPath = getSharedCodeMakerAuthPath(home);
  if (!fs.existsSync(sharedPath)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(sharedPath, "utf-8")) as SharedAuthFile;
  const entry = raw["netease-codemaker"];
  if (!entry) {
    return null;
  }
  return normalizeSharedEntry(entry);
}

export function loadCodeMakerCredentials(
  home = os.homedir(),
): CodeMakerCreds | null {
  return loadFromMuse(home) ?? loadFromShared(home);
}

export function saveCodeMakerCredentials(
  creds: CodeMakerCreds,
  home = os.homedir(),
): void {
  const musePath = getCodeMakerAuthPath(home);
  fs.mkdirSync(path.dirname(musePath), { recursive: true });
  fs.writeFileSync(
    musePath,
    JSON.stringify(creds, null, 2) + "\n",
    { mode: 0o600 },
  );
  fs.chmodSync(musePath, 0o600);
}

export function isExpired(
  creds: CodeMakerCreds,
  now = Date.now(),
): boolean {
  if (creds.expire === undefined) {
    return false;
  }
  return now >= creds.expire;
}
