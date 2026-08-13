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
    respondPermission: vi.fn(async () => ({ ok: true as const })),
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

  it("newSession does not create until first sendMessage", async () => {
    const created: MuseSession = {
      ...baseSession,
      id: "sess-created",
      title: "新对话",
      lastActiveAt: 1,
      createdAt: 1,
    };
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [],
        activeSessionId: undefined,
      })),
      createSession: vi.fn(async () => created),
      selectSession: vi.fn(async () => ({ session: created })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    vi.mocked(api.createSession).mockClear();

    bridge.postMessage({ command: "newSession" });
    await flush();
    expect(api.createSession).not.toHaveBeenCalled();
    expect(messages).toContainEqual({
      command: "updateMessages",
      messages: [],
    });

    bridge.postMessage({ command: "sendMessage", text: "first message" });
    await flush();
    expect(api.createSession).toHaveBeenCalledTimes(1);
    // New session clears workdir; server mints ~/.muse-work/projects/...
    expect(api.createSession).toHaveBeenCalledWith(undefined, undefined);
    expect(api.sendMessage).toHaveBeenCalledWith("sess-created", "first message");
  });

  it("desktopRenameSession patches title and updates tree", async () => {
    const api = stubApi({
      patchSession: vi.fn(async (id: string, patch: { title?: string }) => ({
        ...baseSession,
        id,
        title: patch.title ?? baseSession.title,
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
      command: "desktopRenameSession",
      sessionId: "sess-active",
      title: "Renamed",
    });
    await flush();

    expect(api.patchSession).toHaveBeenCalledWith("sess-active", {
      title: "Renamed",
    });
    const tree = messages
      .filter(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { command?: string }).command === "desktopSessionTree",
      )
      .at(-1) as
      | {
          groups?: Array<{
            sessions: Array<{ sessionId: string; title?: string }>;
          }>;
        }
      | undefined;
    const entry = tree?.groups
      ?.flatMap((g) => g.sessions)
      .find((s) => s.sessionId === "sess-active");
    expect(entry?.title).toBe("Renamed");
  });

  it("newSession with workdir preselects directory for createSession", async () => {
    const created: MuseSession = {
      ...baseSession,
      id: "sess-wd",
      title: "新对话",
      workdir: "/repo/beta",
    };
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [],
        activeSessionId: undefined,
      })),
      createSession: vi.fn(async () => created),
      selectSession: vi.fn(async () => ({ session: created })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    vi.mocked(api.createSession).mockClear();

    bridge.postMessage({ command: "newSession", workdir: "/repo/beta" });
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "desktopWorkdirState",
        workdir: "/repo/beta",
      }),
    );

    bridge.postMessage({ command: "sendMessage", text: "hi" });
    await flush();
    expect(api.createSession).toHaveBeenCalledWith("/repo/beta", undefined);
  });

  it("desktopCreateWorktree falls back to create+send (MVP)", async () => {
    const created: MuseSession = {
      ...baseSession,
      id: "sess-wt",
      title: "新对话",
    };
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [],
        activeSessionId: undefined,
      })),
      createSession: vi.fn(async () => created),
      selectSession: vi.fn(async () => ({ session: created })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    vi.mocked(api.createSession).mockClear();
    vi.mocked(api.sendMessage).mockClear();

    bridge.postMessage({ command: "newSession" });
    await flush();

    bridge.postMessage({
      command: "desktopCreateWorktree",
      workdir: "/tmp",
      baseBranch: "main",
      text: "via worktree path",
    });
    await flush();

    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(api.createSession).toHaveBeenCalledWith(undefined, undefined);
    expect(api.sendMessage).toHaveBeenCalledWith("sess-wt", "via worktree path");
  });

  it("ensureSession creates for new workdir instead of foreign activeSessionId", async () => {
    const foreign: MuseSession = {
      ...baseSession,
      id: "sess-foreign",
      workdir: "/old-project",
    };
    const created: MuseSession = {
      ...baseSession,
      id: "sess-new",
      workdir: "/new-project",
      title: "新对话",
    };
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [foreign],
        activeSessionId: "sess-foreign",
      })),
      createSession: vi.fn(async (workdir: string) => ({
        ...created,
        workdir,
      })),
      selectSession: vi.fn(async (id: string) => ({
        session: id === "sess-new" ? created : foreign,
      })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/old-project",
    });

    // Establish then clear sessionId via workdir change (as desktopSelectRecentWorkdir does).
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    expect(api.selectSession).toHaveBeenCalledWith("sess-foreign");
    vi.mocked(api.selectSession).mockClear();
    vi.mocked(api.createSession).mockClear();

    bridge.postMessage({
      command: "desktopSelectRecentWorkdir",
      path: "/new-project",
    });
    await flush();

    bridge.postMessage({ command: "sendMessage", text: "hello new workdir" });
    await flush();

    expect(api.createSession).toHaveBeenCalledWith("/new-project", undefined);
    expect(api.selectSession).toHaveBeenCalledWith("sess-new");
    expect(api.selectSession).not.toHaveBeenCalledWith("sess-foreign");
    expect(api.sendMessage).toHaveBeenCalledWith("sess-new", "hello new workdir");
  });

  it("mergeRuntimeFields prefers API status over sticky local running", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
    } as unknown as MuseWsClient;

    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [{ ...baseSession, status: "idle" as const }],
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

    handler!({
      type: "session:status",
      sessionId: "sess-active",
      status: "running",
    });
    await flush();

    const afterWs = messages
      .filter(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { command?: string }).command === "desktopSessionTree",
      )
      .at(-1) as
      | {
          groups?: Array<{
            sessions: Array<{ sessionId: string; running?: boolean }>;
          }>;
        }
      | undefined;
    expect(
      afterWs?.groups
        ?.flatMap((g) => g.sessions)
        .find((s) => s.sessionId === "sess-active")?.running,
    ).toBe(true);

    messages.length = 0;
    // pin triggers refreshTree; API still idle must clear sticky local running
    bridge.postMessage({
      command: "desktopTogglePinSession",
      sessionId: "sess-active",
      pinned: true,
    });
    await flush();

    const afterRefresh = messages.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { command?: string }).command === "desktopSessionTree",
    ) as
      | {
          groups?: Array<{
            sessions: Array<{ sessionId: string; running?: boolean }>;
          }>;
        }
      | undefined;
    expect(
      afterRefresh?.groups
        ?.flatMap((g) => g.sessions)
        .find((s) => s.sessionId === "sess-active")?.running,
    ).toBe(false);
  });

  it("non-focus loading keeps sidebar running without startStreaming", async () => {
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
      type: "loading",
      sessionId: "sess-other",
      loading: true,
    });
    await flush();

    expect(messages).not.toContainEqual({ command: "startStreaming" });
    const tree = messages.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { command?: string }).command === "desktopSessionTree",
    ) as
      | {
          groups?: Array<{
            sessions: Array<{ sessionId: string; running?: boolean }>;
          }>;
        }
      | undefined;
    expect(
      tree?.groups
        ?.flatMap((g) => g.sessions)
        .find((s) => s.sessionId === "sess-other")?.running,
    ).toBe(true);

    messages.length = 0;
    handler!({
      type: "loading",
      sessionId: "sess-other",
      loading: false,
    });
    await flush();
    const after = messages
      .filter(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { command?: string }).command === "desktopSessionTree",
      )
      .at(-1) as
      | {
          groups?: Array<{
            sessions: Array<{ sessionId: string; running?: boolean }>;
          }>;
        }
      | undefined;
    expect(
      after?.groups
        ?.flatMap((g) => g.sessions)
        .find((s) => s.sessionId === "sess-other")?.running,
    ).toBe(false);
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

  it("non-focus permission:request sets waitingConfirmation; select shows confirmation", async () => {
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
      respondPermission: vi.fn(async () => ({ ok: true as const })),
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
      type: "permission:request",
      sessionId: "sess-other",
      permissionId: "perm-bg",
      toolName: "Bash",
      description: "ls -la",
    });
    await flush();

    // Must not drop: sidebar waiting flag, but no confirmation UI yet (non-focus).
    expect(messages).not.toContainEqual(
      expect.objectContaining({ command: "showConfirmation" }),
    );
    const treeAfterPerm = messages
      .filter(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { command?: string }).command === "desktopSessionTree",
      )
      .at(-1) as
      | {
          groups?: Array<{
            sessions: Array<{
              sessionId: string;
              waitingConfirmation?: boolean;
              running?: boolean;
            }>;
          }>;
        }
      | undefined;
    const otherEntry = treeAfterPerm?.groups
      ?.flatMap((g) => g.sessions)
      .find((s) => s.sessionId === "sess-other");
    expect(otherEntry?.waitingConfirmation).toBe(true);
    expect(otherEntry?.running).toBe(true);

    // session:status idle must not wipe waiting while permission still pending
    messages.length = 0;
    handler!({
      type: "session:status",
      sessionId: "sess-other",
      status: "idle",
    });
    await flush();
    const treeAfterStatus = messages
      .filter(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { command?: string }).command === "desktopSessionTree",
      )
      .at(-1) as
      | {
          groups?: Array<{
            sessions: Array<{
              sessionId: string;
              waitingConfirmation?: boolean;
            }>;
          }>;
        }
      | undefined;
    expect(
      treeAfterStatus?.groups
        ?.flatMap((g) => g.sessions)
        .find((s) => s.sessionId === "sess-other")?.waitingConfirmation,
    ).toBe(true);

    messages.length = 0;
    bridge.postMessage({
      command: "desktopSelectSession",
      sessionId: "sess-other",
      workdir: "/tmp",
    });
    await flush();

    expect(messages).toContainEqual({
      command: "showConfirmation",
      confirmationId: "perm-bg",
      toolName: "Bash",
      confirmationType: "Bash 命令执行确认",
      toolInput: { command: "ls -la" },
      planContent: undefined,
      suggestedPrefix: undefined,
      hidePersistentOption: undefined,
      permissionMode: undefined,
    });
  });

  it("permission:request shows structured AskUserQuestion toolInput", async () => {
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

    const questions = [
      {
        question: "Pick?",
        header: "Pick",
        options: [{ label: "Yes" }, { label: "No" }],
      },
    ];
    handler!({
      type: "permission:request",
      sessionId: "sess-active",
      permissionId: "perm-ask",
      toolName: "AskUserQuestion",
      description: "AskUserQuestion: {}",
      toolInput: { questions },
      hidePersistentOption: true,
    });
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "showConfirmation",
        confirmationId: "perm-ask",
        toolName: "AskUserQuestion",
        confirmationType: "问题待回答",
        toolInput: { questions },
        hidePersistentOption: true,
      }),
    );
  });

  it("confirmationResponse forwards answers and respects reject", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const respondPermission = vi.fn(async () => ({ ok: true as const }));
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
    } as unknown as MuseWsClient;

    const bridge = createHostBridge({
      api: stubApi({ respondPermission }),
      ws,
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();

    handler!({
      type: "permission:request",
      sessionId: "sess-active",
      permissionId: "perm-1",
      toolName: "AskUserQuestion",
      description: "q",
      toolInput: { questions: [] },
    });
    await flush();

    bridge.postMessage({
      command: "confirmationResponse",
      confirmationId: "perm-1",
      approved: true,
      decision: {
        behavior: "allow",
        message: JSON.stringify({ Q: "A" }),
      },
    });
    await flush();

    expect(respondPermission).toHaveBeenCalledWith("sess-active", "perm-1", {
      behavior: "allow",
      message: JSON.stringify({ Q: "A" }),
      newPermissionMode: undefined,
      newPermissionRule: undefined,
    });

    respondPermission.mockClear();
    handler!({
      type: "permission:request",
      sessionId: "sess-active",
      permissionId: "perm-2",
      toolName: "Bash",
      description: "ls",
      toolInput: { command: "ls" },
    });
    await flush();

    bridge.postMessage({
      command: "confirmationResponse",
      confirmationId: "perm-2",
      approved: false,
    });
    await flush();

    expect(respondPermission).toHaveBeenCalledWith("sess-active", "perm-2", {
      behavior: "deny",
      message: "Denied by user",
      newPermissionMode: undefined,
      newPermissionRule: undefined,
    });
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

  it("forwards compaction; does not promote subagent events to top-level messages", async () => {
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

    messages.length = 0;
    handler!({
      type: "subagent:assistant:message",
      sessionId: "sess-active",
      subagentId: "sa1",
      messageId: "m9",
    });
    handler!({
      type: "subagent:message:delta",
      sessionId: "sess-active",
      subagentId: "sa1",
      messageId: "m9",
      text: "nested",
      stage: "streaming",
    });
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
    await flush();
    expect(messages).not.toContainEqual(
      expect.objectContaining({ command: "appendMessage" }),
    );
    expect(messages).not.toContainEqual(
      expect.objectContaining({ command: "updateStreamingContent" }),
    );
    expect(messages).not.toContainEqual(
      expect.objectContaining({ command: "updateToolBlock" }),
    );
  });

  it("setSessionModel patches session model and emits current session", async () => {
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
      command: "setSessionModel",
      model: "m2",
    });
    await flush();

    expect(api.patchSession).toHaveBeenCalledWith("sess-active", {
      model: "m2",
    });
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "updateCurrentSession",
        session: expect.objectContaining({
          id: "sess-active",
          model: "m2",
        }),
      }),
    );
  });
});
