import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeAgentLogger,
  configureLogger,
  createAgentLogger,
  createLogger,
  resolveLogDir,
} from "../src/logger.js";

describe("logger", () => {
  const homes: string[] = [];

  afterEach(() => {
    configureLogger({ silent: true, disableFile: true });
    for (const home of homes.splice(0)) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("writes human-readable lines to ~/.muse-work/logs/server.log", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-log-"));
    homes.push(home);

    const log = createLogger({
      home,
      silent: true,
      disableFile: false,
      level: "info",
    });
    log.info("session created", { sessionId: "s1", model: "m1" });

    // File transport may flush asynchronously.
    await new Promise((r) => setTimeout(r, 50));
    await new Promise<void>((resolve, reject) => {
      log.on("finish", () => resolve());
      log.end();
      setTimeout(() => reject(new Error("logger end timeout")), 2000);
    });

    const file = path.join(resolveLogDir(home), "server.log");
    expect(fs.existsSync(file)).toBe(true);
    const body = fs.readFileSync(file, "utf8");
    expect(body).toMatch(/\] INFO session created/);
    expect(body).toContain("sessionId=s1");
    expect(body).toContain("model=m1");
  });

  it("respects MUSE_LOG_FILE=0 and skips the file transport", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-log-nofile-"));
    homes.push(home);
    const prev = process.env.MUSE_LOG_FILE;
    process.env.MUSE_LOG_FILE = "0";
    try {
      const log = createLogger({ home, silent: true });
      log.info("noop");
      log.close();
      expect(fs.existsSync(resolveLogDir(home))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MUSE_LOG_FILE;
      else process.env.MUSE_LOG_FILE = prev;
    }
  });

  it("writes per-session agent logs to ~/.muse-work/logs/sessions/<id>.log", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-agent-log-"));
    homes.push(home);
    const sessionId = "62fed1c7-2560-4d1a-a827-15c8a9ae3d29";
    const log = createAgentLogger({
      home,
      sessionId,
      silent: true,
      disableFile: false,
    });
    log.info("turn started", { model: "deepseek-v4-flash" });
    log.error("Failed to call OpenAI:", new Error("empty stream"));

    await new Promise((r) => setTimeout(r, 50));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("agent logger close timeout")), 2000);
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      closeAgentLogger(sessionId);
      setTimeout(done, 50);
    });

    const file = path.join(resolveLogDir(home), "sessions", `${sessionId}.log`);
    expect(fs.existsSync(file)).toBe(true);
    const body = fs.readFileSync(file, "utf8");
    expect(body).toMatch(/\] INFO turn started/);
    expect(body).toContain("sessionId=" + sessionId);
    expect(body).toContain("source=agent");
    expect(body).toMatch(/\] ERROR Failed to call OpenAI/);
  });
});
