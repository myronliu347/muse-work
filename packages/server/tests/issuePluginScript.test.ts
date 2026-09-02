import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeTestApp, listenTestApp } from "./helpers.js";

const execFileAsync = promisify(execFile);

const SCRIPT = path.join(
  import.meta.dirname,
  "..",
  "plugins",
  "issue",
  "skills",
  "issue-management",
  "scripts",
  "issue.mjs",
);

describe("issue plugin script (issue.mjs)", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) await closeTestApp(server, home);
    server = undefined;
    home = undefined;
  });

  it("create prints JSON with title via MUSE_SERVER_URL", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    // Must be async execFile: execFileSync would block the event loop and
    // deadlock the in-process listenTestApp HTTP server.
    const { stdout } = await execFileAsync(
      process.execPath,
      [SCRIPT, "create", "--title", "x"],
      {
        encoding: "utf8",
        env: { ...process.env, MUSE_SERVER_URL: app.baseUrl },
      },
    );
    const parsed = JSON.parse(stdout) as { title?: string };
    expect(parsed.title).toBe("x");
  });

  it("无 MUSE_SERVER_URL 时回退读 MUSE_HOME 下 server-url 端口文件", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const museHome = path.join(home, ".muse-work");
    fs.mkdirSync(museHome, { recursive: true });
    fs.writeFileSync(path.join(museHome, "server-url"), app.baseUrl);

    const {
      MUSE_SERVER_URL: _u,
      MUSE_HOME: _h,
      MUSE_HOME_DIR: _hd,
      ...rest
    } = process.env;
    const { stdout } = await execFileAsync(
      process.execPath,
      [SCRIPT, "create", "--title", "端口文件 issue"],
      {
        encoding: "utf8",
        env: { ...rest, MUSE_HOME: home },
      },
    );
    const parsed = JSON.parse(stdout) as { title?: string };
    expect(parsed.title).toBe("端口文件 issue");
  });
});
