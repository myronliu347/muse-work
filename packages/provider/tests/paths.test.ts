import { describe, expect, it, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  getCodeMakerAuthPath,
  getMuseHomeDir,
  getProvidersConfigPath,
  getSessionsConfigPath,
} from "../src/paths.js";

const savedHomeDir = process.env.MUSE_HOME_DIR;

afterEach(() => {
  if (savedHomeDir === undefined) delete process.env.MUSE_HOME_DIR;
  else process.env.MUSE_HOME_DIR = savedHomeDir;
});

describe("getMuseHomeDir", () => {
  it("defaults to ~/.muse-work", () => {
    delete process.env.MUSE_HOME_DIR;
    expect(getMuseHomeDir("/home/u")).toBe(path.join("/home/u", ".muse-work"));
  });

  it("honors MUSE_HOME_DIR for the state dir name (dev/test isolation)", () => {
    process.env.MUSE_HOME_DIR = ".dev-muse-work";
    expect(getMuseHomeDir("/home/u")).toBe(
      path.join("/home/u", ".dev-muse-work"),
    );
    // 派生路径（providers/sessions）同步跟随
    expect(getProvidersConfigPath("/home/u")).toBe(
      path.join("/home/u", ".dev-muse-work", "providers.json"),
    );
    expect(getSessionsConfigPath("/home/u")).toBe(
      path.join("/home/u", ".dev-muse-work", "sessions.json"),
    );
    // auth 例外：凭证按账号共享，prod/dev 保持一致（不随 MUSE_HOME_DIR）
    expect(getCodeMakerAuthPath("/home/u")).toBe(
      path.join("/home/u", ".muse-work", "auth", "codemaker.json"),
    );
  });

  it("accepts an explicit dirName override (independent of env)", () => {
    process.env.MUSE_HOME_DIR = ".other";
    expect(getMuseHomeDir("/home/u", ".custom")).toBe(
      path.join("/home/u", ".custom"),
    );
  });
});
