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
});
