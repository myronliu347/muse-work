/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createHostBridge } from "../../src/muse/hostBridge";
import type { MuseApiClient } from "../../src/muse/apiClient";
import type { MuseWsClient } from "../../src/muse/wsClient";

function stubApi(): MuseApiClient {
  return {
    baseUrl: "http://127.0.0.1:9",
    getAuthStatus: vi.fn(async () => ({
      state: "unauthenticated",
      providerId: "codemaker",
    })),
  } as unknown as MuseApiClient;
}

function stubWs(): MuseWsClient {
  return {
    onEvent: vi.fn(),
    connect: vi.fn(async () => {}),
  } as unknown as MuseWsClient;
}

describe("createHostBridge desktop workdir bootstrap", () => {
  const messages: unknown[] = [];

  beforeEach(() => {
    messages.length = 0;
    vi.spyOn(window, "dispatchEvent").mockImplementation((event) => {
      if (event instanceof MessageEvent) {
        messages.push(event.data);
      }
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("desktopReady posts desktopWorkdirState so UI is not stuck loading", () => {
    const outer = { postMessage: vi.fn(), getState: () => null, setState: () => {} };
    const bridge = createHostBridge({
      api: stubApi(),
      ws: stubWs(),
      workdir: "/Users/demo/project",
      outer,
    });

    bridge.postMessage({ command: "desktopReady" });

    expect(messages).toContainEqual({
      command: "desktopWorkdirState",
      workdir: "/Users/demo/project",
      recentWorkdirs: [],
      host: "local",
      hosts: [],
    });
    expect(outer.postMessage).toHaveBeenCalledWith({ command: "desktopReady" });
  });

  it("desktopSelectWorkdir is forwarded to outer (Electron folder pick)", () => {
    const outer = { postMessage: vi.fn(), getState: () => null, setState: () => {} };
    const bridge = createHostBridge({
      api: stubApi(),
      ws: stubWs(),
      outer,
    });

    bridge.postMessage({ command: "desktopSelectWorkdir" });
    expect(outer.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectWorkdir",
    });
  });
});
