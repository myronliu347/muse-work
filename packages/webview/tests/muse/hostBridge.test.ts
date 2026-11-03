/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildSidebarModel,
  createHostBridge,
  isAuthError,
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
    abortMessage: vi.fn(async () => ({ ok: true as const })),
    respondPermission: vi.fn(async () => ({ ok: true as const })),
    getBackgroundTasks: vi.fn(async () => ({ tasks: [] })),
    getWorkflowRuns: vi.fn(async () => ({ runs: [] })),
    ...overrides,
  } as unknown as MuseApiClient;
}

function stubWs(): MuseWsClient {
  return {
    onEvent: vi.fn(),
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

async function flushUntil(
  predicate: () => boolean,
  attempts = 40,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    await Promise.resolve();
    if (predicate()) return;
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

  it("maps worktree metadata including worktreeRepoRoot into entries", () => {
    const recent: MuseSession[] = [
      {
        ...baseSession,
        id: "wt1",
        title: "WT",
        workdir: "/Users/me/.muse-work/worktrees/a",
        worktreeName: "a",
        worktreeBranch: "worktree-a",
        worktreeRepoRoot: "/repo",
      },
    ];
    const groups = buildSidebarModel({ pinned: [], recent });
    const session = groups[1]?.sessions[0];
    expect(session?.hasWorktree).toBe(true);
    expect(session?.worktreeName).toBe("a");
    expect(session?.worktreeBranch).toBe("worktree-a");
    expect(session?.worktreeRepoRoot).toBe("/repo");
  });
});

describe("createHostBridge desktop workdir bootstrap", () => {
  const messages: unknown[] = [];
  let nativeDispatch: typeof window.dispatchEvent;

  beforeEach(() => {
    messages.length = 0;
    nativeDispatch = window.dispatchEvent.bind(window);
    vi.spyOn(window, "dispatchEvent").mockImplementation((event) => {
      if (event instanceof MessageEvent) {
        messages.push(event.data);
        // Still deliver inbound host events (e.g. desktopWorktreeCreated) to
        // bridge listeners; outbound postToWebview events only need capture.
        const data = event.data as { command?: string } | null;
        if (
          data &&
          typeof data === "object" &&
          (data.command === "desktopWorktreeCreated" ||
            data.command === "desktopWorkdirState")
        ) {
          return nativeDispatch(event);
        }
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

  it("desktopSelectFiles is forwarded to outer (Electron file pick)", () => {
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
    bridge.postMessage({ command: "desktopSelectFiles" });
    expect(outer.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectFiles",
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

  it("desktopReady carries issueGroups into the desktopSessionTree message", async () => {
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [baseSession],
        activeSessionId: "sess-active",
        issueGroups: [
          {
            issueId: "issue-1",
            title: "设计评审",
            priority: "p1",
            status: "planning",
            items: [{ id: "c1", content: "写方案", status: "pending" as const }],
            sessions: [
              { ...baseSession, id: "sess-plan", title: "设计评审" },
              { ...baseSession, id: "sess-exec", title: "执行" },
            ],
          },
        ],
      })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "desktopSessionTree",
        issueGroups: [
          {
            issueId: "issue-1",
            title: "设计评审",
            priority: "p1",
            status: "planning",
            items: [{ id: "c1", content: "写方案", status: "pending" }],
            sessions: [
              expect.objectContaining({ sessionId: "sess-plan" }),
              expect.objectContaining({ sessionId: "sess-exec" }),
            ],
          },
        ],
      }),
    );
  });

  it("desktopRefreshSessionTree 重新拉 grouped 并广播新会话树（issue 完成/取消后刷新侧栏）", async () => {
    let calls = 0;
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => {
        calls++;
        return {
          pinned: [],
          recent: calls === 1 ? [baseSession] : [],
          activeSessionId: "sess-active",
          issueGroups:
            calls === 1
              ? [
                  {
                    issueId: "issue-1",
                    title: "设计评审",
                    priority: "p1",
                    status: "planning",
                    items: [],
                    sessions: [
                      { ...baseSession, id: "sess-plan", title: "设计评审" },
                    ],
                  },
                ]
              : [],
        };
      }),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flushUntil(() => calls >= 1);
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "desktopSessionTree",
        issueGroups: [expect.objectContaining({ issueId: "issue-1" })],
      }),
    );

    bridge.postMessage({ command: "desktopRefreshSessionTree" });
    await flushUntil(() => calls >= 2);
    expect(calls).toBe(2);
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "desktopSessionTree",
        issueGroups: [],
        groups: expect.arrayContaining([
          expect.objectContaining({ workdir: "recent", sessions: [] }),
        ]),
      }),
    );
  });

  it("desktopRefreshSessionTree removes the worktree when an issue moves to closed", async () => {
    const wtSession: MuseSession = {
      ...baseSession,
      id: "sess-plan",
      workdir: "/Users/me/.muse-work/worktrees/login-fix",
      title: "登录",
      worktreeName: "login-fix",
      worktreeBranch: "worktree-login-fix",
      worktreeRepoRoot: "/repo",
    };
    const group = {
      issueId: "issue-wt",
      title: "登录",
      priority: "p1",
      status: "planning",
      items: [] as Array<{ id: string; content: string; status: "pending" }>,
      sessions: [wtSession],
    };
    let calls = 0;
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => {
        calls++;
        if (calls === 1) {
          return {
            pinned: [],
            recent: [],
            issueGroups: [group],
            closedIssueGroups: [],
          };
        }
        return {
          pinned: [],
          recent: [],
          issueGroups: [],
          closedIssueGroups: [{ ...group, status: "completed" }],
        };
      }),
    });
    const outer = { postMessage: vi.fn(), getState: () => null, setState: () => {} };
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
      outer,
    });

    bridge.postMessage({ command: "desktopReady" });
    await flushUntil(() => calls >= 1);
    vi.mocked(outer.postMessage).mockClear();

    bridge.postMessage({ command: "desktopRefreshSessionTree" });
    await flushUntil(() => calls >= 2);

    expect(outer.postMessage).toHaveBeenCalledWith({
      command: "desktopRemoveWorktree",
      path: "/Users/me/.muse-work/worktrees/login-fix",
      branch: "worktree-login-fix",
      repoRoot: "/repo",
    });
  });

  it("issue:changed WS posts issue:changed to webview (all panes)", async () => {
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

    handler!({ type: "issue:changed", sessionId: "*" });
    await flush();

    expect(messages).toContainEqual({ command: "issue:changed" });
  });

  it("automation:changed WS posts automation:changed to webview (all panes)", async () => {
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

    handler!({ type: "automation:changed", sessionId: "*" });
    await flush();

    expect(messages).toContainEqual({ command: "automation:changed" });
  });

  it("desktopReady loads the session tree even when WS connect fails", async () => {
    const ws = stubWs();
    vi.mocked(ws.connect).mockRejectedValue(new Error("ws down"));
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws,
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();

    expect(api.listSessionsGrouped).toHaveBeenCalled();
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "desktopSessionTree",
        groups: expect.arrayContaining([
          expect.objectContaining({
            workdir: "recent",
            sessions: expect.arrayContaining([
              expect.objectContaining({ sessionId: "sess-active" }),
            ]),
          }),
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

  it("restores sidebar running when switching back to a busy session", async () => {
    const api = stubApi({
      getRuntimeState: vi.fn(async () => ({
        loading: true,
        queuedMessages: [],
      })),
      // API status says idle, but the SDK runtime snapshot says loading — the
      // runtime snapshot must win so the sidebar spinner is restored.
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [{ ...baseSession, id: "sess-b", status: "idle" as const }],
        activeSessionId: "sess-active",
      })),
      selectSession: vi.fn(async (id) => ({
        session: { ...baseSession, id, status: "running" as const },
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

    // Main pane streaming state is restored from the runtime snapshot.
    expect(messages).toContainEqual({ command: "startStreaming" });

    // Sidebar tree must keep running: true for the busy session.
    const tree = messages
      .filter(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { command?: string }).command === "desktopSessionTree",
      )
      .at(-1) as
      | {
          groups?: Array<{ sessions: Array<{ sessionId?: string; running?: boolean }> }>;
        }
      | undefined;
    const allSessions = (tree?.groups ?? []).flatMap(
      (g) => g.sessions ?? [],
    );
    expect(
      allSessions.find((s) => s.sessionId === "sess-b")?.running,
    ).toBe(true);
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
    vi.mocked(api.getAuthStatus).mockClear();

    bridge.postMessage({ command: "newSession" });
    await flush();
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.getAuthStatus).toHaveBeenCalled();
    expect(messages).toContainEqual({
      command: "updateMessages",
      messages: [],
    });

    bridge.postMessage({ command: "sendMessage", text: "first message" });
    await flush();
    expect(api.createSession).toHaveBeenCalledTimes(1);
    // New session clears workdir; server mints ~/.muse-work/projects/...
    expect(api.createSession).toHaveBeenCalledWith(undefined, {
      permissionMode: "acceptEdits",
    });
    expect(api.sendMessage).toHaveBeenCalledWith(
      "sess-created",
      "first message",
      undefined,
    );
  });

  it("draft newSession does not reuse the previous workdir after it is cleared", async () => {
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
      getSkills: vi.fn(async () => ({
        skills: [{ name: "recent-skill", description: "from recent", userInvocable: true }],
      })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/repo/a",
    });

    bridge.postMessage({ command: "newSession", workdir: "/repo/recent" });
    await flush();
    bridge.postMessage({ command: "newSession" });
    await flush();
    vi.mocked(api.getSkills).mockClear();
    vi.mocked(api.createSession).mockClear();
    bridge.postMessage({ command: "requestSlashCommands" });
    await flush();
    bridge.postMessage({ command: "sendMessage", text: "first message" });
    await flush();

    expect(api.getSkills).not.toHaveBeenCalled();
    expect(api.createSession).toHaveBeenCalledWith(undefined, {
      permissionMode: "acceptEdits",
    });
  });

  it("requestSlashCommands during draft newSession loads skills by workdir", async () => {
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [],
        activeSessionId: undefined,
      })),
      getSkills: vi.fn(async () => ({
        skills: [{ name: "my-skill", description: "demo", userInvocable: true }],
      })),
    });
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/repo/a",
    });

    bridge.postMessage({ command: "newSession", workdir: "/repo/a" });
    await flush();
    vi.mocked(api.getSkills).mockClear();
    bridge.postMessage({ command: "requestSlashCommands" });
    await flush();

    expect(api.getSkills).toHaveBeenCalledWith("/repo/a");
    expect(messages).toContainEqual({
      command: "slashCommandsResponse",
      commands: [{ id: "my-skill", name: "my-skill", description: "demo" }],
    });
  });

  it("newSession resets permission mode to acceptEdits", async () => {
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({ command: "newSession" });
    await flush();

    expect(messages).toContainEqual({
      command: "updatePermissionMode",
      mode: "acceptEdits",
    });
  });

  it("draft bypassPermissions is passed to createSession on first send", async () => {
    const created: MuseSession = {
      ...baseSession,
      id: "sess-created",
      title: "新对话",
      lastActiveAt: 1,
      createdAt: 1,
      permissionMode: "bypassPermissions",
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
    vi.mocked(api.patchSession).mockClear();

    bridge.postMessage({
      command: "setPermissionMode",
      mode: "bypassPermissions",
    });
    await flush();

    expect(api.patchSession).not.toHaveBeenCalled();
    expect(messages).toContainEqual({
      command: "updatePermissionMode",
      mode: "bypassPermissions",
    });

    bridge.postMessage({ command: "sendMessage", text: "first message" });
    await flush();

    expect(api.createSession).toHaveBeenCalledWith(undefined, {
      permissionMode: "bypassPermissions",
    });
  });

  it("emits default model on a new draft but does not pin it to createSession", async () => {
    const created: MuseSession = {
      ...baseSession,
      id: "sess-created",
      workdir: "/Users/demo/.muse-work/projects/x",
    };
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [],
        issueGroups: [],
        closedIssueGroups: [],
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
    await flushUntil(() =>
      messages.some(
        (m) =>
          (m as { command?: string }).command === "updateCurrentSession",
      ),
    );

    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "updateCurrentSession",
        session: expect.objectContaining({
          id: "__draft__",
          model: "deepseek-flash",
        }),
      }),
    );

    messages.length = 0;
    vi.mocked(api.createSession).mockClear();
    bridge.postMessage({ command: "sendMessage", text: "hi" });
    await flush();
    // 未手动选模型时不传 model，让 server 回落 agent.model（勿用默认值覆盖）
    expect(api.createSession).toHaveBeenCalledWith(undefined, {
      permissionMode: "acceptEdits",
    });
  });

  it("first send keeps session model without auto-PATCHing a title", async () => {
    const created: MuseSession = {
      ...baseSession,
      id: "sess-created",
      title: "新对话",
      model: "deepseek-v4-flash",
      workdir: "/Users/demo/.muse-work/projects/x",
    };
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [],
        activeSessionId: undefined,
      })),
      createSession: vi.fn(async () => created),
      selectSession: vi.fn(async () => ({ session: created })),
      patchSession: vi.fn(async (id: string, patch: Partial<MuseSession>) => ({
        ...created,
        id,
        ...patch,
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

    bridge.postMessage({ command: "sendMessage", text: "hello world" });
    await flush();

    const currentSessions = messages.filter(
      (m): m is { command: string; session: { model?: string; title?: string } } =>
        Boolean(
          m &&
            typeof m === "object" &&
            (m as { command?: string }).command === "updateCurrentSession",
        ),
    );
    expect(currentSessions.length).toBeGreaterThan(0);
    // Host no longer PATCHes the truncated title; the server owns the title and
    // replaces it with an AI summary via the session:titled broadcast.
    expect(api.patchSession).not.toHaveBeenCalled();
    expect(currentSessions.at(-1)?.session).toEqual(
      expect.objectContaining({
        id: "sess-created",
        model: "deepseek-v4-flash",
        title: "新对话",
      }),
    );
  });

  it("abortMessage calls API and ends streaming", async () => {
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({ command: "abortMessage" });
    await flush();

    expect(api.abortMessage).toHaveBeenCalledWith("sess-active");
    expect(messages).toContainEqual({ command: "endStreaming" });
  });

  it("aborts the requested issue session without ending another pane stream", async () => {
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({ command: "abortMessage", sessionId: "plan-radii" });
    await flush();

    expect(api.abortMessage).toHaveBeenCalledWith("plan-radii");
    expect(messages).not.toContainEqual({ command: "endStreaming" });
  });

  it("deltas already in flight after an abort do not re-ignite streaming", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
    } as unknown as MuseWsClient;
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws,
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();

    // Normal streaming in the active session.
    handler!({
      type: "message:delta",
      sessionId: "sess-active",
      messageId: "m1",
      text: "hello",
      stage: "streaming",
    });
    handler!({
      type: "message:delta",
      sessionId: "sess-active",
      messageId: "m1",
      text: " world",
      stage: "streaming",
    });
    await flush();
    expect(messages).toContainEqual({ command: "startStreaming" });

    messages.length = 0;
    bridge.postMessage({ command: "abortMessage" });
    await flush();
    expect(api.abortMessage).toHaveBeenCalledWith("sess-active");
    expect(messages).toContainEqual({ command: "endStreaming" });

    messages.length = 0;
    // A delta the server sent just before processing the abort arrives late.
    // Regression: it used to re-emit startStreaming (stop button flickers back)
    // and append a duplicate assistant message (knownAssistantIds was cleared).
    handler!({
      type: "message:delta",
      sessionId: "sess-active",
      messageId: "m1",
      text: " tail",
      stage: "streaming",
    });
    await flush();

    const commands = messages
      .map((m) => (m as { command?: string })?.command)
      .filter(Boolean);
    expect(commands).not.toContain("startStreaming");
    expect(commands).not.toContain("appendMessage");
  });

  it("reasoning finalize after an abort still reaches the UI to stop the timer", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
    } as unknown as MuseWsClient;
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws,
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({ command: "abortMessage" });
    await flush();

    messages.length = 0;
    handler!({
      type: "reasoning:delta",
      sessionId: "sess-active",
      messageId: "m1",
      text: "",
      stage: "end",
    });
    await flush();

    expect(messages).toContainEqual({
      command: "updateStreamingReasoning",
      messageId: "m1",
      chunk: "",
      stage: "end",
    });
    const commands = messages
      .map((m) => (m as { command?: string })?.command)
      .filter(Boolean);
    expect(commands).not.toContain("startStreaming");

    messages.length = 0;
    handler!({
      type: "reasoning:delta",
      sessionId: "sess-active",
      messageId: "m1",
      text: "late",
      stage: "streaming",
    });
    await flush();
    expect(messages).toEqual([]);
  });

  it("tool:update finalize after an abort still reaches the UI to stop the shimmer", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
    } as unknown as MuseWsClient;
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws,
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    bridge.postMessage({ command: "abortMessage" });
    await flush();

    messages.length = 0;
    // SDK pushes the aborted tool block's finalize (stage: end + error) after
    // the abort. Regression: it was dropped while `aborted` was true, leaving
    // the Agent tool row shimmering forever.
    handler!({
      type: "tool:update",
      sessionId: "sess-active",
      params: {
        messageId: "m1",
        name: "Agent",
        stage: "end",
        success: false,
        error: "Tool execution was aborted",
      },
    });
    await flush();

    expect(messages).toContainEqual({
      command: "updateToolBlock",
      params: {
        messageId: "m1",
        name: "Agent",
        stage: "end",
        success: false,
        error: "Tool execution was aborted",
      },
    });
    const commands = messages
      .map((m) => (m as { command?: string })?.command)
      .filter(Boolean);
    expect(commands).not.toContain("startStreaming");
  });

  it("sendMessage clears the aborted-turn guard so the next turn streams", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
    } as unknown as MuseWsClient;
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws,
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();

    handler!({
      type: "message:delta",
      sessionId: "sess-active",
      messageId: "m1",
      text: "hello",
      stage: "streaming",
    });
    await flush();
    messages.length = 0;

    bridge.postMessage({ command: "abortMessage" });
    await flush();
    messages.length = 0;

    // A new user message starts a new turn; its deltas must stream again.
    bridge.postMessage({ command: "sendMessage", text: "again" });
    await flush();
    messages.length = 0;

    handler!({
      type: "message:delta",
      sessionId: "sess-active",
      messageId: "m2",
      text: "fresh",
      stage: "streaming",
    });
    await flush();

    expect(messages).toContainEqual({
      command: "appendMessage",
      message: expect.objectContaining({ id: "m2" }),
    });
    expect(messages).toContainEqual({
      command: "updateStreamingContent",
      messageId: "m2",
      chunk: "fresh",
      stage: "streaming",
    });
  });

  it("sendMessage forwards base64 images to the API", async () => {
    const api = stubApi();
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();

    const images = [
      {
        data: "data:image/png;base64,aaaa",
        mediaType: "image/png",
      },
    ];
    bridge.postMessage({
      command: "sendMessage",
      text: "look",
      images,
    });
    await flush();

    expect(api.sendMessage).toHaveBeenCalledWith("sess-active", "look", images);
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
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "updateCurrentSession",
        session: expect.objectContaining({
          id: "sess-active",
          title: "Renamed",
        }),
      }),
    );
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
    expect(api.createSession).toHaveBeenCalledWith("/repo/beta", {
      permissionMode: "acceptEdits",
    });
  });

  it("newSession with a worktree workdir keeps it out of recents", async () => {
    const bridge = createHostBridge({
      api: stubApi(),
      ws: stubWs(),
      workdir: "/tmp",
    });

    bridge.postMessage({ command: "desktopReady" });
    await flush();

    bridge.postMessage({
      command: "newSession",
      workdir: "/Users/me/.muse-work/worktrees/feat-x",
    });
    await flush();

    expect(messages).toContainEqual({
      command: "desktopWorkdirState",
      workdir: "/Users/me/.muse-work/worktrees/feat-x",
      recentWorkdirs: [],
      host: "local",
    });
  });

  it("server-minted ~/.muse-work workdir stays out of recents", async () => {
    const created: MuseSession = {
      ...baseSession,
      id: "sess-mint",
      title: "新对话",
      workdir: "/Users/me/.muse-work/projects/20260818-abc123",
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
    bridge.postMessage({ command: "sendMessage", text: "hi" });
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "desktopWorkdirState",
        workdir: "/Users/me/.muse-work/projects/20260818-abc123",
        recentWorkdirs: [],
      }),
    );
  });

  it("server-minted ~/.dev-muse-work workdir also stays out of recents", async () => {
    const created: MuseSession = {
      ...baseSession,
      id: "sess-mint",
      title: "新对话",
      workdir: "/Users/me/.dev-muse-work/projects/20260818-abc123",
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
    bridge.postMessage({ command: "sendMessage", text: "hi" });
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "desktopWorkdirState",
        workdir: "/Users/me/.dev-muse-work/projects/20260818-abc123",
        recentWorkdirs: [],
      }),
    );
  });

  it("desktopCreateWorktree creates session in worktree then sends", async () => {
    const created: MuseSession = {
      ...baseSession,
      id: "sess-wt",
      title: "新对话",
      workdir: "/tmp/.muse-work/worktrees/gentle-pike-147",
      worktreeName: "gentle-pike-147",
      worktreeBranch: "worktree-gentle-pike-147",
      baseBranch: "main",
      worktreeRepoRoot: "/tmp",
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
    const outer = {
      postMessage: vi.fn((msg: Record<string, unknown>) => {
        if (msg.command === "desktopCreateWorktree") {
          // Match Electron→webview delivery (async relative to the request).
          queueMicrotask(() => {
            window.dispatchEvent(
              new MessageEvent("message", {
                data: {
                  command: "desktopWorktreeCreated",
                  requestId: msg.requestId,
                  name: "gentle-pike-147",
                  path: "/tmp/.muse-work/worktrees/gentle-pike-147",
                  branch: "worktree-gentle-pike-147",
                  baseBranch: "main",
                  repoRoot: "/tmp",
                },
              }),
            );
          });
        }
      }),
      getState: () => null,
      setState: () => {},
    };
    const bridge = createHostBridge({
      api,
      ws: stubWs(),
      workdir: "/tmp",
      outer,
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
    await flushUntil(() => vi.mocked(api.sendMessage).mock.calls.length > 0);

    expect(outer.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopCreateWorktree",
        workdir: "/tmp",
        baseBranch: "main",
      }),
    );
    // The bridge must forward exactly ONE requestId-tagged create to the host.
    // Mirroring the raw message on top of handleDesktopCreateWorktree's tagged
    // forward made the main process create TWO worktrees per send.
    const createCalls = outer.postMessage.mock.calls.filter(
      ([m]: [Record<string, unknown>]) => m.command === "desktopCreateWorktree",
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.[0]?.requestId).toBeTruthy();
    expect(api.createSession).toHaveBeenCalledWith(
      "/tmp/.muse-work/worktrees/gentle-pike-147",
      expect.objectContaining({
        worktreeName: "gentle-pike-147",
        worktreeBranch: "worktree-gentle-pike-147",
        baseBranch: "main",
        worktreeRepoRoot: "/tmp",
      }),
    );
    expect(api.sendMessage).toHaveBeenCalledWith(
      "sess-wt",
      "via worktree path",
      undefined,
    );
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

    expect(api.createSession).toHaveBeenCalledWith("/new-project", {
      permissionMode: "acceptEdits",
    });
    expect(api.selectSession).toHaveBeenCalledWith("sess-new");
    expect(api.selectSession).not.toHaveBeenCalledWith("sess-foreign");
    expect(api.sendMessage).toHaveBeenCalledWith(
      "sess-new",
      "hello new workdir",
      undefined,
    );
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

  it("session:titled broadcast updates the tree and current session title", async () => {
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

    bridge.postMessage({
      command: "desktopSelectSession",
      sessionId: "sess-active",
      workdir: "/tmp",
    });
    await flush();
    messages.length = 0;

    handler!({
      type: "session:titled",
      sessionId: "sess-active",
      title: "修复登录页白屏问题",
    });
    await flush();

    const tree = messages
      .filter(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { command?: string }).command === "desktopSessionTree",
      )
      .at(-1) as
      | {
          groups?: Array<{ sessions: Array<{ sessionId: string; title?: string }> }>;
        }
      | undefined;
    expect(
      tree?.groups
        ?.flatMap((g) => g.sessions)
        .find((s) => s.sessionId === "sess-active")?.title,
    ).toBe("修复登录页白屏问题");

    const current = messages.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { command?: string }).command === "updateCurrentSession",
    ) as { session?: { title?: string } } | undefined;
    expect(current?.session?.title).toBe("修复登录页白屏问题");
  });

  it("session:titled broadcast does not touch the current session when ids differ", async () => {
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
      type: "session:titled",
      sessionId: "sess-other",
      title: "另一个会话",
    });
    await flush();

    const current = messages.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { command?: string }).command === "updateCurrentSession",
    );
    expect(current).toBeUndefined();
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
      suggestedPrefix: undefined,
      hidePersistentOption: undefined,
      permissionMode: undefined,
    });
  });

  it("permission:resolved closes the confirmation the assistant already answered", async () => {
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
      type: "permission:request",
      sessionId: "sess-active",
      permissionId: "perm-done",
      toolName: "Bash",
      description: "git status",
    });
    await flush();
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "showConfirmation",
        confirmationId: "perm-done",
      }),
    );

    messages.length = 0;
    handler!({
      type: "permission:resolved",
      sessionId: "sess-active",
      permissionId: "perm-done",
    });
    await flush();
    expect(messages).toContainEqual({
      command: "hideConfirmation",
      confirmationId: "perm-done",
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
            sessions: Array<{ sessionId: string; waitingConfirmation?: boolean }>;
          }>;
        }
      | undefined;
    expect(
      tree?.groups
        ?.flatMap((g) => g.sessions)
        .find((s) => s.sessionId === "sess-active")?.waitingConfirmation,
    ).toBe(false);
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

  it("surfaces error:block without ending the in-flight turn", async () => {
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

    handler!({ type: "loading", sessionId: "sess-active", loading: true });
    expect(messages).toContainEqual({ command: "startStreaming" });
    messages.length = 0;

    const compactError =
      "Failed to compact conversation history: Compaction failed: the model produced no summary output.";
    handler!({
      type: "error:block",
      sessionId: "sess-active",
      error: compactError,
    });
    await flush();

    expect(messages).toContainEqual({
      command: "updateErrorBlock",
      error: compactError,
    });
    expect(messages).toContainEqual({
      command: "compactionStateChange",
      isCompacting: false,
    });
    expect(messages).not.toContainEqual({ command: "endStreaming" });
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
    handler!({
      type: "subagent:messages",
      sessionId: "sess-active",
      subagentId: "sa1",
      messages: [
        {
          id: "m9",
          role: "assistant",
          timestamp: "0",
          blocks: [{ type: "text", content: "snapshot" }],
        },
      ],
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
    expect(messages).toContainEqual({
      command: "appendSubagentMessage",
      subagentId: "sa1",
      messageId: "m9",
    });
    expect(messages).toContainEqual({
      command: "updateSubagentStreamingContent",
      subagentId: "sa1",
      messageId: "m9",
      chunk: "nested",
      stage: "streaming",
    });
    expect(messages).toContainEqual({
      command: "updateSubagentToolBlock",
      subagentId: "sa1",
      params: {
        messageId: "m9",
        id: "t1",
        name: "Read",
        stage: "end",
        success: true,
      },
    });
    expect(messages).toContainEqual({
      command: "setSubagentMessages",
      subagentId: "sa1",
      messages: [
        {
          id: "m9",
          role: "assistant",
          timestamp: "0",
          blocks: [{ type: "text", content: "snapshot" }],
        },
      ],
    });
  });

  it("does not leak the compaction hint to other sessions; restores it when switching back", async () => {
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
        recent: [
          baseSession,
          { ...baseSession, id: "sess-b", title: "B" },
        ],
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
      type: "compaction:state",
      sessionId: "sess-active",
      isCompacting: true,
    });
    expect(messages).toContainEqual({
      command: "compactionStateChange",
      isCompacting: true,
    });
    messages.length = 0;

    bridge.postMessage({
      command: "desktopSelectSession",
      sessionId: "sess-b",
      workdir: "/tmp",
    });
    await flush();
    expect(messages).toContainEqual({
      command: "compactionStateChange",
      isCompacting: false,
    });
    messages.length = 0;

    // Compact finishes on the background session — must not re-show the hint.
    handler!({
      type: "compaction:state",
      sessionId: "sess-active",
      isCompacting: false,
    });
    expect(messages).not.toContainEqual({
      command: "compactionStateChange",
      isCompacting: true,
    });
    messages.length = 0;

    handler!({
      type: "compaction:state",
      sessionId: "sess-active",
      isCompacting: true,
    });
    expect(messages).not.toContainEqual(
      expect.objectContaining({ command: "compactionStateChange" }),
    );
    messages.length = 0;

    bridge.postMessage({
      command: "desktopSelectSession",
      sessionId: "sess-active",
      workdir: "/tmp",
    });
    await flush();
    expect(messages).toContainEqual({
      command: "compactionStateChange",
      isCompacting: true,
    });
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

describe("createHostBridge reconnect", () => {
  const messages: unknown[] = [];
  let nativeDispatch: typeof window.dispatchEvent;

  beforeEach(() => {
    messages.length = 0;
    nativeDispatch = window.dispatchEvent.bind(window);
    vi.spyOn(window, "dispatchEvent").mockImplementation((event) => {
      if (event instanceof MessageEvent) {
        messages.push(event.data);
        const data = event.data as { command?: string } | null;
        if (
          data &&
          typeof data === "object" &&
          (data.command === "desktopWorkdirState" ||
            data.command === "museServerLifecycle")
        ) {
          return nativeDispatch(event);
        }
      }
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubWsStatus(): {
    ws: MuseWsClient;
    emitStatus: (status: "open" | "closed" | "reconnecting") => void;
  } {
    let statusHandler:
      | ((status: "open" | "closed" | "reconnecting") => void)
      | undefined;
    const ws = {
      onEvent: vi.fn(() => () => {}),
      onStatus: vi.fn((h: (status: "open" | "closed" | "reconnecting") => void) => {
        statusHandler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
      reconnectNow: vi.fn(async () => {}),
      close: vi.fn(),
    } as unknown as MuseWsClient;
    return {
      ws,
      emitStatus: (status) => statusHandler?.(status),
    };
  }

  it("reloads messages and ends streaming when WS reopens on an idle session", async () => {
    const { ws, emitStatus } = stubWsStatus();
    const api = stubApi();
    const bridge = createHostBridge({ api, ws, workdir: "/tmp" });

    bridge.postMessage({ command: "desktopReady" });
    await flush();
    expect(api.getMessages).toHaveBeenCalledTimes(1);

    emitStatus("open");
    await flush();
    expect(api.getMessages).toHaveBeenCalledTimes(1);
    expect(messages).not.toContainEqual(
      expect.objectContaining({
        command: "showToast",
        toast: expect.objectContaining({ id: "muse-server" }),
      }),
    );

    messages.length = 0;
    emitStatus("closed");
    await flush();
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "showToast",
        toast: expect.objectContaining({
          id: "muse-server",
          message: "连接已断开，正在重连…",
        }),
      }),
    );

    vi.mocked(api.getMessages).mockClear();
    vi.mocked(api.listSessionsGrouped).mockClear();
    messages.length = 0;
    emitStatus("open");
    await flush();

    expect(api.getMessages).toHaveBeenCalledWith("sess-active");
    expect(api.listSessionsGrouped).toHaveBeenCalled();
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "showToast",
        toast: expect.objectContaining({
          id: "muse-server",
          message: "已重新连接",
        }),
      }),
    );
    expect(messages).toContainEqual({ command: "endStreaming" });
  });

  it("keeps streaming when reconnected session is still running", async () => {
    const { ws, emitStatus } = stubWsStatus();
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [{ ...baseSession, status: "running" as const }],
        activeSessionId: "sess-active",
      })),
    });
    const bridge = createHostBridge({ api, ws, workdir: "/tmp" });
    bridge.postMessage({ command: "desktopReady" });
    await flush();

    emitStatus("open");
    messages.length = 0;
    emitStatus("closed");
    emitStatus("open");
    await flush();

    expect(messages).not.toContainEqual({ command: "endStreaming" });
    expect(api.getMessages).toHaveBeenCalledWith("sess-active");
  });

  it("keeps streaming when reconnected issue planning session is still running", async () => {
    const planningSession = {
      ...baseSession,
      id: "sess-plan",
      title: "修登录 · 规划",
      status: "running" as const,
    };
    const { ws, emitStatus } = stubWsStatus();
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [],
        activeSessionId: "sess-plan",
        issueGroups: [
          {
            issueId: "issue-1",
            title: "修登录",
            priority: "p1",
            status: "planning",
            items: [],
            sessions: [planningSession],
          },
        ],
      })),
      selectSession: vi.fn(async (id: string) => ({
        session: { ...planningSession, id },
      })),
    });
    const bridge = createHostBridge({ api, ws, workdir: "/tmp" });
    bridge.postMessage({ command: "desktopReady" });
    await flush();

    emitStatus("open");
    messages.length = 0;
    emitStatus("closed");
    emitStatus("open");
    await flush();

    expect(messages).not.toContainEqual({ command: "endStreaming" });
    expect(api.getMessages).toHaveBeenCalledWith("sess-plan");
  });

  it("shows a persistent toast and stops streaming when the local server is dead", async () => {
    const { ws } = stubWsStatus();
    const api = stubApi();
    const bridge = createHostBridge({ api, ws, workdir: "/tmp" });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    nativeDispatch(
      new MessageEvent("message", {
        data: { command: "museServerLifecycle", state: "dead" },
      }),
    );
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "showToast",
        toast: expect.objectContaining({
          id: "muse-server",
          message: "本地服务无法恢复，请重启应用",
        }),
      }),
    );
    expect(messages).toContainEqual({ command: "endStreaming" });
  });

  it("reconnects immediately when desktop reports the server is ready again", async () => {
    const { ws } = stubWsStatus();
    const api = stubApi();
    const bridge = createHostBridge({ api, ws, workdir: "/tmp" });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    vi.mocked(api.getMessages).mockClear();
    messages.length = 0;

    nativeDispatch(
      new MessageEvent("message", {
        data: { command: "museServerLifecycle", state: "ready" },
      }),
    );
    await flush();

    expect(ws.reconnectNow).toHaveBeenCalled();
    expect(api.getMessages).toHaveBeenCalledWith("sess-active");
    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "showToast",
        toast: expect.objectContaining({
          id: "muse-server",
          message: "本地服务已恢复",
        }),
      }),
    );
  });

  it("resyncs after the host reports an OS resume", async () => {
    const { ws } = stubWsStatus();
    const api = stubApi();
    const bridge = createHostBridge({ api, ws, workdir: "/tmp" });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    vi.mocked(api.getMessages).mockClear();
    vi.mocked(ws.reconnectNow).mockClear();

    nativeDispatch(
      new MessageEvent("message", {
        data: { command: "museServerLifecycle", state: "resume" },
      }),
    );
    await flush();

    expect(ws.reconnectNow).toHaveBeenCalled();
    expect(api.getMessages).toHaveBeenCalledWith("sess-active");
  });

  it("toasts once when desktopReady finds a session interrupted last run", async () => {
    const api = stubApi({
      listSessionsGrouped: vi.fn(async () => ({
        pinned: [],
        recent: [{ ...baseSession, interrupted: true }],
        activeSessionId: "sess-active",
      })),
    });
    const bridge = createHostBridge({ api, ws: stubWs(), workdir: "/tmp" });
    bridge.postMessage({ command: "desktopReady" });
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "showToast",
        toast: expect.objectContaining({
          id: "muse-server",
          message: "上次对话被中断",
        }),
      }),
    );

    messages.length = 0;
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    expect(messages).not.toContainEqual(
      expect.objectContaining({
        command: "showToast",
        toast: expect.objectContaining({ message: "上次对话被中断" }),
      }),
    );
  });
});

