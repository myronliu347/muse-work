import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import { gracefulShutdown, installGracefulShutdown } from "../src/shutdown.js";

describe("gracefulShutdown", () => {
  it("aborts running turns, closes the hub and HTTP server, then exits", async () => {
    const runner = { shutdown: vi.fn(async () => ({ aborted: 2 })) };
    const hub = { close: vi.fn() };
    const server = {
      close: vi.fn((cb?: (err?: Error) => void) => {
        cb?.();
      }),
    };
    const exit = vi.fn();
    const log = { info: vi.fn(), error: vi.fn() };

    await gracefulShutdown({
      runner,
      hub,
      server: server as unknown as http.Server,
      log,
      exit,
    });

    expect(runner.shutdown).toHaveBeenCalledTimes(1);
    expect(hub.close).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(runner.shutdown.mock.invocationCallOrder[0]).toBeLessThan(
      hub.close.mock.invocationCallOrder[0]!,
    );
  });

  it("installGracefulShutdown runs once on SIGTERM", async () => {
    const runner = { shutdown: vi.fn(async () => ({ aborted: 0 })) };
    const hub = { close: vi.fn() };
    const server = {
      close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
    };
    const exit = vi.fn();
    const listeners = new Map<string, () => void>();
    const processLike = {
      on: vi.fn((event: string, handler: () => void) => {
        listeners.set(event, handler);
        return processLike;
      }),
    };

    installGracefulShutdown({
      runner,
      hub,
      server: server as unknown as http.Server,
      exit,
      process: processLike as unknown as NodeJS.Process,
    });

    expect(processLike.on).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(processLike.on).toHaveBeenCalledWith("SIGINT", expect.any(Function));

    listeners.get("SIGTERM")?.();
    listeners.get("SIGTERM")?.();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(runner.shutdown).toHaveBeenCalledTimes(1);
  });
});
