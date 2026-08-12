import { describe, expect, it } from "vitest";
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
});
