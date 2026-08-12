import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getCodeMakerAuthPath,
  getSharedCodeMakerAuthPath,
} from "../src/paths.js";
import {
  isExpired,
  loadCodeMakerCredentials,
  saveCodeMakerCredentials,
} from "../src/codemaker/credentials.js";
import type { CodeMakerCreds } from "../src/codemaker/types.js";

function writeSharedAuth(
  home: string,
  entry: {
    access_token: string;
    refresh_key?: string;
    access_user: string;
    expire?: number;
  },
): void {
  const sharedPath = getSharedCodeMakerAuthPath(home);
  fs.mkdirSync(path.dirname(sharedPath), { recursive: true });
  fs.writeFileSync(
    sharedPath,
    JSON.stringify({ "netease-codemaker": { type: "api", ...entry } }),
    "utf-8",
  );
}

function writeMuseAuth(home: string, creds: CodeMakerCreds): void {
  const musePath = getCodeMakerAuthPath(home);
  fs.mkdirSync(path.dirname(musePath), { recursive: true });
  fs.writeFileSync(musePath, JSON.stringify(creds), "utf-8");
}

describe("loadCodeMakerCredentials", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-creds-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("prefers muse auth over shared codemaker auth", () => {
    writeSharedAuth(tmp, {
      access_token: "shared-token",
      refresh_key: "shared-refresh",
      access_user: "alice",
      expire: 9999999999999,
    });
    writeMuseAuth(tmp, {
      accessToken: "muse-token",
      refreshKey: "muse-refresh",
      accessUser: "bob",
      expire: 8888888888888,
    });

    const creds = loadCodeMakerCredentials(tmp);
    expect(creds).toEqual({
      accessToken: "muse-token",
      refreshKey: "muse-refresh",
      accessUser: "bob",
      expire: 8888888888888,
    });
  });

  it("falls back to shared auth when muse missing", () => {
    writeSharedAuth(tmp, {
      access_token: "shared-token",
      refresh_key: "shared-refresh",
      access_user: "alice",
      expire: 9999999999999,
    });

    const creds = loadCodeMakerCredentials(tmp);
    expect(creds).toEqual({
      accessToken: "shared-token",
      refreshKey: "shared-refresh",
      accessUser: "alice",
      expire: 9999999999999,
    });
  });

  it("returns null when both missing", () => {
    expect(loadCodeMakerCredentials(tmp)).toBeNull();
  });
});

describe("saveCodeMakerCredentials", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-creds-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes muse auth file with mode 0o600", () => {
    const creds: CodeMakerCreds = {
      accessToken: "token",
      refreshKey: "refresh",
      accessUser: "alice",
      expire: 9999999999999,
    };
    saveCodeMakerCredentials(creds, tmp);

    const musePath = getCodeMakerAuthPath(tmp);
    expect(fs.existsSync(musePath)).toBe(true);
    expect(fs.statSync(musePath).mode & 0o777).toBe(0o600);
    expect(loadCodeMakerCredentials(tmp)).toEqual(creds);
  });
});

describe("isExpired", () => {
  it("returns false when expire is undefined", () => {
    expect(
      isExpired({ accessToken: "t", accessUser: "u" }, Date.now()),
    ).toBe(false);
  });

  it("returns true when now is at or past expire", () => {
    expect(
      isExpired(
        { accessToken: "t", accessUser: "u", expire: 1000 },
        1000,
      ),
    ).toBe(true);
    expect(
      isExpired(
        { accessToken: "t", accessUser: "u", expire: 1000 },
        2000,
      ),
    ).toBe(true);
  });

  it("returns false when now is before expire", () => {
    expect(
      isExpired(
        { accessToken: "t", accessUser: "u", expire: 5000 },
        1000,
      ),
    ).toBe(false);
  });
});
