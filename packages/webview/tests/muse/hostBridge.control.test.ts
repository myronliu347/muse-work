/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createHostBridge } from "../../src/muse/hostBridge";
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
      providerId: "hosted",
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
    abortMessage: vi.fn(async () => ({ ok: true as const })),
    respondPermission: vi.fn(async () => ({ ok: true as const })),
    compact: vi.fn(async () => ({ ok: true as const })),
    clear: vi.fn(async () => ({ ok: true as const })),
    listRewindCheckpoints: vi.fn(async () => ({ checkpoints: [] })),
    rewind: vi.fn(async () => ({ ok: true as const, inputContent: "" })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
    getSessionStatus: vi.fn(async () => ({
      sessionId: "sess-active",
      workdir: "/tmp",
      permissionMode: "acceptEdits",
      latestTotalTokens: 0,
    })),
    getMcpServers: vi.fn(async () => ({ servers: [] })),
    connectMcpServer: vi.fn(async () => ({ ok: true })),
    disconnectMcpServer: vi.fn(async () => ({ ok: true })),
    getBackgroundTaskOutput: vi.fn(async () => ({ output: {} })),
    getBackgroundTasks: vi.fn(async () => ({ tasks: [] })),
    stopBackgroundTask: vi.fn(async () => ({ ok: true })),
    getWorkflowRuns: vi.fn(async () => ({ runs: [] })),
    stopWorkflowRun: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  } as unknown as MuseApiClient;
}

