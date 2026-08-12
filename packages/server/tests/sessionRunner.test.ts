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
import { createSessionRunner, type SessionAgent } from "../src/sessionRunner.js";
import { createSessionStore } from "../src/sessionStore.js";
import { createWsHub } from "../src/wsHub.js";

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

  it("recreates agent when active model changes", async () => {
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
      createAgent: async (options) => {
        const model = options.model ?? "unknown";
        createdModels.push(model);
        return {
          sendMessage: async () => {
            // Drive idle via callback path is optional; mark idle for next send.
            store.updateStatus(session.id, "idle");
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

    registry.setActive("openai-compatible", "gpt-4.1-mini");
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
      createAgent: async () => {
        createCount += 1;
        return {
          sendMessage: async () => {
            store.updateStatus(session.id, "idle");
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
});
