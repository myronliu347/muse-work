import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMuseServer } from "../src/main/serverProcess.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeServer = path.join(__dirname, "fixtures", "fake-server.mjs");

describe("startMuseServer", () => {
  it("resolves ready port from stdout JSON and stop exits the child", async () => {
    const handle = await startMuseServer({ entry: fakeServer });
    expect(handle.port).toBe(19191);

    await handle.stop();

    // Child should be gone; a second stop is a no-op.
    await handle.stop();
  });

  it("rejects when entry exits before ready", async () => {
    const boom = path.join(__dirname, "fixtures", "boom-server.mjs");
    await expect(startMuseServer({ entry: boom, readyTimeoutMs: 2000 })).rejects.toThrow(
      /exited before ready|ready/i,
    );
  });

  it("restarts after crash using the first ready port", async () => {
    const marker = path.join(os.tmpdir(), `muse-crash-restart-${process.pid}.log`);
    fs.rmSync(marker, { force: true });

    const crashRestart = path.join(
      __dirname,
      "fixtures",
      "crash-restart-server.mjs",
    );
    const handle = await startMuseServer({
      entry: crashRestart,
      restartBackoffMs: 10,
      readyTimeoutMs: 5000,
      env: { ...process.env, CRASH_RESTART_MARKER: marker },
    });
    expect(handle.port).toBe(19191);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const log = fs.readFileSync(marker, "utf8");
    expect(log).toContain("spawn --port 0\n");
    expect(log).toContain("spawn --port 19191\n");

    await handle.stop();
    fs.rmSync(marker, { force: true });
  });

  it("emits restarting then ready lifecycle events after a crash", async () => {
    const marker = path.join(os.tmpdir(), `muse-crash-life-${process.pid}.log`);
    fs.rmSync(marker, { force: true });
    const events: Array<{ state: string; restart?: number }> = [];

    const handle = await startMuseServer({
      entry: path.join(__dirname, "fixtures", "crash-restart-server.mjs"),
      restartBackoffMs: 10,
      readyTimeoutMs: 5000,
      env: { ...process.env, CRASH_RESTART_MARKER: marker },
      onLifecycle: (event) => {
        events.push(event);
      },
    });

    await expect
      .poll(() => events.some((e) => e.state === "ready"))
      .toBe(true);

    expect(events.map((e) => e.state)).toEqual(["restarting", "ready"]);
    expect(events[0]).toMatchObject({ state: "restarting", restart: 1 });
    expect(events[1]).toMatchObject({ state: "ready", restart: 1, port: 19191 });

    await handle.stop();
    fs.rmSync(marker, { force: true });
  });

  it("emits dead when max restarts is zero", async () => {
    const events: Array<{ state: string }> = [];
    const handle = await startMuseServer({
      entry: path.join(__dirname, "fixtures", "crash-restart-server.mjs"),
      maxRestarts: 0,
      restartBackoffMs: 10,
      readyTimeoutMs: 5000,
      onLifecycle: (event) => {
        events.push(event);
      },
    });

    await expect.poll(() => events.some((e) => e.state === "dead")).toBe(true);
    expect(events.map((e) => e.state)).toEqual(["dead"]);

    await handle.stop();
  });
});
