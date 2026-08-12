/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildSidebarModel,
  createHostBridge,
} from "../../src/muse/hostBridge";
import type { MuseApiClient, MuseSession } from "../../src/muse/apiClient";
import type { MuseWsClient } from "../../src/muse/wsClient";

const baseSession: MuseSession = {
  id: "sess-active",
  workdir: "/tmp",
  createdAt: 1,
  lastActiveAt: 2,
  status: "idle",
  title: "新对话",
  model: "m1",
  pinned: false,
};

function stubApi(overrides: Partial<MuseApiClient> = {}): MuseApiClient {
  return {
    baseUrl: "http://127.0.0.1:9",
    getAuthStatus: vi.fn(async () => ({
      state: "unauthenticated",
      providerId: "codemaker",
    })),
    listSessionsGrouped: vi.fn(async () => ({
      pinned: [],
      recent: [baseSession],
      activeSessionId: "sess-active",
    })),
    selectSession: vi.fn(async (id: string) => ({
      session: { ...baseSession, id },
    })),
    getMessages: vi.fn(async () => ({ messages: [] })),
    createSession: vi.fn(async () => baseSession),
    patchSession: vi.fn(async (id: string, patch: Partial<MuseSession>) => ({
      ...baseSession,
      id,
      ...patch,
    })),
    deleteSession: vi.fn(async () => ({ ok: true as const })),
    sendMessage: vi.fn(async () => ({ accepted: true as const })),
    ...overrides,
  } as unknown as MuseApiClient;
}

function stubWs(): MuseWsClient {
  return {
    onEvent: vi.fn(),
    connect: vi.fn(async () => {}),
  } as unknown as MuseWsClient;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe("buildSidebarModel", () => {
  it("builds pin/recent pseudo groups", () => {
    const pinned: MuseSession[] = [
      { ...baseSession, id: "p1", pinned: true, title: "Pinned" },
    ];
    const recent: MuseSession[] = [
      { ...baseSession, id: "r1", title: "Recent" },
    ];
    const groups = buildSidebarModel({ pinned, recent });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.workdir).toBe("pin");
    expect(groups[0]?.sessions[0]?.sessionId).toBe("p1");
    expect(groups[0]?.sessions[0]?.pinned).toBe(true);
    expect(groups[1]?.workdir).toBe("recent");
    expect(groups[1]?.sessions[0]?.sessionId).toBe("r1");
    expect(groups[1]?.sessions[0]?.workdir).toBe("/tmp");
  });
});

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

  it("desktopReady posts desktopWorkdirState so UI is not stuck loading", async () => {
    const outer = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    };
    const bridge = createHostBridge({
      api: stubApi(),
      ws: stubWs(),
      workdir: "/Users/demo/project",
      outer,
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();

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
    const outer = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    };
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

  it("desktopReady connects WS once to * and loads session tree", async () => {
    const ws = stubWs();
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws,
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();

    expect(ws.connect).toHaveBeenCalledWith("*");
    expect(api.listSessionsGrouped).toHaveBeenCalled();
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "desktopSessionTree",
        groups: expect.arrayContaining([
          expect.objectContaining({ workdir: "recent" }),
        ]),
      }),
    );
  });

  it("selectSession loads messages into ChatApp via updateMessages", async () => {
    const history = [
      {
        id: "m1",
        role: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [{ type: "text", content: "hi" }],
      },
    ];
    const api = stubApi({
      getMessages: vi.fn(async () => ({ messages: history })),
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [{ ...baseSession, id: "sess-b" }],
        activeSessionId: "sess-active",
      })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({
      command: "desktopSelectSession",
      sessionId: "sess-b",
      workdir: "/tmp",
    });
    await flush();

    expect(api.selectSession).toHaveBeenCalledWith("sess-b");
    expect(api.getMessages).toHaveBeenCalledWith("sess-b");
    expect(messages).toContainEqual({
      command: "updateMessages",
      messages: history,
    });
  });

  it("non-focus session:status running only updates tree, not startStreaming", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
    } as unknown as MuseWsClient;

    const other: MuseSession = {
      ...baseSession,
      id: "sess-other",
      title: "Other",
    };
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [baseSession, other],
        activeSessionId: "sess-active",
      })),
    });

    const bridge = createHostBridge({
      api,
      ws,
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    handler!({
      type: "session:status",
      sessionId: "sess-other",
      status: "running",
    });
    await flush();

    expect(messages).not.toContainEqual({ command: "startStreaming" });
    const tree = messages.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { command?: string }).command === "desktopSessionTree",
    ) as { groups?: Array<{ sessions: Array<{ sessionId: string; running?: boolean }> }> } | undefined;
    const entry = tree?.groups
      ?.flatMap((g) => g.sessions)
      .find((s) => s.sessionId === "sess-other");
    expect(entry?.running).toBe(true);
  });

  it("forwards loading / tool / reasoning WS events only for active session", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
    } as unknown as MuseWsClient;

    const bridge = createHostBridge({
      api: stubApi(),
      ws,
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;
    expect(handler).toBeTypeOf("function");

    handler!({ type: "loading", sessionId: "sess-active", loading: true });
    expect(messages).toContainEqual({ command: "startStreaming" });

    handler!({
      type: "assistant:message",
      sessionId: "sess-active",
      messageId: "asst_1",
    });
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "appendMessage",
        message: expect.objectContaining({ id: "asst_1", role: "assistant" }),
      }),
    );

    handler!({
      type: "tool:update",
      sessionId: "sess-active",
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
      sessionId: "sess-active",
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

    handler!({ type: "loading", sessionId: "sess-active", loading: false });
    expect(messages).toContainEqual({ command: "endStreaming" });

    messages.length = 0;
    handler!({ type: "loading", sessionId: "sess-other", loading: true });
    expect(messages).not.toContainEqual({ command: "startStreaming" });
  });

  it("forwards compaction and subagent WS events for active session", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
    } as unknown as MuseWsClient;

    const bridge = createHostBridge({
      api: stubApi(),
      ws,
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    handler!({
      type: "compaction:state",
      sessionId: "sess-active",
      isCompacting: true,
    });
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
    handler!({
      type: "messages:replace",
      sessionId: "sess-active",
      messages: replaced,
    });
    expect(messages).toContainEqual({
      command: "updateMessages",
      messages: replaced,
    });

    handler!({
      type: "subagent:assistant:message",
      sessionId: "sess-active",
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
      sessionId: "sess-active",
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
      sessionId: "sess-active",
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
