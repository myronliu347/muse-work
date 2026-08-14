import { describe, expect, it, vi } from "vitest";
import { createQuitGate } from "../src/main/quitGate.js";

describe("createQuitGate", () => {
  it("prevents default, awaits stop, then quits once when idle", async () => {
    let stopped = false;
    const quit = vi.fn();
    const dispose = vi.fn();
    const gate = createQuitGate({
      dispose,
      stopServer: async () => {
        await new Promise((r) => setTimeout(r, 15));
        stopped = true;
      },
      quit,
      confirmQuitWhileBusy: async () => true,
    });

    const preventDefault = vi.fn();
    gate.handleBeforeQuit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
    expect(stopped).toBe(false);

    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    expect(stopped).toBe(true);

    preventDefault.mockClear();
    gate.handleBeforeQuit({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("asks for confirmation when the agent is busy, then prepares and quits", async () => {
    const quit = vi.fn();
    const dispose = vi.fn();
    const prepareQuit = vi.fn(async () => {});
    const confirmQuitWhileBusy = vi.fn(async () => true);

    const gate = createQuitGate({
      dispose,
      stopServer: async () => {},
      quit,
      confirmQuitWhileBusy,
      prepareQuit,
    });
    gate.setAgentBusy(true);

    const preventDefault = vi.fn();
    gate.handleBeforeQuit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(confirmQuitWhileBusy).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    expect(prepareQuit).toHaveBeenCalledTimes(1);

    // Second before-quit (from opts.quit) proceeds gracefully.
    preventDefault.mockClear();
    dispose.mockClear();
    gate.handleBeforeQuit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(2));
  });

  it("stays open when the user cancels the busy-quit confirm", async () => {
    const quit = vi.fn();
    const dispose = vi.fn();
    const gate = createQuitGate({
      dispose,
      quit,
      confirmQuitWhileBusy: async () => false,
      prepareQuit: async () => {},
    });
    gate.setAgentBusy(true);

    const preventDefault = vi.fn();
    gate.handleBeforeQuit({ preventDefault });
    await new Promise((r) => setTimeout(r, 30));
    expect(quit).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("blocks window close while busy until confirmed", async () => {
    const quit = vi.fn();
    const gate = createQuitGate({
      dispose: () => {},
      quit,
      confirmQuitWhileBusy: async () => true,
      prepareQuit: async () => {},
    });
    gate.setAgentBusy(true);

    const preventDefault = vi.fn();
    gate.handleWindowClose({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
  });

  it("allows window close when idle", () => {
    const quit = vi.fn();
    const gate = createQuitGate({
      dispose: () => {},
      quit,
      confirmQuitWhileBusy: async () => true,
    });
    const preventDefault = vi.fn();
    gate.handleWindowClose({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });
});
