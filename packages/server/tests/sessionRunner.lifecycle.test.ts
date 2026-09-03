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
import { createWsHub, type WsEvent } from "../src/services/wsHub.js";

function makeProvider(models: string[] = ["m1", "m2"]): AiProvider {
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
      return models.map((id) => ({ id, label: id }));
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

describe("sessionRunner lifecycle", () => {
  let home: string | undefined;

  afterEach(() => {
    if (home) {
      fs.rmSync(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  function setup(activeModelId = "m1") {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-life-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId,
      },
      home,
    );
    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([makeProvider()], home);
    return { store, hub, registry, home };
  }

  it("restore failure falls back to new agent and writes waveSessionId", async () => {
    const { store, hub, registry, home } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    store.setWaveSessionId(session.id, "broken-wave-id");

    let calls = 0;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        calls++;
        if (opts.restoreSessionId === "broken-wave-id") {
          throw new Error("restore failed");
        }
        return {
          sendMessage: async () => {},
          dispose: async () => {},
          getMessages: () => [],
          sessionId: "new-wave-id",
        };
      },
    });

    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => calls).toBe(2);
    expect(store.get(session.id)?.waveSessionId).toBe("new-wave-id");
  });

  it("idle TTL destroys agent but keeps waveSessionId", async () => {
    const { store, hub, registry, home } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    store.setWaveSessionId(session.id, "11111111-1111-4111-8111-111111111111");

    const restoreIds: Array<string | undefined> = [];
    let disposeCount = 0;

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 40,
      createAgent: async (opts) => {
        restoreIds.push(opts.restoreSessionId);
        return {
          sendMessage: async () => {
            // Leave status running so runTurn calls markIdle after send settles.
          },
          dispose: async () => {
            disposeCount += 1;
          },
          getMessages: () => [{ id: "m" }],
          sessionId: "11111111-1111-4111-8111-111111111111",
        };
      },
    });

    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => restoreIds.length).toBe(1);
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");
    expect(restoreIds[0]).toBe("11111111-1111-4111-8111-111111111111");

    await expect.poll(() => disposeCount).toBe(1);
    expect(store.get(session.id)?.waveSessionId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(store.get(session.id)).toBeDefined();

    // getMessages is read-only: it must NOT recreate the destroyed agent.
    await runner.getMessages(session.id);
    expect(restoreIds.length).toBe(1);
    expect(store.get(session.id)?.waveSessionId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );

    // Only sending a message recreates the runtime, restoring waveSessionId.
    await runner.sendMessage(session.id, "again");
    await expect.poll(() => restoreIds.length).toBe(2);
    expect(restoreIds[1]).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("model change destroys on next ensure and passes restoreSessionId", async () => {
    const { store, hub, registry, home } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    store.setWaveSessionId(session.id, "wave-1");

    const createdModels: string[] = [];
    const restoreIds: Array<string | undefined> = [];
    let disposeCount = 0;

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        createdModels.push(opts.model ?? "unknown");
        restoreIds.push(opts.restoreSessionId);
        return {
          sendMessage: async () => {},
          dispose: async () => {
            disposeCount += 1;
          },
          getMessages: () => [],
          sessionId: "wave-1",
        } satisfies SessionAgent;
      },
    });

    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => createdModels.length).toBe(1);
    expect(createdModels).toEqual(["m1"]);
    expect(restoreIds[0]).toBe("wave-1");

    store.update(session.id, { model: "m2" });
    await runner.sendMessage(session.id, "again");
    await expect.poll(() => createdModels.length).toBe(2);

    expect(disposeCount).toBe(1);
    expect(createdModels).toEqual(["m1", "m2"]);
    expect(restoreIds[1]).toBe("wave-1");
  });

  it("sets unreadDone when non-active session becomes idle", async () => {
    const { store, hub, registry, home } = setup();
    const active = store.create({ workdir: "/tmp", model: "m1" });
    const background = store.create({ workdir: "/tmp", model: "m1" });
    store.select(active.id);

    const unreadCalls: Array<{ id: string; value: boolean }> = [];
    const originalSetUnread = store.setUnreadDone.bind(store);
    store.setUnreadDone = (id, value) => {
      unreadCalls.push({ id, value });
      return originalSetUnread(id, value);
    };

    const events: Array<{ sessionId: string; event: WsEvent }> = [];
    const originalBroadcast = hub.broadcast.bind(hub);
    hub.broadcast = (sessionId, event) => {
      events.push({ sessionId, event });
      return originalBroadcast(sessionId, event);
    };

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      createAgent: async () => ({
        sendMessage: async () => {},
        dispose: async () => {},
        getMessages: () => [],
        sessionId: "wave-bg",
      }),
    });

    await runner.sendMessage(background.id, "hello from bg");
    await expect.poll(() => store.get(background.id)?.status).toBe("idle");

    expect(unreadCalls).toContainEqual({
      id: background.id,
      value: true,
    });
    expect(
      events.some(
        (e) =>
          e.sessionId === background.id &&
          e.event.type === "session:unread" &&
          (e.event as { unreadDone?: boolean }).unreadDone === true,
      ),
    ).toBe(true);
  });

  it("sets unreadDone on turn error for non-active session", async () => {
    const { store, hub, registry, home } = setup();
    const active = store.create({ workdir: "/tmp", model: "m1" });
    const background = store.create({ workdir: "/tmp", model: "m1" });
    store.select(active.id);

    const unreadCalls: Array<{ id: string; value: boolean }> = [];
    const originalSetUnread = store.setUnreadDone.bind(store);
    store.setUnreadDone = (id, value) => {
      unreadCalls.push({ id, value });
      return originalSetUnread(id, value);
    };

    const events: Array<{ sessionId: string; event: WsEvent }> = [];
    const originalBroadcast = hub.broadcast.bind(hub);
    hub.broadcast = (sessionId, event) => {
      events.push({ sessionId, event });
      return originalBroadcast(sessionId, event);
    };

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      createAgent: async () => ({
        sendMessage: async () => {
          throw new Error("boom");
        },
        dispose: async () => {},
        getMessages: () => [],
        sessionId: "wave-err",
      }),
    });

    await runner.sendMessage(background.id, "fail please");
    await expect.poll(() => store.get(background.id)?.status).toBe("idle");

    expect(unreadCalls).toContainEqual({
      id: background.id,
      value: true,
    });
    expect(
      events.some(
        (e) =>
          e.sessionId === background.id &&
          e.event.type === "session:unread" &&
          (e.event as { unreadDone?: boolean }).unreadDone === true,
      ),
    ).toBe(true);
  });

  it("does not set unreadDone when an already-idle background session gets loading false", async () => {
    const { store, hub, registry, home } = setup();
    const active = store.create({ workdir: "/tmp", model: "m1" });
    const background = store.create({ workdir: "/tmp", model: "m1" });
    store.select(active.id);

    const unreadCalls: Array<{ id: string; value: boolean }> = [];
    const originalSetUnread = store.setUnreadDone.bind(store);
    store.setUnreadDone = (id, value) => {
      unreadCalls.push({ id, value });
      return originalSetUnread(id, value);
    };

    let onLoadingChange: ((loading: boolean) => void) | undefined;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        onLoadingChange = opts.callbacks?.onLoadingChange;
        return {
          sendMessage: async () => {},
          dispose: async () => {},
          getMessages: () => [],
          sessionId: "wave-idle-bg",
        };
      },
    });

    // Trigger agent creation via a control-plane call (connectMcpServer runs
    // ensureAgent but does not change session status), keeping the session idle.
    await runner.connectMcpServer(background.id, "srv");
    await expect.poll(() => onLoadingChange).toBeTypeOf("function");

    onLoadingChange?.(false);

    expect(unreadCalls).toEqual([]);
    expect(store.get(background.id)?.status).toBe("idle");
  });

  it("getMessages is read-only: does not create an agent for a never-sent session", async () => {
    const { store, hub, registry, home } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    store.setWaveSessionId(session.id, "22222222-2222-4222-8222-222222222222");

    let restoreIds: Array<string | undefined> = [];
    let disposeCount = 0;

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 40,
      createAgent: async (opts) => {
        restoreIds.push(opts.restoreSessionId);
        return {
          sendMessage: async () => {},
          dispose: async () => {
            disposeCount += 1;
          },
          getMessages: () => [{ id: "m" }],
          sessionId: "22222222-2222-4222-8222-222222222222",
        };
      },
    });

    // No agent exists yet (session never sent a message): getMessages must NOT
    // create one — it serves the empty history read-only.
    const messages = await runner.getMessages(session.id);
    expect(messages).toEqual([]);
    expect(restoreIds).toEqual([]);
    expect(store.get(session.id)?.status).toBe("idle");

    // Sending a message creates the runtime and re-arms the idle TTL; the agent
    // is destroyed after the TTL but waveSessionId is kept.
    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => restoreIds.length).toBe(1);
    await expect.poll(() => disposeCount).toBe(1);
    expect(store.get(session.id)?.waveSessionId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(store.get(session.id)).toBeDefined();
  });

  it("keeps status running after assistant stage end while loading stays true", async () => {
    const { store, hub, registry, home } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    store.select(session.id);

    type Callbacks = {
      onLoadingChange?: (loading: boolean) => void;
      onAssistantContentUpdated?: (p: {
        messageId: string;
        chunk: string;
        stage: "streaming" | "end";
      }) => void;
    };
    let cbs: Callbacks | undefined;

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        cbs = opts.callbacks as Callbacks;
        return {
          sendMessage: async () => {
            cbs?.onLoadingChange?.(true);
            cbs?.onAssistantContentUpdated?.({
              messageId: "m1",
              chunk: "working",
              stage: "end",
            });
            // Tools still running — loading remains true; must NOT idle yet.
            await new Promise((r) => setTimeout(r, 30));
          },
          dispose: async () => {},
          getMessages: () => [],
          sessionId: "wave-load",
        };
      },
    });

    await runner.sendMessage(session.id, "run tools");
    await expect.poll(() => cbs).toBeTruthy();
    await expect.poll(() => store.get(session.id)?.status).toBe("running");
    // Still loading after sendMessage settled + stage end.
    expect(store.get(session.id)?.status).toBe("running");

    cbs!.onLoadingChange?.(false);
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");
  });

  it("does not settle the turn when loading flickers while sendMessage is still in flight", async () => {
    // SDK drops loading between a tool and the next model round even though
    // sendMessage has not returned. Issue planning would otherwise get
    // "本回合结束" while the exec session is still on that checklist item.
    const { store, hub, registry, home } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    store.select(session.id);

    type Callbacks = {
      onLoadingChange?: (loading: boolean) => void;
      onToolBlockUpdated?: (p: Record<string, unknown>) => void;
    };
    let cbs: Callbacks | undefined;
    let releaseSend: (() => void) | undefined;
    const sendHeld = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const settled: Array<{ ok: boolean; error?: string }> = [];

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      onTurnSettled: (_id, result) => {
        settled.push(result);
      },
      createAgent: async (opts) => {
        cbs = opts.callbacks as Callbacks;
        return {
          sendMessage: async () => {
            cbs?.onLoadingChange?.(true);
            cbs?.onToolBlockUpdated?.({
              id: "tool-1",
              name: "Agent",
              status: "running",
            });
            await sendHeld;
          },
          dispose: async () => {},
          getMessages: () => [],
        };
      },
    });

    void runner.sendMessage(session.id, "exec item 3");
    await expect.poll(() => cbs).toBeTruthy();
    await expect.poll(() => store.get(session.id)?.status).toBe("running");

    cbs!.onLoadingChange?.(false);
    cbs!.onLoadingChange?.(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(store.get(session.id)?.status).toBe("running");
    expect(settled).toEqual([]);

    releaseSend?.();
    cbs!.onLoadingChange?.(false);
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");
    expect(settled).toEqual([{ ok: true }]);
  });

  it("broadcasts only file_history blocks (not the full transcript) when a turn ends", async () => {
    const { store, hub, registry, home } = setup();
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-broadcast-"));
    const filePath = path.join(workdir, "app.js");
    const snapshotPath = path.join(workdir, "snap.txt");
    fs.writeFileSync(filePath, "const a = 1;\nconst b = 2;\n");
    fs.writeFileSync(snapshotPath, "const a = 1;\n");
    const session = store.create({ workdir, model: "m1" });

    const broadcasts: Array<{ type?: string; messages?: unknown }> = [];
    const orig = hub.broadcast.bind(hub);
    hub.broadcast = (sessionId, event) => {
      broadcasts.push(event as { type?: string; messages?: unknown });
      return orig(sessionId, event);
    };

    type Callbacks = { onLoadingChange?: (loading: boolean) => void };
    let cbs: Callbacks | undefined;
    const messages = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "改" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          {
            type: "file_history",
            snapshots: [
              {
                filePath,
                snapshotPath,
                operation: "modify",
                timestamp: 1,
              },
            ],
          },
        ],
      },
    ];
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      createAgent: async (opts) => {
        cbs = opts.callbacks as Callbacks;
        return {
          sendMessage: async () => {},
          dispose: async () => {},
          getMessages: () => messages,
          sessionId: "wave-bcast",
        };
      },
    });

    await runner.sendMessage(session.id, "改");
    await expect.poll(() => cbs).toBeTruthy();
    // Turn ends: loading false — only the file_history delta must be pushed, not
    // a full messages:replace of the whole transcript.
    cbs!.onLoadingChange?.(false);

    const fh = broadcasts.find((e) => e.type === "file_history:update");
    await expect.poll(() => fh ?? broadcasts.find((e) => e.type === "messages:replace")).toBeTruthy();
    expect(broadcasts.some((e) => e.type === "messages:replace")).toBe(false);
    expect(
      (fh?.messages as Array<{ messageId: string; snapshots: unknown[] }>)[0],
    ).toMatchObject({
      messageId: "a1",
      snapshots: [expect.objectContaining({ additions: 1, deletions: 0 })],
    });

    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("idle TTL does not destroy while status is running", async () => {
    const { store, hub, registry, home } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });

    let disposeCount = 0;

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 200,
      createAgent: async () => ({
        sendMessage: async () => {},
        dispose: async () => {
          disposeCount += 1;
        },
        getMessages: () => [],
        sessionId: "wave-run",
      }),
    });

    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");

    // Force running before the armed TTL fires so callback sees !canIdleDestroy.
    store.updateStatus(session.id, "running");
    await new Promise((r) => setTimeout(r, 280));
    expect(disposeCount).toBe(0);

    store.updateStatus(session.id, "idle");
    // Retry arm from skipped TTL should destroy once idle again.
    await expect.poll(() => disposeCount).toBe(1);
  });

  it("snapshotEvents includes running status and loading for an in-flight turn", async () => {
    const { store, hub, registry, home } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    const hang = Promise.withResolvers<void>();

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      createAgent: async (opts) => ({
        sendMessage: async () => {
          opts.callbacks?.onLoadingChange?.(true);
          await hang.promise;
        },
        dispose: async () => {},
        getMessages: () => [],
        sessionId: "wave-snap",
      }),
    });

    void runner.sendMessage(session.id, "hello");
    await expect.poll(() => store.get(session.id)?.status).toBe("running");
    await expect
      .poll(() =>
        runner.snapshotEvents().some(
          (e) => e.type === "loading" && e.loading === true,
        ),
      )
      .toBe(true);

    const snap = runner.snapshotEvents();
    expect(snap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "session:status",
          status: "running",
          sessionId: session.id,
        }),
        expect.objectContaining({
          type: "loading",
          loading: true,
          sessionId: session.id,
        }),
      ]),
    );
    hang.resolve();
  });

  it("snapshotEvents includes a pending permission request", async () => {
    const { store, hub, registry, home } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    const permissionSeen = Promise.withResolvers<void>();
    const original = hub.broadcast.bind(hub);
    hub.broadcast = (sessionId, event) => {
      if (event.type === "permission:request") permissionSeen.resolve();
      return original(sessionId, event);
    };

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      createAgent: async (opts) => ({
        sendMessage: async () => {
          await opts.canUseTool?.({
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "ls" },
          });
        },
        dispose: async () => {},
        getMessages: () => [],
        sessionId: "wave-perm",
      }),
    });

    void runner.sendMessage(session.id, "run ls");
    await permissionSeen.promise;

    const snap = runner.snapshotEvents();
    expect(snap.some((e) => e.type === "permission:request")).toBe(true);
    const perm = snap.find((e) => e.type === "permission:request");
    expect(perm).toMatchObject({
      type: "permission:request",
      sessionId: session.id,
      toolName: "Bash",
    });
  });

  it("stall timer errors a hung turn and returns the session to idle", async () => {
    const { store, hub, registry, home } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    const events: Array<{ type: string; status?: string; error?: string }> = [];
    const original = hub.broadcast.bind(hub);
    hub.broadcast = (sessionId, event) => {
      events.push(event as { type: string; status?: string; error?: string });
      return original(sessionId, event);
    };

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      stallMs: 40,
      createAgent: async () => ({
        sendMessage: async () => new Promise(() => {}),
        abortMessage: () => {},
        dispose: async () => {},
        sessionId: "wave-stall",
      }),
    });

    void runner.sendMessage(session.id, "hang");
    await expect.poll(() => store.get(session.id)?.status).toBe("running");
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");
    expect(
      events.some(
        (e) =>
          e.type === "session:status" &&
          e.status === "error" &&
          typeof e.error === "string" &&
          /stalled/i.test(e.error),
      ),
    ).toBe(true);
  });

  it("abortRunningTurns stops in-flight sessions except permission waiters", async () => {
    const { store, hub, registry, home } = setup();
    const waiting = store.create({ workdir: "/tmp/wait", model: "m1" });
    const running = store.create({ workdir: "/tmp/run", model: "m1" });
    const permissionSeen = Promise.withResolvers<void>();
    const original = hub.broadcast.bind(hub);
    hub.broadcast = (sessionId, event) => {
      if (event.type === "permission:request" && sessionId === waiting.id) {
        permissionSeen.resolve();
      }
      return original(sessionId, event);
    };

    let agentsCreated = 0;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      stallMs: 60_000,
      createAgent: async (opts) => {
        agentsCreated += 1;
        const isWaiting = agentsCreated === 1;
        return {
          sendMessage: async () => {
            if (isWaiting) {
              await opts.canUseTool?.({
                toolName: "Bash",
                permissionMode: "default",
                toolInput: { command: "ls" },
              });
              return;
            }
            await new Promise(() => {});
          },
          abortMessage: () => {},
          dispose: async () => {},
        };
      },
    });

    void runner.sendMessage(waiting.id, "need perm");
    await permissionSeen.promise;
    void runner.sendMessage(running.id, "hang");
    await expect.poll(() => store.get(running.id)?.status).toBe("running");

    const result = await runner.abortRunningTurns("Interrupted after sleep");
    expect(result.aborted).toBe(1);
    await expect.poll(() => store.get(running.id)?.status).toBe("idle");
    expect(store.get(waiting.id)?.status).toBe("running");
  });

  it("shutdown aborts all running turns including permission waiters", async () => {
    const { store, hub, registry, home } = setup();
    const waiting = store.create({ workdir: "/tmp/wait", model: "m1" });
    const running = store.create({ workdir: "/tmp/run", model: "m1" });
    const permissionSeen = Promise.withResolvers<void>();
    const original = hub.broadcast.bind(hub);
    hub.broadcast = (sessionId, event) => {
      if (event.type === "permission:request" && sessionId === waiting.id) {
        permissionSeen.resolve();
      }
      return original(sessionId, event);
    };

    let agentsCreated = 0;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      stallMs: 60_000,
      createAgent: async (opts) => {
        agentsCreated += 1;
        const isWaiting = agentsCreated === 1;
        return {
          sendMessage: async () => {
            if (isWaiting) {
              await opts.canUseTool?.({
                toolName: "Bash",
                permissionMode: "default",
                toolInput: { command: "ls" },
              });
              return;
            }
            await new Promise(() => {});
          },
          abortMessage: () => {},
          dispose: async () => {},
        };
      },
    });

    void runner.sendMessage(waiting.id, "need perm");
    await permissionSeen.promise;
    void runner.sendMessage(running.id, "hang");
    await expect.poll(() => store.get(running.id)?.status).toBe("running");

    const result = await runner.shutdown();
    expect(result.aborted).toBe(2);
    await expect.poll(() => store.get(running.id)?.status).toBe("idle");
    await expect.poll(() => store.get(waiting.id)?.status).toBe("idle");
  });

  it("getMessages enriches the last assistant message's file_history with diff stats (session reload)", async () => {
    const { store, hub, registry, home } = setup();
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-reload-"));
    const filePath = path.join(workdir, "app.js");
    const snapshotPath = path.join(workdir, "snap.txt");
    fs.writeFileSync(filePath, "const a = 1;\nconst b = 2;\n");
    fs.writeFileSync(snapshotPath, "const a = 1;\n");
    const session = store.create({ workdir, model: "m1" });

    const messages = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "改" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          {
            type: "file_history",
            snapshots: [
              {
                filePath,
                snapshotPath,
                operation: "modify",
                timestamp: 1,
              },
            ],
          },
        ],
      },
    ];
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      idleTtlMs: 60_000,
      createAgent: async () => ({
        sendMessage: async () => {},
        dispose: async () => {},
        getMessages: () => [],
      }),
      // Session reload with no live agent: serve history from disk. The disk
      // lookup uses the SDK's waveSessionId, not the server store's session id.
      loadMainSessionFromDisk: async (id) => {
        expect(id).toBe("wave-reload");
        return { messages };
      },
    });
    store.setWaveSessionId(session.id, "wave-reload");

    // Simulate a session reload (switching back to this session).
    const reloaded = (await runner.getMessages(session.id)) as Array<{
      id: string;
      blocks: Array<{ type?: string; snapshots?: Array<{ additions?: number; deletions?: number }> }>;
    }>;
    const last = reloaded[reloaded.length - 1];
    const block = last.blocks.find((b) => b.type === "file_history");
    expect(block).toBeDefined();
    expect(block!.snapshots![0].additions).toBe(1);
    expect(block!.snapshots![0].deletions).toBe(0);

    fs.rmSync(workdir, { recursive: true, force: true });
  });
});