describe("createHostBridge codemaker auth-failure dialog", () => {
  const messages: unknown[] = [];
  let nativeDispatch: typeof window.dispatchEvent;

  beforeEach(() => {
    messages.length = 0;
    nativeDispatch = window.dispatchEvent.bind(window);
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

  it("isAuthError matches codemaker credential/expiry/unauthorized errors", () => {
    expect(isAuthError("CodeMaker credentials missing or expired")).toBe(true);
    expect(isAuthError("Unauthorized")).toBe(true);
    expect(isAuthError("Request failed with status code 401")).toBe(true);
    expect(isAuthError("CodeMaker token renew failed (401)")).toBe(true);
    expect(
      isAuthError(
        'HTTP 403 Forbidden: {"msg":"auth failed","extra":{"code":30002,"msg":"request access token is invalid: token error: Token is expired"}}',
      ),
    ).toBe(true);
  });

  it("isAuthError does not match unrelated errors", () => {
    expect(isAuthError("session not found")).toBe(false);
    expect(isAuthError("network error")).toBe(false);
    expect(isAuthError("CodeMaker login timed out")).toBe(false);
  });

  it("posts showAuthDialog when codemaker send fails with an auth error", async () => {
    const api = stubApi({
      sendMessage: vi.fn(async () => {
        throw new Error("CodeMaker credentials missing or expired");
      }),
    });
    const bridge = createHostBridge({ api, ws: stubWs(), workdir: "/tmp" });
    await flush();

    bridge.postMessage({ command: "sendMessage", text: "hello" });
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({ command: "updateErrorBlock" }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ command: "showAuthDialog" }),
    );
  });

  it("posts showAuthDialog when the active provider is ChatGPT", async () => {
    const api = stubApi({
      getAuthStatus: vi.fn(async () => ({
        state: "authenticated",
        providerId: "codex",
      })),
      sendMessage: vi.fn(async () => {
        throw new Error("Codex credentials missing or expired");
      }),
    });
    const bridge = createHostBridge({ api, ws: stubWs(), workdir: "/tmp" });
    await flush();

    bridge.postMessage({ command: "sendMessage", text: "hello" });
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "showAuthDialog",
        providerId: "codex",
      }),
    );
  });

  it("does not post showAuthDialog when the active provider is not codemaker", async () => {
    const api = stubApi({
      getAuthStatus: vi.fn(async () => ({
        state: "unauthenticated",
        providerId: "openai-compatible",
      })),
      sendMessage: vi.fn(async () => {
        throw new Error("CodeMaker credentials missing or expired");
      }),
    });
    const bridge = createHostBridge({ api, ws: stubWs(), workdir: "/tmp" });
    await flush();

    bridge.postMessage({ command: "sendMessage", text: "hello" });
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({ command: "updateErrorBlock" }),
    );
    expect(messages).not.toContainEqual(
      expect.objectContaining({ command: "showAuthDialog" }),
    );
  });

  it("does not post showAuthDialog for non-auth send errors", async () => {
    const api = stubApi({
      sendMessage: vi.fn(async () => {
        throw new Error("session not found");
      }),
    });
    const bridge = createHostBridge({ api, ws: stubWs(), workdir: "/tmp" });
    await flush();

    bridge.postMessage({ command: "sendMessage", text: "hello" });
    await flush();

    expect(messages).not.toContainEqual(
      expect.objectContaining({ command: "showAuthDialog" }),
    );
  });

  it("opens the re-login dialog when a 403 token-expired error:block arrives while still locally authenticated", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
      onStatus: vi.fn(() => () => {}),
    } as unknown as MuseWsClient;
    const bridge = createHostBridge({
      api: stubApi({
        getAuthStatus: vi.fn(async () => ({
          state: "authenticated",
          providerId: "codemaker",
        })),
      }),
      ws,
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    handler!({
      type: "error:block",
      sessionId: "sess-active",
      error:
        'HTTP 403 Forbidden: {"msg":"auth failed","extra":{"code":30002,"msg":"request access token is invalid: token error: Token is expired"}}',
    });
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "authStatusResponse",
        isAuthenticated: false,
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ command: "showAuthDialog" }),
    );
  });

  it("opens the re-login dialog when a mid-turn token expiry arrives on WS", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
      onStatus: vi.fn(() => () => {}),
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
      type: "session:status",
      sessionId: "sess-active",
      status: "error",
      error: "Unauthorized",
    });
    handler!({
      type: "auth:changed",
      sessionId: "sess-active",
      status: { state: "unauthenticated", providerId: "codemaker" },
    });
    await flush();

    expect(messages).toContainEqual(
      expect.objectContaining({
        command: "updateErrorBlock",
        error: "Unauthorized",
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ command: "showAuthDialog" }),
    );
  });

  it("does not open the re-login dialog on auth:changed for API-key providers", async () => {
    let handler: ((e: unknown) => void) | undefined;
    const ws = {
      onEvent: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
      connect: vi.fn(async () => {}),
      onStatus: vi.fn(() => () => {}),
    } as unknown as MuseWsClient;
    const bridge = createHostBridge({
      api: stubApi({
        getAuthStatus: vi.fn(async () => ({
          state: "authenticated",
          providerId: "openai-compatible",
        })),
      }),
      ws,
      workdir: "/tmp",
    });
    bridge.postMessage({ command: "desktopReady" });
    await flush();
    messages.length = 0;

    handler!({
      type: "auth:changed",
      sessionId: "sess-active",
      status: { state: "unauthenticated", providerId: "openai-compatible" },
    });
    await flush();

    expect(messages).not.toContainEqual(
      expect.objectContaining({ command: "showAuthDialog" }),
    );
  });
});
