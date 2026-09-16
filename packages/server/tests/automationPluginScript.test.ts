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
  "automation",
  "skills",
  "automation-management",
  "scripts",
  "automation.mjs",
);

async function runScript(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string }> {
  // Must be async execFile: execFileSync would block the event loop and
  // deadlock the in-process listenTestApp HTTP server.
  return execFileAsync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env,
  });
}

describe("automation plugin script (automation.mjs)", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) await closeTestApp(server, home);
    server = undefined;
    home = undefined;
  });

  it("create prints JSON with name via MUSE_SERVER_URL", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const { stdout } = await runScript(
      [
        "create",
        "--name",
        "巡检",
        "--prompt",
        "检查 changelog",
        "--workdir",
        app.home,
        "--cron",
        "0 9 * * *",
      ],
      { ...process.env, MUSE_SERVER_URL: app.baseUrl },
    );
    const parsed = JSON.parse(stdout) as {
      name?: string;
      prompt?: string;
      workdir?: string;
      triggers?: Array<{ type: string; expr?: string }>;
    };
    expect(parsed.name).toBe("巡检");
    expect(parsed.prompt).toBe("检查 changelog");
    expect(parsed.workdir).toBe(app.home);
    expect(parsed.triggers).toEqual([{ type: "cron", expr: "0 9 * * *" }]);
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
    const { stdout } = await runScript(
      [
        "create",
        "--name",
        "端口文件自动化",
        "--prompt",
        "x",
        "--workdir",
        app.home,
        "--cron",
        "0 9 * * *",
      ],
      { ...rest, MUSE_HOME: home },
    );
    const parsed = JSON.parse(stdout) as { name?: string };
    expect(parsed.name).toBe("端口文件自动化");
  });

  it("create 可叠加多个 --cron 与 --issue-events，list/enable/disable/run/runs 打测服 HTTP", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const env = { ...process.env, MUSE_SERVER_URL: app.baseUrl };

    const createdOut = await runScript(
      [
        "create",
        "--name",
        "巡检",
        "--prompt",
        "x",
        "--workdir",
        app.home,
        "--description",
        "每日",
        "--cron",
        "0 9 * * *",
        "--cron",
        "0 18 * * *",
        "--issue-events",
        "created,review",
        "--model",
        "fast",
        "--agent",
        "muse",
      ],
      env,
    );
    const created = JSON.parse(createdOut.stdout) as {
      id: string;
      enabled: boolean;
      description: string;
      model?: string;
      agentName?: string;
      triggers: Array<{ type: string }>;
    };
    expect(created.enabled).toBe(true);
    expect(created.description).toBe("每日");
    expect(created.model).toBe("fast");
    expect(created.agentName).toBe("muse");
    expect(created.triggers).toEqual([
      { type: "cron", expr: "0 9 * * *" },
      { type: "cron", expr: "0 18 * * *" },
      { type: "issue", events: ["created", "review"] },
    ]);

    const listed = JSON.parse((await runScript(["list"], env)).stdout) as {
      automations: Array<{ id: string }>;
    };
    expect(listed.automations.map((a) => a.id)).toContain(created.id);

    const got = JSON.parse(
      (await runScript(["get", "--id", created.id], env)).stdout,
    ) as { id: string };
    expect(got.id).toBe(created.id);

    const disabled = JSON.parse(
      (await runScript(["disable", "--id", created.id], env)).stdout,
    ) as { enabled: boolean };
    expect(disabled.enabled).toBe(false);

    const enabled = JSON.parse(
      (await runScript(["enable", "--id", created.id], env)).stdout,
    ) as { enabled: boolean };
    expect(enabled.enabled).toBe(true);

    const run = JSON.parse(
      (await runScript(["run", "--id", created.id], env)).stdout,
    ) as { status?: string; trigger?: { type?: string } };
    expect(run.status).toBe("running");
    expect(run.trigger?.type).toBe("manual");

    const runs = JSON.parse(
      (await runScript(["runs", "--id", created.id], env)).stdout,
    ) as { runs?: Array<{ id: string }> };
    expect(runs.runs).toHaveLength(1);
  });
});
