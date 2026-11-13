import { describe, it, expect, vi, beforeEach } from "vitest";
import { TerminalManager } from "../src/main/terminal";

// node-pty is a native module — stub it so tests never spawn a real shell.
const mockPty = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node-pty", () => mockPty);

function stubPty() {
  const handlers: {
    onData: ((d: string) => void) | null;
    onExit: ((e: { exitCode: number }) => void) | null;
  } = { onData: null, onExit: null };
  mockPty.spawn.mockReturnValue({
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb: (d: string) => void) => {
      handlers.onData = cb;
      return { dispose: vi.fn() };
    },
    onExit: (cb: (e: { exitCode: number }) => void) => {
      handlers.onExit = cb;
      return { dispose: vi.fn() };
    },
  });
  return handlers;
}

describe("TerminalManager.clear", () => {
  beforeEach(() => {
    mockPty.spawn.mockReset();
  });

  it("clears the replay buffer but keeps the pty process running", async () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const mgr = new TerminalManager({ onData, onExit });
    const pty = stubPty();
    await mgr.create("t1", "/tmp", 80, 24);
    expect(mockPty.spawn).toHaveBeenCalledTimes(1);

    // Emit some output so a replay buffer accumulates.
    pty.onData?.("hello");

    // Re-attach replays the buffered output.
    onData.mockClear();
    await mgr.create("t1", "/tmp", 80, 24);
    expect(onData).toHaveBeenCalledWith("t1", "hello");

    // Clear the buffer; the pty is NOT killed.
    mgr.clear("t1");
    const proc = mockPty.spawn.mock.results[0].value;
    expect(proc.kill).not.toHaveBeenCalled();

    // Re-attach now replays nothing.
    onData.mockClear();
    await mgr.create("t1", "/tmp", 80, 24);
    expect(onData).not.toHaveBeenCalled();
  });

  it("clear on an unknown termId is a no-op", () => {
    const mgr = new TerminalManager({ onData: vi.fn(), onExit: vi.fn() });
    expect(() => mgr.clear("nope")).not.toThrow();
  });

  it("reports a missing workdir instead of spawning into it", async () => {
    const onExit = vi.fn();
    const mgr = new TerminalManager({ onData: vi.fn(), onExit });
    await mgr.create("t1", "/nope/muse-missing-workdir", 80, 24);
    // node-pty's spawn helper would exit 1 without printing why.
    expect(mockPty.spawn).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledWith("t1", {
      error: "工作目录不存在（可能已被删除）：/nope/muse-missing-workdir",
    });
  });
});
