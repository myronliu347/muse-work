import { describe, expect, it } from "vitest";
import {
  installRuntimeStats,
  type RuntimeStatsOptions,
} from "../src/utils/runtimeStats.js";

function captureLog(): {
  log: NonNullable<RuntimeStatsOptions["log"]>;
  calls: Array<[string, Record<string, unknown> | undefined]>;
} {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  return {
    log: {
      info: (message, meta) => calls.push([message, meta]),
    },
    calls,
  };
}

function fakeMemoryUsage(overrides: Partial<NodeJS.MemoryUsage> = {}): NodeJS.MemoryUsage {
  return {
    rss: 100,
    heapTotal: 50,
    heapUsed: 30,
    external: 5,
    arrayBuffers: 2,
    ...overrides,
  };
}

/** Collects scheduled callbacks so tests can tick manually; records clears. */
function fakeSchedule(): {
  schedule: NonNullable<RuntimeStatsOptions["schedule"]>;
  clearSchedule: NonNullable<RuntimeStatsOptions["clearSchedule"]>;
  ticks: Array<() => void | Promise<void>>;
  cleared: Array<unknown>;
} {
  const ticks: Array<() => void | Promise<void>> = [];
  const cleared: Array<unknown> = [];
  let nextId = 1;
  return {
    schedule: (fn) => {
      ticks.push(fn);
      return nextId++;
    },
    clearSchedule: (id) => {
      cleared.push(id);
    },
    ticks,
    cleared,
  };
}

describe("installRuntimeStats", () => {
  it("samples immediately and logs memory plus live counters", () => {
    const { log, calls } = captureLog();
    const { schedule, clearSchedule, ticks } = fakeSchedule();
    const store = { list: () => [{ id: "a" }, { id: "b" }] };

    const stats = installRuntimeStats({
      store: store as never,
      getAgentCount: () => 3,
      getClientCount: () => 1,
      log,
      schedule,
      clearSchedule,
      memoryUsage: () => fakeMemoryUsage(),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("runtime stats");
    const meta = calls[0][1]!;
    expect(meta.rss).toBe(100);
    expect(meta.heapTotal).toBe(50);
    expect(meta.heapUsed).toBe(30);
    expect(meta.external).toBe(5);
    expect(meta.arrayBuffers).toBe(2);
    expect(meta.sessions).toBe(2);
    expect(meta.agents).toBe(3);
    expect(meta.wsClients).toBe(1);

    // Subsequent ticks append more lines.
    ticks[0]?.();
    expect(calls).toHaveLength(2);
    stats.stop();
  });

  it("uses the default logger when none is provided", () => {
    const { schedule, clearSchedule, ticks } = fakeSchedule();
    const stats = installRuntimeStats({
      store: { list: () => [] } as never,
      getAgentCount: () => 0,
      getClientCount: () => 0,
      schedule,
      clearSchedule,
      memoryUsage: () => fakeMemoryUsage(),
    });
    expect(ticks).toHaveLength(1);
    stats.stop();
  });

  it("stop() clears the interval", () => {
    const { log } = captureLog();
    const { schedule, clearSchedule, cleared } = fakeSchedule();
    const stats = installRuntimeStats({
      store: { list: () => [] } as never,
      getAgentCount: () => 0,
      getClientCount: () => 0,
      log,
      schedule,
      clearSchedule,
      memoryUsage: () => fakeMemoryUsage(),
    });
    stats.stop();
    expect(cleared).toHaveLength(1);
  });
});