function stubWs(onEvent?: (h: (e: unknown) => void) => void): MuseWsClient {
  return {
    onEvent: vi.fn((h: (e: unknown) => void) => {
      onEvent?.(h);
      return () => {};
    }),
    onStatus: vi.fn(() => () => {}),
    connect: vi.fn(async () => {}),
    reconnectNow: vi.fn(async () => {}),
    close: vi.fn(),
  } as unknown as MuseWsClient;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

describe("hostBridge control plane", () => {
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

  it("clearChat calls api.clear and refreshes messages", async () => {
    const history = [{ id: "m1", role: "user" }];
    const api = stubApi({
      getMessages: vi.fn(async () => ({ messages: history })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({ command: "clearChat" });
    await flush();

    expect(api.clear).toHaveBeenCalledWith("sess-active");
    expect(api.getMessages).toHaveBeenCalledWith("sess-active");
    expect(messages).toContainEqual({
      command: "updateMessages",
      messages: history,
    });
  });

  it("forwards WS tasks:update as updateTasks", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = stubWs((h) => {
      handler = h;
    });
    const bridge = createHostBridge({
      api: stubApi(),
      ws,
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    const tasks = [{ id: "t1", subject: "do it", status: "pending" }];
    handler!({
      type: "tasks:update",
      sessionId: "sess-active",
      tasks,
    });
    await flush();

    expect(messages).toContainEqual({ command: "updateTasks", tasks });
  });

  it("requestSlashCommands returns host commands", async () => {
    const commands = [
      { id: "clear", name: "clear", description: "清空当前会话" },
    ];
    const api = stubApi({
      getSlashCommands: vi.fn(async () => ({ commands })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({ command: "requestSlashCommands" });
    await flush();

    expect(api.getSlashCommands).toHaveBeenCalledWith("sess-active");
    expect(messages).toContainEqual({
      command: "slashCommandsResponse",
      commands,
    });
  });

  it("setPermissionMode patches the session", async () => {
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({
      command: "setPermissionMode",
      mode: "bypassPermissions",
    });
    await flush();

    expect(api.patchSession).toHaveBeenCalledWith("sess-active", {
      permissionMode: "bypassPermissions",
    });
    expect(messages).toContainEqual({
      command: "updatePermissionMode",
      mode: "bypassPermissions",
    });
  });

  it("selecting a session applies its stored permissionMode", async () => {
    const bypassSession: MuseSession = {
      ...baseSession,
      id: "sess-b",
      title: "other",
      permissionMode: "bypassPermissions",
    };
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [baseSession, bypassSession],
        activeSessionId: "sess-active",
      })),
      selectSession: vi.fn(async (id: string) => ({
        session: id === "sess-b" ? bypassSession : baseSession,
      })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({
      command: "desktopSelectSession",
      sessionId: "sess-b",
    });
    await flush();

    expect(messages).toContainEqual({
      command: "updatePermissionMode",
      mode: "bypassPermissions",
    });
  });

  it("getWorkflowRuns fetches runs and posts updateWorkflowRuns", async () => {
    const runs = [
      {
        runId: "run-1",
        meta: { name: "audit-and-fix", description: "审查" },
        status: "running",
      },
    ];
    const api = stubApi({
      getWorkflowRuns: vi.fn(async () => ({ runs })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({ command: "getWorkflowRuns" });
    await flush();

    expect(api.getWorkflowRuns).toHaveBeenCalledWith("sess-active");
    expect(messages).toContainEqual({ command: "updateWorkflowRuns", runs });
  });

  it("getBackgroundTasks fetches tasks and posts updateBackgroundTasks", async () => {
    const tasks = [
      {
        id: "task_138_1",
        type: "workflow",
        status: "completed",
        description: "Workflow: Icap-ide-analysis",
      },
    ];
    const api = stubApi({
      getBackgroundTasks: vi.fn(async () => ({ tasks })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({ command: "getBackgroundTasks" });
    await flush();

    expect(api.getBackgroundTasks).toHaveBeenCalledWith("sess-active");
    expect(messages).toContainEqual({ command: "updateBackgroundTasks", tasks });
  });

  it("replaces background tasks when switching sessions", async () => {
    let emit: ((e: unknown) => void) | undefined;
    const api = stubApi({
      getBackgroundTasks: vi.fn(async (id: string) => ({
        tasks: id === "sess-b" ? [] : [{ id: "task-a", status: "running" }],
      })),
      getWorkflowRuns: vi.fn(async () => ({ runs: [] })),
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [
          baseSession,
          { ...baseSession, id: "sess-b", title: "other" },
        ],
        activeSessionId: "sess-active",
      })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs((h) => {
        emit = h;
      }),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    emit?.({
      type: "background-tasks:update",
      sessionId: "sess-active",
      tasks: [
        {
          id: "task_138_1",
          type: "workflow",
          status: "running",
          description: "Workflow: Icap-ide-analysis",
        },
      ],
    });
    await flush();
    messages.length = 0;

    bridge.postMessage({
      command: "desktopSelectSession",
      sessionId: "sess-b",
    });
    await flush();

    expect(api.getBackgroundTasks).toHaveBeenCalledWith("sess-b");
    expect(messages).toContainEqual({
      command: "updateBackgroundTasks",
      tasks: [],
    });
  });

  it("ignores workflow-runs:update from another session", async () => {
    let emit: ((e: unknown) => void) | undefined;
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [
          baseSession,
          { ...baseSession, id: "sess-b", title: "other" },
        ],
        activeSessionId: "sess-active",
      })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs((h) => {
        emit = h;
      }),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({
      command: "desktopSelectSession",
      sessionId: "sess-b",
    });
    await flush();
    messages.length = 0;

    emit?.({
      type: "workflow-runs:update",
      sessionId: "sess-active",
      runs: [{ runId: "from-a", status: "running" }],
    });
    await flush();

    expect(messages).not.toContainEqual(
      expect.objectContaining({
        command: "updateWorkflowRuns",
        runs: [{ runId: "from-a", status: "running" }],
      }),
    );
  });

  it("drops a stale getWorkflowRuns response after switching sessions", async () => {
    let releaseA: (() => void) | undefined;
    const api = stubApi({
      getWorkflowRuns: vi.fn(async (id: string) => {
        if (id === "sess-active") {
          await new Promise<void>((resolve) => {
            releaseA = resolve;
          });
          return { runs: [{ runId: "from-a", status: "running" }] };
        }
        return { runs: [] };
      }),
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [
          baseSession,
          { ...baseSession, id: "sess-b", title: "other" },
        ],
        activeSessionId: "sess-active",
      })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({ command: "getWorkflowRuns" });
    await flush();

    bridge.postMessage({
      command: "desktopSelectSession",
      sessionId: "sess-b",
    });
    await flush();
    messages.length = 0;

    releaseA?.();
    await flush();

    expect(messages).not.toContainEqual(
      expect.objectContaining({
        command: "updateWorkflowRuns",
        runs: [{ runId: "from-a", status: "running" }],
      }),
    );
  });

  it("stopBackgroundTask posts backgroundTaskStopped", async () => {
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({
      command: "stopBackgroundTask",
      taskId: "bt-1",
    });
    await flush();

    expect(api.stopBackgroundTask).toHaveBeenCalledWith("sess-active", "bt-1");
    expect(messages).toContainEqual({
      command: "backgroundTaskStopped",
      taskId: "bt-1",
    });
  });

  it("marks the app busy when a background task is running after the turn ends", async () => {
    let emit: ((e: unknown) => void) | undefined;
    const outer = { postMessage: vi.fn(), getState: () => null, setState: () => {} };
    const bridge = createHostBridge({
      api: stubApi(),
      ws: stubWs((h) => {
        emit = h;
      }),
      workdir: "/tmp",
      outer,
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    outer.postMessage.mockClear();

    emit?.({
      type: "session:status",
      sessionId: "sess-active",
      status: "idle",
    });
    emit?.({
      type: "background-tasks:update",
      sessionId: "sess-active",
      tasks: [{ id: "bt-1", type: "workflow", status: "running" }],
    });
    await flush();

    expect(outer.postMessage).toHaveBeenCalledWith({
      command: "desktopAgentBusy",
      busy: true,
    });
  });

  it("keeps the app busy for another session's running workflow", async () => {
    let emit: ((e: unknown) => void) | undefined;
    const outer = { postMessage: vi.fn(), getState: () => null, setState: () => {} };
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [
          baseSession,
          { ...baseSession, id: "sess-b", title: "other" },
        ],
        activeSessionId: "sess-active",
      })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs((h) => {
        emit = h;
      }),
      workdir: "/tmp",
      outer,
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();

    bridge.postMessage({
      command: "desktopSelectSession",
      sessionId: "sess-b",
    });
    await flush();
    outer.postMessage.mockClear();

    emit?.({
      type: "workflow-runs:update",
      sessionId: "sess-active",
      runs: [{ runId: "wf-1", status: "running" }],
    });
    await flush();

    expect(outer.postMessage).toHaveBeenCalledWith({
      command: "desktopAgentBusy",
      busy: true,
    });
  });

  it("clears busy when background work finishes", async () => {
    let emit: ((e: unknown) => void) | undefined;
    const outer = { postMessage: vi.fn(), getState: () => null, setState: () => {} };
    const bridge = createHostBridge({
      api: stubApi(),
      ws: stubWs((h) => {
        emit = h;
      }),
      workdir: "/tmp",
      outer,
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();

    emit?.({
      type: "background-tasks:update",
      sessionId: "sess-active",
      tasks: [{ id: "bt-1", type: "shell", status: "running" }],
    });
    await flush();
    outer.postMessage.mockClear();

    emit?.({
      type: "background-tasks:update",
      sessionId: "sess-active",
      tasks: [{ id: "bt-1", type: "shell", status: "completed" }],
    });
    await flush();

    expect(outer.postMessage).toHaveBeenCalledWith({
      command: "desktopAgentBusy",
      busy: false,
    });
  });
});
