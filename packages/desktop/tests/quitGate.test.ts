import { describe, expect, it, vi } from "vitest";
import { createQuitGate } from "../src/main/quitGate.js";

describe("createQuitGate", () => {
  it("prevents default, awaits stop, then quits once", async () => {
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
});
