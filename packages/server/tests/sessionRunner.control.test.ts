import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createProviderRegistry,
  loadProvidersConfig,
  saveProvidersConfig,
  type AiProvider,
  type AuthStatus,
  type ModelInfo,
} from "@muse-work/provider";
import {
  createSessionRunner,
  type SessionAgent,
} from "../src/services/sessionRunner/index.js";
import { createSessionStore } from "../src/services/sessionStore.js";
import { createWsHub } from "../src/services/wsHub.js";

function makeProvider(): AiProvider {
  return {
    id: "openai-compatible",
    displayName: "OpenAI Compatible",
    async getAuthStatus(): Promise<AuthStatus> {
      return {
        state: "authenticated",
        providerId: "openai-compatible",
        user: "t",
      };
    },
    async beginLogin() {
      return { reused: true };
    },
    async completeLogin() {
      return { state: "authenticated", providerId: "openai-compatible" };
    },
    async logout() {},
    async listModels(): Promise<ModelInfo[]> {
      return [{ id: "m1", label: "m1" }];
    },
    async resolveGateway(modelId: string) {
      return {
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-test",
        model: modelId,
      };
    },
  };
}

function stubAgent(overrides: Partial<SessionAgent> = {}): SessionAgent {
  return {
    sendMessage: async () => {},
    dispose: async () => {},
    getMessages: () => [],
    ...overrides,
  };
}

