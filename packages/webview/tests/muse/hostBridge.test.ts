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

  it("forwards loading / tool / reasoning WS events to webview commands", () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
    } as unknown as MuseWsClient;

    createHostBridge({
      api: stubApi(),
      ws,
      workdir: "/tmp",
    });
    expect(handler).toBeTypeOf("function");

    handler!({ type: "loading", loading: true });
    expect(messages).toContainEqual({ command: "startStreaming" });

    handler!({ type: "assistant:message", messageId: "asst_1" });
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "appendMessage",
        message: expect.objectContaining({ id: "asst_1", role: "assistant" }),
      }),
    );

    handler!({
      type: "tool:update",
      params: {
        messageId: "asst_1",
        id: "tool_1",
        name: "Read",
        stage: "end",
        success: true,
      },
    });
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "updateToolBlock",
        params: expect.objectContaining({ id: "tool_1", name: "Read" }),
      }),
    );

    handler!({
      type: "message:delta",
      messageId: "asst_1",
      text: "hello",
      stage: "streaming",
    });
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "updateStreamingContent",
        messageId: "asst_1",
        chunk: "hello",
      }),
    );

    handler!({ type: "loading", loading: false });
    expect(messages).toContainEqual({ command: "endStreaming" });
  });

  it("forwards compaction and subagent WS events to webview commands", () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
    } as unknown as MuseWsClient;

    createHostBridge({
      api: stubApi(),
      ws,
      workdir: "/tmp",
    });

    handler!({ type: "compaction:state", isCompacting: true });
    expect(messages).toContainEqual({
      command: "compactionStateChange",
      isCompacting: true,
    });

    const replaced = [
      {
        id: "c1",
        role: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [{ type: "compact", content: "summary" }],
      },
    ];
    handler!({ type: "messages:replace", messages: replaced });
    expect(messages).toContainEqual({
      command: "updateMessages",
      messages: replaced,
    });

    handler!({
      type: "subagent:assistant:message",
      subagentId: "sa1",
      messageId: "m9",
    });
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "appendMessage",
        message: expect.objectContaining({
          id: "sa_sa1_m9",
          role: "assistant",
        }),
      }),
    );

    handler!({
      type: "subagent:message:delta",
      subagentId: "sa1",
      messageId: "m9",
      text: "nested",
      stage: "streaming",
    });
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "updateStreamingContent",
        messageId: "sa_sa1_m9",
        chunk: "nested",
      }),
    );

    handler!({
      type: "subagent:tool:update",
      subagentId: "sa1",
      params: {
        messageId: "m9",
        id: "t1",
        name: "Read",
        stage: "end",
        success: true,
      },
    });
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "updateToolBlock",
        params: expect.objectContaining({
          messageId: "sa_sa1_m9",
          id: "t1",
          name: "Read",
        }),
      }),
    );
  });
});
