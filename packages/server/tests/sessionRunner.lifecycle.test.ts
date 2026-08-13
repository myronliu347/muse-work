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
} from "../src/sessionRunner.js";
import { createSessionStore } from "../src/sessionStore.js";
import { createWsHub, type WsEvent } from "../src/wsHub.js";

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
    const { store, hub, registry } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    store.setWaveSessionId(session.id, "broken-wave-id");

    let calls = 0;
    const runner = createSessionRunner({
      store,
      hub,
      registry,
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

    await runner.getMessages(session.id);
    expect(calls).toBe(2);
    expect(store.get(session.id)?.waveSessionId).toBe("new-wave-id");
  });

  it("idle TTL destroys agent but keeps waveSessionId", async () => {
    const { store, hub, registry } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    store.setWaveSessionId(session.id, "wave-keep");

    const restoreIds: Array<string | undefined> = [];
    let disposeCount = 0;

    const runner = createSessionRunner({
      store,
      hub,
      registry,
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
          sessionId: "wave-keep",
        };
      },
    });

    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => restoreIds.length).toBe(1);
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");
    expect(restoreIds[0]).toBe("wave-keep");

    await expect.poll(() => disposeCount).toBe(1);
    expect(store.get(session.id)?.waveSessionId).toBe("wave-keep");
    expect(store.get(session.id)).toBeDefined();

    await runner.getMessages(session.id);
    expect(restoreIds.length).toBe(2);
    expect(restoreIds[1]).toBe("wave-keep");
  });

  it("model change destroys on next ensure and passes restoreSessionId", async () => {
    const { store, hub, registry } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    store.setWaveSessionId(session.id, "wave-1");

    const createdModels: string[] = [];
    const restoreIds: Array<string | undefined> = [];
    let disposeCount = 0;

    const runner = createSessionRunner({
      store,
      hub,
      registry,
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

    await runner.getMessages(session.id);
    expect(createdModels).toEqual(["m1"]);
    expect(restoreIds[0]).toBe("wave-1");

    store.update(session.id, { model: "m2" });
    await runner.getMessages(session.id);

    expect(disposeCount).toBe(1);
    expect(createdModels).toEqual(["m1", "m2"]);
    expect(restoreIds[1]).toBe("wave-1");
  });

  it("sets unreadDone when non-active session becomes idle", async () => {
    const { store, hub, registry } = setup();
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
    const { store, hub, registry } = setup();
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

  it("getMessages re-arms idle TTL after clear; agent destroyed, waveSessionId kept", async () => {
    const { store, hub, registry } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    store.setWaveSessionId(session.id, "wave-rearm");

    let disposeCount = 0;
    const restoreIds: Array<string | undefined> = [];

    const runner = createSessionRunner({
      store,
      hub,
      registry,
      idleTtlMs: 40,
      createAgent: async (opts) => {
        restoreIds.push(opts.restoreSessionId);
        return {
          sendMessage: async () => {},
          dispose: async () => {
            disposeCount += 1;
          },
          getMessages: () => [{ id: "m" }],
          sessionId: "wave-rearm",
        };
      },
    });

    // ensureAgent/getMessages clearIdleTimer then must re-arm.
    await runner.getMessages(session.id);
    expect(restoreIds).toEqual(["wave-rearm"]);
    expect(store.get(session.id)?.status).toBe("idle");

    await expect.poll(() => disposeCount).toBe(1);
    expect(store.get(session.id)?.waveSessionId).toBe("wave-rearm");
    expect(store.get(session.id)).toBeDefined();
  });

  it("keeps status running after assistant stage end while loading stays true", async () => {
    const { store, hub, registry } = setup();
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

  it("idle TTL does not destroy while status is running", async () => {
    const { store, hub, registry } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });

    let disposeCount = 0;

    const runner = createSessionRunner({
      store,
      hub,
      registry,
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
    const { store, hub, registry } = setup();
    const session = store.create({ workdir: "/tmp", model: "m1" });
    const hang = Promise.withResolvers<void>();

    const runner = createSessionRunner({
      store,
      hub,
      registry,
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
    const { store, hub, registry } = setup();
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
});
