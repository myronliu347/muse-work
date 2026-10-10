import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PopoConfig } from "../src/popo/popoConfig.js";
import type { PopoRuntime } from "../src/popo/setup.js";
import { createAppContext } from "../src/services/appContext.js";
import { closeTestApp, listenTestApp } from "./helpers.js";

const execFileAsync = promisify(execFile);

const SCRIPT = path.join(
  import.meta.dirname,
  "..",
  "plugins",
  "popo-notify",
  "skills",
  "popo-notify",
  "scripts",
  "popo-notify.mjs",
);

async function runScript(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [SCRIPT, ...args],
      { encoding: "utf8", env },
    );
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      code?: number | null;
    };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: err.code ?? 1,
    };
  }
}

function popoRuntime(sendText: PopoRuntime["sendText"]): PopoRuntime {
  const config: PopoConfig = {
    appId: "id",
    appKey: "key",
    appSecret: "secret",
    token: "tk",
    aesKey: "ak",
    masterUid: "master@corp.netease.com",
  };
  return {
    config,
    callbackPort: 3100,
    ready: true,
    url: "http://127.0.0.1:3100/popo/callback",
    configured: true,
    sendText,
  };
}

describe("popo-notify plugin script", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) await closeTestApp(server, home);
    server = undefined;
    home = undefined;
  });

  it("send --text posts /popo/notify via MUSE_SERVER_URL", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-popo-notify-script-"));
    const ctx = createAppContext({ home });
    const sent: Array<{ receiver: string; content: string }> = [];
    ctx.popo = popoRuntime(async (receiver, content) => {
      sent.push({ receiver, content });
    });
    const app = await listenTestApp({ home, ctx });
    server = app.server;

    const { stdout, code } = await runScript(["send", "--text", "巡检完成"], {
      ...process.env,
      MUSE_SERVER_URL: app.baseUrl,
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ ok: true });
    expect(sent).toEqual([
      { receiver: "master@corp.netease.com", content: "巡检完成" },
    ]);
  });
});
