import { describe, expect, it, vi } from "vitest";
import { createHealthWatch } from "../src/main/healthWatch.js";

describe("createHealthWatch", () => {
  it("calls onUnhealthy after consecutive failed probes", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const queued: Array<() => void> = [];
    const onUnhealthy = vi.fn();

    const watch = createHealthWatch({
      getUrl: () => "http://127.0.0.1:9/health",
      intervalMs: 10,
      timeoutMs: 20,
      failThreshold: 3,
      fetch: fetchMock as unknown as typeof fetch,
      schedule: (fn) => {
        queued.push(fn);
        return queued.length as unknown as ReturnType<typeof setInterval>;
      },
      clearSchedule: () => {
        queued.length = 0;
      },
      onUnhealthy,
    });
    watch.start();

    expect(queued).toHaveLength(1);
    await queued[0]!();
    await queued[0]!();
    expect(onUnhealthy).not.toHaveBeenCalled();
    await queued[0]!();
    expect(onUnhealthy).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it("resets the failure count after a successful probe", async () => {
    let fails = 0;
    const fetchMock = vi.fn(async () => {
      fails += 1;
      if (fails === 2) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error("down");
    });
    const queued: Array<() => void> = [];
    const onUnhealthy = vi.fn();

    const watch = createHealthWatch({
      getUrl: () => "http://127.0.0.1:9/health",
      intervalMs: 10,
      failThreshold: 3,
      fetch: fetchMock as unknown as typeof fetch,
      schedule: (fn) => {
        queued.push(fn);
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearSchedule: () => {
        queued.length = 0;
      },
      onUnhealthy,
    });
    watch.start();
    await queued[0]!();
    await queued[0]!();
    await queued[0]!();
    await queued[0]!();
    expect(onUnhealthy).not.toHaveBeenCalled();
    watch.stop();
  });

  it("probeNow returns false when the health endpoint is down", async () => {
    const watch = createHealthWatch({
      getUrl: () => "http://127.0.0.1:9/health",
      fetch: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
      onUnhealthy: () => {},
    });
    expect(await watch.probeNow()).toBe(false);
  });
});