describe("sessionRunner control plane", () => {
  let home: string | undefined;

  afterEach(() => {
    if (home) {
      fs.rmSync(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  function setup() {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-ctrl-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "m1",
      },
      home,
    );
    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([makeProvider()], home);
    return { store, hub, registry, home };
  }

  it("defaults new sessions to acceptEdits", () => {
    const { store, home: dir } = setup();
    const session = store.create({ workdir: dir, model: "m1" });
    expect(session.permissionMode).toBe("acceptEdits");
  });

  it("create honors permissionMode option", () => {
    const { store, home: dir } = setup();
    const session = store.create({
      workdir: dir,
      model: "m1",
      permissionMode: "bypassPermissions",
    });
    expect(session.permissionMode).toBe("bypassPermissions");
  });

  it("passes session permissionMode into Agent.create", async () => {
    const { store, hub, registry, home: dir } = setup();
    const seen: string[] = [];
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        seen.push(String(opts.permissionMode));
        return stubAgent();
      },
    });
    const session = store.create({ workdir: dir, model: "m1" });
    store.update(session.id, { permissionMode: "bypassPermissions" });
    await runner.sendMessage(session.id, "hi");
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBe("bypassPermissions");
  });

  it("compact calls agent.compact", async () => {
    const { store, hub, registry, home: dir } = setup();
    let compactCalls = 0;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async () =>
        stubAgent({
          compact: async () => {
            compactCalls += 1;
          },
        }),
    });
    const session = store.create({ workdir: dir, model: "m1" });
    await runner.sendMessage(session.id, "hi");
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");
    await runner.compact(session.id);
    expect(compactCalls).toBe(1);
  });

  it("clear calls agent.clearMessages", async () => {
    const { store, hub, registry, home: dir } = setup();
    let clearCalls = 0;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async () =>
        stubAgent({
          clearMessages: async () => {
            clearCalls += 1;
          },
        }),
    });
    const session = store.create({ workdir: dir, model: "m1" });
    await runner.sendMessage(session.id, "hi");
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");
    await runner.clear(session.id);
    expect(clearCalls).toBe(1);
  });

  it("rewind truncates to the user message index and returns its text", async () => {
    const { store, hub, registry, home: dir } = setup();
    const messages = [
      {
        id: "u1",
        role: "user",
        blocks: [{ type: "text", content: "first" }],
      },
      {
        id: "a1",
        role: "assistant",
        blocks: [{ type: "text", content: "ok" }],
      },
      {
        id: "u2",
        role: "user",
        blocks: [{ type: "text", content: "second" }],
      },
      {
        id: "a2",
        role: "assistant",
        blocks: [{ type: "text", content: "ok2" }],
      },
    ];
    let truncatedTo: number | undefined;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async () =>
        stubAgent({
          getMessages: () => messages,
          truncateHistory: async (index: number) => {
            truncatedTo = index;
          },
        }),
    });
    const session = store.create({ workdir: dir, model: "m1" });
    const checkpoints = await runner.listRewindCheckpoints(session.id);
    expect(checkpoints).toEqual([
      { id: "u1", content: "first" },
      { id: "u2", content: "second" },
    ]);
    const result = await runner.rewind(session.id, "u2");
    expect(truncatedTo).toBe(2);
    expect(result).toEqual({ ok: true, inputContent: "second" });
  });

  it("broadcasts workflow-runs:update when background tasks change", async () => {
    const { store, hub, registry, home: dir } = setup();
    const broadcasts: Array<{ type?: string; runs?: unknown }> = [];
    const orig = hub.broadcast.bind(hub);
    hub.broadcast = (sessionId, event) => {
      broadcasts.push(event as { type?: string; runs?: unknown });
      orig(sessionId, event);
    };

    const runs = [
      { runId: "r1", meta: { name: "audit-and-fix" }, status: "running" },
    ];
    let captured: { callbacks?: { onBackgroundTasksChange?: (tasks: unknown[]) => void } } | undefined;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        captured = opts;
        return stubAgent({
          sendMessage: async () => {
            captured?.callbacks?.onBackgroundTasksChange?.([
              { id: "w1", type: "workflow", status: "running" },
            ]);
          },
          getWorkflowRuns: async () => runs,
        });
      },
    });
    const session = store.create({ workdir: dir, model: "m1" });
    await runner.sendMessage(session.id, "hi");
    await expect
      .poll(() => broadcasts.some((e) => e.type === "workflow-runs:update"))
      .toBe(true);
    expect(broadcasts.find((e) => e.type === "workflow-runs:update")?.runs).toEqual(
      [
        {
          runId: "r1",
          meta: { name: "audit-and-fix" },
          status: "running",
          phases: [],
        },
      ],
    );
  });

  it("getWorkflowRuns returns [] without creating an agent for a never-sent session", async () => {
    const { store, hub, registry, home: dir } = setup();
    let createCount = 0;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async () => {
        createCount += 1;
        return stubAgent();
      },
    });
    const session = store.create({ workdir: dir, model: "m1" });

    // No agent exists (never sent a message): workflows endpoint must not force
    // agent creation — it returns the (empty) cached snapshot instead.
    expect(await runner.getWorkflowRuns(session.id)).toEqual([]);
    expect(createCount).toBe(0);
  });

  it("getWorkflowRuns returns live agent runs instead of a stale empty cache", async () => {
    const { store, hub, registry, home: dir } = setup();
    let currentRuns: unknown[] = [];
    let captured: {
      callbacks?: { onNotificationMessageAdded?: () => void };
    } | undefined;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        captured = opts;
        return stubAgent({
          sendMessage: async () => {
            captured?.callbacks?.onNotificationMessageAdded?.();
          },
          getWorkflowRuns: async () => currentRuns,
        });
      },
    });
    const session = store.create({ workdir: dir, model: "m1" });
    await runner.sendMessage(session.id, "hi");
    await expect.poll(() => runner.getWorkflowRuns(session.id)).toEqual([]);

    currentRuns = [
      { runId: "r1", meta: { name: "audit-and-fix" }, status: "running" },
    ];
    expect(await runner.getWorkflowRuns(session.id)).toEqual([
      {
        runId: "r1",
        meta: { name: "audit-and-fix" },
        status: "running",
        phases: [],
      },
    ]);
  });

  it("reconciles a completed workflow into background-tasks:update on notification", async () => {
    const { store, hub, registry, home: dir } = setup();
    const broadcasts: Array<{ type?: string; tasks?: unknown }> = [];
    const orig = hub.broadcast.bind(hub);
    hub.broadcast = (sessionId, event) => {
      broadcasts.push(event as { type?: string; tasks?: unknown });
      orig(sessionId, event);
    };

    const live = {
      id: "task_138_1",
      type: "workflow",
      status: "running",
      startTime: 1,
      description: "Workflow: Icap-ide-analysis",
    };
    let captured: {
      callbacks?: {
        onBackgroundTasksChange?: (tasks: unknown[]) => void;
        onNotificationMessageAdded?: () => void;
      };
    } | undefined;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        captured = opts;
        return stubAgent({
          sendMessage: async () => {
            captured?.callbacks?.onBackgroundTasksChange?.([live]);
            live.status = "completed";
            captured?.callbacks?.onNotificationMessageAdded?.();
          },
          getBackgroundTaskOutput: (id: string) =>
            id === live.id
              ? {
                  status: live.status,
                  stdout: "",
                  stderr: "",
                  type: "workflow",
                }
              : null,
        });
      },
    });
    const session = store.create({ workdir: dir, model: "m1" });
    await runner.sendMessage(session.id, "hi");
    await expect
      .poll(() =>
        broadcasts.some(
          (e) =>
            e.type === "background-tasks:update" &&
            Array.isArray(e.tasks) &&
            (e.tasks[0] as { status?: string })?.status === "completed",
        ),
      )
      .toBe(true);
  });

  it("getBackgroundTasks returns live output status instead of a stale running cache", async () => {
    const { store, hub, registry, home: dir } = setup();
    const live = {
      id: "task_138_1",
      type: "workflow",
      status: "running",
      startTime: 1,
      description: "Workflow: Icap-ide-analysis",
    };
    let captured: {
      callbacks?: { onBackgroundTasksChange?: (tasks: unknown[]) => void };
    } | undefined;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        captured = opts;
        return stubAgent({
          sendMessage: async () => {
            captured?.callbacks?.onBackgroundTasksChange?.([live]);
          },
          getBackgroundTaskOutput: (id: string) =>
            id === live.id
              ? {
                  status: live.status,
                  stdout: "",
                  stderr: "",
                  type: "workflow",
                }
              : null,
        });
      },
    });
    const session = store.create({ workdir: dir, model: "m1" });
    await runner.sendMessage(session.id, "hi");
    await expect
      .poll(async () => (await runner.getBackgroundTasks(session.id))[0])
      .toMatchObject({ id: "task_138_1", status: "running" });

    live.status = "completed";
    expect(await runner.getBackgroundTasks(session.id)).toEqual([
      expect.objectContaining({
        id: "task_138_1",
        status: "completed",
      }),
    ]);
  });

  it("getTasks returns the cached task list only while the session is active", async () => {
    const { store, hub, registry, home: dir } = setup();
    let captured: {
      callbacks?: {
        onTasksChange?: (tasks: unknown[]) => void;
        onLoadingChange?: (loading: boolean) => void;
      };
    } | undefined;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        captured = opts;
        return stubAgent();
      },
    });
    const session = store.create({ workdir: dir, model: "m1" });
    // sendMessage 为 fire-and-forget，轮询等待惰性 createAgent 捕获 callbacks
    await runner.sendMessage(session.id, "hi");
    await expect.poll(() => captured).toBeTruthy();

    // 从未执行过 → 无任务缓存
    expect(await runner.getTasks(session.id)).toEqual([]);

    // 任务变更回调写入缓存，但会话仍 idle → 保持不展示（只在执行中展示）
    const tasks = [{ id: "1", subject: "do it", status: "pending" }];
    captured!.callbacks!.onTasksChange!(tasks);
    expect(await runner.getTasks(session.id)).toEqual([]);

    // 会话进入执行中（loading）→ 返回缓存任务
    captured!.callbacks!.onLoadingChange!(true);
    expect(await runner.getTasks(session.id)).toEqual(tasks);

    // 不存在的会话 → 404
    await expect(runner.getTasks("missing")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("abortMessage broadcasts tasks:update [] to hide the sender task list", async () => {
    const { store, hub, registry, home: dir } = setup();
    const broadcasts: Array<{ type?: string; tasks?: unknown }> = [];
    const orig = hub.broadcast.bind(hub);
    hub.broadcast = (sessionId, event) => {
      broadcasts.push(event as { type?: string; tasks?: unknown });
      orig(sessionId, event);
    };
    let captured: {
      callbacks?: {
        onTasksChange?: (tasks: unknown[]) => void;
        onLoadingChange?: (loading: boolean) => void;
      };
    } | undefined;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        captured = opts;
        return stubAgent();
      },
    });
    const session = store.create({ workdir: dir, model: "m1" });
    await runner.sendMessage(session.id, "hi");
    await expect.poll(() => captured).toBeTruthy();

    // 会话执行中且已有任务缓存
    const tasks = [{ id: "1", subject: "do it", status: "pending" }];
    captured!.callbacks!.onTasksChange!(tasks);
    captured!.callbacks!.onLoadingChange!(true);
    expect(await runner.getTasks(session.id)).toEqual(tasks);

    // 取消会话 → 广播 tasks:update [] 隐藏 sender 任务列表
    await runner.abortMessage(session.id);
    expect(
      broadcasts.some(
        (e) =>
          e.type === "tasks:update" &&
          Array.isArray(e.tasks) &&
          e.tasks.length === 0,
      ),
    ).toBe(true);
  });

  it("getMessages serves disk history without creating an agent", async () => {
    const { store, hub, registry, home: dir } = setup();
    let createCount = 0;
    const diskMessages = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [{ type: "text", content: "ok" }],
      },
    ];
    const loadCalls: Array<{ id: string; workdir: string }> = [];
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async () => {
        createCount += 1;
        return stubAgent();
      },
      loadMainSessionFromDisk: async (id, workdir) => {
        loadCalls.push({ id, workdir });
        return { messages: diskMessages };
      },
    });
    const session = store.create({ workdir: dir, model: "m1" });
    // SDK persists under its own waveSessionId, not the server store's id.
    store.setWaveSessionId(session.id, "wave-123");

    // No agent exists: getMessages reads the persisted jsonl (injected) and
    // must NOT create an agent — only sendMessage does.
    const messages = (await runner.getMessages(session.id)) as Array<{
      id: string;
    }>;
    expect(messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(createCount).toBe(0);
    // The disk lookup must use the SDK's waveSessionId so the file is found.
    expect(loadCalls).toEqual([{ id: "wave-123", workdir: dir }]);
  });

  it("createAgentWithRestore 透传会话 agent 字段：fastModel/tools/disallowedTools/allowedTools", async () => {
    const { store, hub, registry, home: dir } = setup();
    let captured: Record<string, unknown> | undefined;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        captured = opts as unknown as Record<string, unknown>;
        return stubAgent();
      },
    });
    const session = store.create({
      workdir: dir,
      model: "m1",
      fastModel: "fast-m",
      tools: ["Bash", "Read"],
      disallowedTools: ["Bash(npm run build)"],
      allowedTools: ["Read"],
    });
    await runner.sendMessage(session.id, "hi");
    await expect.poll(() => captured?.fastModel).toBe("fast-m");
    expect(captured?.tools).toEqual(["Bash", "Read"]);
    expect(captured?.disallowedTools).toEqual(["Bash(npm run build)"]);
    expect(captured?.allowedTools).toEqual(["Read"]);
  });

  it("createAgentWithRestore 未给 fastModel/tools/权限 时回落默认（不传这些字段）", async () => {
    const { store, hub, registry, home: dir } = setup();
    let captured: Record<string, unknown> | undefined;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home: dir,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        captured = opts as unknown as Record<string, unknown>;
        return stubAgent();
      },
    });
    const session = store.create({ workdir: dir, model: "m1" });
    await runner.sendMessage(session.id, "hi");
    // gateway 无 fastModel → 回落 model
    await expect.poll(() => captured?.fastModel).toBe("m1");
    expect(captured?.tools).toBeUndefined();
    expect(captured?.disallowedTools).toBeUndefined();
    expect(captured?.allowedTools).toBeUndefined();
  });
});
