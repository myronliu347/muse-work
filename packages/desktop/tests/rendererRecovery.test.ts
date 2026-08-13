import { describe, expect, it, vi } from "vitest";
import { attachRendererRecovery } from "../src/main/window.js";

function fakeWindow(overrides: { destroyed?: boolean } = {}) {
  const contentsListeners = new Map<
    string,
    (event: unknown, details: { reason: string }) => void
  >();
  const windowListeners = new Map<string, () => void>();
  const reload = vi.fn();
  const win = {
    isDestroyed: () => overrides.destroyed === true,
    reload,
    on(event: string, listener: () => void) {
      windowListeners.set(event, listener);
    },
    webContents: {
      on(
        event: string,
        listener: (event: unknown, details: { reason: string }) => void,
      ) {
        contentsListeners.set(event, listener);
      },
    },
  };
  return { win, reload, emit: contentsListeners, emitWindow: windowListeners };
}

describe("attachRendererRecovery", () => {
  it("reloads the window when the renderer process crashes", () => {
    const { win, reload, emit } = fakeWindow();
    attachRendererRecovery(win);

    emit.get("render-process-gone")?.({}, { reason: "crashed" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload after a clean exit or when the window is gone", () => {
    const clean = fakeWindow();
    attachRendererRecovery(clean.win);
    clean.emit.get("render-process-gone")?.({}, { reason: "clean-exit" });
    expect(clean.reload).not.toHaveBeenCalled();

    const gone = fakeWindow({ destroyed: true });
    attachRendererRecovery(gone.win);
    gone.emit.get("render-process-gone")?.({}, { reason: "crashed" });
    expect(gone.reload).not.toHaveBeenCalled();
  });

  it("reloads when the window becomes unresponsive", () => {
    const { win, reload, emitWindow } = fakeWindow();
    attachRendererRecovery(win);
    emitWindow.get("unresponsive")?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
