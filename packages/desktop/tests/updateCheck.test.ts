import { describe, expect, it, vi } from "vitest";
import {
  UPDATE_CHECK_INTERVAL_MS,
  createUpdateMonitor,
  statusAfterCheck,
} from "../src/main/updateCheck";

describe("statusAfterCheck", () => {
  it("turns a newer shell into an installer offer and a hot download into a restart offer", () => {
    expect(statusAfterCheck(null, { status: "updated", version: "0.1.1" })).toEqual({
      phase: "available",
      offer: { kind: "hot", version: "0.1.1" },
    });
    expect(
      statusAfterCheck(null, {
        status: "installer",
        version: "0.2.0",
        shell: "0.2.0",
        url: "https://example.test/Muse.dmg",
      }),
    ).toEqual({
      phase: "available",
      offer: { kind: "installer", version: "0.2.0", url: "https://example.test/Muse.dmg" },
    });
  });

  it("keeps a downloaded-but-not-running update as a restart offer", () => {
    expect(statusAfterCheck(null, { status: "restart", version: "0.2.0" })).toEqual({
      phase: "available",
      offer: { kind: "hot", version: "0.2.0" },
    });
  });

  it("clears the offer when already current, and keeps it when the check fails", () => {
    const prev = { kind: "hot" as const, version: "0.1.1" };
    expect(statusAfterCheck(prev, { status: "current" })).toEqual({
      phase: "current",
      offer: null,
    });
    expect(statusAfterCheck(prev, { status: "skipped", reason: "offline" })).toEqual({
      phase: "available",
      offer: prev,
      detail: "offline",
    });
    expect(statusAfterCheck(null, { status: "skipped", reason: "offline" })).toEqual({
      phase: "failed",
      offer: null,
      detail: "offline",
    });
  });
});

describe("createUpdateMonitor", () => {
  it("checks once at start and again every thirty minutes", async () => {
    const ticks: Array<() => void> = [];
    let checks = 0;
    const monitor = createUpdateMonitor({
      check: async () => {
        checks += 1;
        return { status: "current" };
      },
      publish: () => {},
      setIntervalFn: ((fn: () => void, ms: number) => {
        expect(ms).toBe(UPDATE_CHECK_INTERVAL_MS);
        ticks.push(fn);
        return 1 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
      clearIntervalFn: () => {},
    });

    monitor.start();
    await vi.waitFor(() => expect(checks).toBe(1));
    expect(monitor.status().phase).toBe("current");
    ticks[0]?.();
    await vi.waitFor(() => expect(checks).toBe(2));
  });
});
