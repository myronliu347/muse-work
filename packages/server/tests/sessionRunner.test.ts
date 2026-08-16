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
import { createSessionRunner, type SessionAgent } from "../src/services/sessionRunner.js";
import { createSessionStore } from "../src/services/sessionStore.js";
import { createWsHub } from "../src/services/wsHub.js";
import { saveMuseSettings } from "../src/services/museSettings.js";

describe("sessionRunner concurrency / dispose", () => {
  let home: string | undefined;

  afterEach(() => {
    if (home) {
      fs.rmSync(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it("dispose during createAgent does not retain orphan agent", async () => {
    let resolveCreate!: (agent: SessionAgent) => void;
    const createStarted = Promise.withResolvers<void>();
    let disposedCount = 0;

    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );

    const provider: AiProvider = {
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
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async () => {
        createStarted.resolve();
        return new Promise<SessionAgent>((resolve) => {
          resolveCreate = resolve;
        });
      },
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });

    const accepted = await runner.sendMessage(session.id, "hello");
    expect(accepted).toEqual({ accepted: true });

    await createStarted.promise;
    await runner.disposeSession(session.id);
    expect(store.get(session.id)).toBeUndefined();

    const lateAgent: SessionAgent = {
      sendMessage: async () => {
        throw new Error("orphan agent should not receive messages");
      },
      dispose: async () => {
        disposedCount += 1;
      },
    };
    resolveCreate(lateAgent);

    await expect.poll(() => disposedCount).toBe(1);

    expect(store.get(session.id)).toBeUndefined();
    await expect(runner.sendMessage(session.id, "again")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("recreates agent when session model changes", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-model-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );

    const createdModels: string[] = [];
    const disposedModels: string[] = [];

    const provider: AiProvider = {
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
        return [
          { id: "gpt-4.1", label: "GPT-4.1" },
          { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
        ];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async (options) => {
        const model = options.model ?? "unknown";
        createdModels.push(model);
        return {
          sendMessage: async () => {
            // Leave running so runTurn marks idle after send settles.
          },
          dispose: async () => {
            disposedModels.push(model);
          },
        };
      },
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });

    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => createdModels.length).toBe(1);
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");
    expect(createdModels).toEqual(["gpt-4.1"]);

    store.update(session.id, { model: "gpt-4.1-mini" });
    await runner.sendMessage(session.id, "again");
    await expect.poll(() => createdModels.length).toBe(2);
    expect(createdModels).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
    expect(disposedModels).toEqual(["gpt-4.1"]);
  });

  it("recreates agent when credential fingerprint changes (e.g. token renew)", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-cred-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );

    let fingerprint = "cred-v1";
    let createCount = 0;
    let disposeCount = 0;

    const provider: AiProvider = {
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
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          credentialFingerprint: fingerprint,
          model: modelId,
        };
      },
    };

    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const session = store.create({ workdir: home, model: "gpt-4.1" });
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async () => {
        createCount += 1;
        return {
          sendMessage: async () => {
            // Leave running so runTurn marks idle after send settles.
          },
          dispose: async () => {
            disposeCount += 1;
          },
        };
      },
    });

    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => createCount).toBe(1);
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");

    fingerprint = "cred-v2";
    await runner.sendMessage(session.id, "again");
    await expect.poll(() => createCount).toBe(2);
    expect(disposeCount).toBe(1);
  });

  it("sendMessage forwards base64 images to the agent", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-img-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );

    let seen: { content: string; images?: unknown } | undefined;
    const provider: AiProvider = {
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
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async () => ({
        sendMessage: async (content, images) => {
          seen = { content, images };
        },
        dispose: async () => {},
      }),
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });
    await runner.sendMessage(session.id, "see this", [
      { data: "data:image/png;base64,abc", mediaType: "image/png" },
    ]);
    await expect.poll(() => seen).toBeTruthy();
    expect(seen).toEqual({
      content: "see this",
      images: [
        { path: "data:image/png;base64,abc", mimeType: "image/png" },
      ],
    });
  });

  it("abortMessage stops the in-flight agent and marks session idle", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-abort-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );

    let abortCalls = 0;
    let releaseSend!: () => void;
    const sendStarted = Promise.withResolvers<void>();

    const provider: AiProvider = {
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
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    const store = createSessionStore({ home });
    const hub = createWsHub();
    const events: Array<{ type: string; loading?: boolean; status?: string }> =
      [];
    const originalBroadcast = hub.broadcast.bind(hub);
    hub.broadcast = (sessionId, event) => {
      events.push(event as { type: string; loading?: boolean; status?: string });
      return originalBroadcast(sessionId, event);
    };

    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async () => ({
        sendMessage: async () => {
          sendStarted.resolve();
          await new Promise<void>((resolve) => {
            releaseSend = resolve;
          });
        },
        abortMessage: () => {
          abortCalls += 1;
          releaseSend();
        },
        dispose: async () => {},
      }),
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });
    await runner.sendMessage(session.id, "hello");
    await sendStarted.promise;
    await expect.poll(() => store.get(session.id)?.status).toBe("running");

    await runner.abortMessage(session.id);
    expect(abortCalls).toBe(1);
    expect(store.get(session.id)?.status).toBe("idle");
    expect(events.some((e) => e.type === "loading" && e.loading === false)).toBe(
      true,
    );
    expect(
      events.some((e) => e.type === "session:status" && e.status === "idle"),
    ).toBe(true);

    await expect.poll(() => store.get(session.id)?.status).toBe("idle");
  });

  it("deleteQueuedMessageById removes a queued message from the SDK agent", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-delq-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );

    const provider: AiProvider = {
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
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    const removedIds: string[] = [];
    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async () => ({
        sendMessage: async () => {},
        removeQueuedMessageById: (id) => {
          removedIds.push(id);
          return id === "mq-1";
        },
        dispose: async () => {},
      }),
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });
    // Prime the agent so it exists in the agents map.
    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");

    expect(await runner.deleteQueuedMessageById(session.id, "mq-1")).toEqual({
      ok: true,
    });
    expect(await runner.deleteQueuedMessageById(session.id, "mq-999")).toEqual({
      ok: false,
    });
    expect(removedIds).toEqual(["mq-1", "mq-999"]);

    await expect(
      runner.deleteQueuedMessageById("does-not-exist", "mq-1"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("passes local superpowers plugin when enabled", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-sp-on-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );
    saveMuseSettings({ version: 1, plugins: { superpowers: true } }, home);

    let seenPlugins: unknown;
    const provider: AiProvider = {
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
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async (options) => {
        seenPlugins = options.plugins;
        return {
          sendMessage: async () => {},
          dispose: async () => {},
        };
      },
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });
    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => seenPlugins !== undefined).toBe(true);
    expect(seenPlugins).toEqual([
      {
        type: "local",
        path: expect.stringMatching(/plugins[\\/]superpowers$/),
      },
    ]);
  });

  it("omits plugins when superpowers is disabled and recreates on toggle", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-sp-off-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );
    saveMuseSettings({ version: 1, plugins: { superpowers: true } }, home);

    const pluginSnapshots: unknown[] = [];
    let disposeCount = 0;
    const provider: AiProvider = {
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
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async (options) => {
        pluginSnapshots.push(options.plugins);
        return {
          sendMessage: async () => {},
          dispose: async () => {
            disposeCount += 1;
          },
        };
      },
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });
    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => pluginSnapshots.length).toBe(1);
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");
    expect(pluginSnapshots[0]).toBeDefined();

    saveMuseSettings({ version: 1, plugins: { superpowers: false } }, home);
    runner.invalidateAgentIdentities();
    await runner.sendMessage(session.id, "again");
    await expect.poll(() => pluginSnapshots.length).toBe(2);
    expect(pluginSnapshots[1]).toBeUndefined();
    expect(disposeCount).toBe(1);
  });

  it("passes a per-session logger into createAgent", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-agent-log-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );

    const provider: AiProvider = {
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
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    let called = false;
    let seenLogger: { error?: unknown; info?: unknown; debug?: unknown } | undefined;
    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async (options) => {
        called = true;
        seenLogger = options.logger;
        return {
          sendMessage: async () => {},
          dispose: async () => {},
        };
      },
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });
    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => called).toBe(true);
    expect(seenLogger?.error).toBeTypeOf("function");
    expect(seenLogger?.info).toBeTypeOf("function");
    expect(seenLogger?.debug).toBeTypeOf("function");
  });

  it("getRuntimeState exposes SDK loading and queued messages", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-runtime-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );

    const provider: AiProvider = {
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
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async () => ({
        sendMessage: async () => {},
        isLoading: () => true,
        queuedMessages: () => [{ id: "mq-1", content: "queued text" }],
        dispose: async () => {},
      }),
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });
    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");

    expect(await runner.getRuntimeState(session.id)).toEqual({
      loading: true,
      queuedMessages: [{ id: "mq-1", content: "queued text" }],
    });

    await expect(
      runner.getRuntimeState("does-not-exist"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("updateQueuedMessage patches a queued message on the SDK agent", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-updq-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );

    const provider: AiProvider = {
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
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    const patches: Array<{ id: string; patch: unknown }> = [];
    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async () => ({
        sendMessage: async () => {},
        updateQueuedMessageById: (id, patch) => {
          patches.push({ id, patch });
          return id === "mq-1";
        },
        dispose: async () => {},
      }),
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });
    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");

    expect(
      await runner.updateQueuedMessage(session.id, "mq-1", { content: "new" }),
    ).toEqual({ ok: true });
    expect(
      await runner.updateQueuedMessage(session.id, "mq-999", { content: "x" }),
    ).toEqual({ ok: false });
    expect(patches).toEqual([
      { id: "mq-1", patch: { content: "new" } },
      { id: "mq-999", patch: { content: "x" } },
    ]);

    await expect(
      runner.updateQueuedMessage("does-not-exist", "mq-1", { content: "x" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
