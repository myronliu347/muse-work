import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
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
import { createApp } from "../src/app.js";
import { closeTestApp } from "./helpers.js";
import {
  createSessionServices,
  type AppContext,
  type CreateAgent,
  type SessionAgent,
} from "../src/createAppContext.js";

function stubAgent(overrides: Partial<SessionAgent> = {}): SessionAgent {
  return {
    sendMessage: async () => {},
    dispose: async () => {},
    getMessages: () => [],
    ...overrides,
  };
}

describe("session control routes", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  async function listen(createAgent: CreateAgent) {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ctrl-routes-"));
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
    const registry = createProviderRegistry([provider], home);
    const sessions = createSessionServices({ home, registry, createAgent });
    const ctx: AppContext = { home, registry, ...sessions };
    const httpServer = createApp(ctx);
    await new Promise<void>((resolve, reject) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
      httpServer.on("error", reject);
    });
    const addr = httpServer.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP");
    server = httpServer;
    return {
      baseUrl: `http://127.0.0.1:${addr.port}`,
      ctx,
      home,
    };
  }

  it("POST compact and clear, GET checkpoints, POST rewind", async () => {
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
    ];
    let compactCalls = 0;
    let clearCalls = 0;
    let truncatedTo: number | undefined;
    const app = await listen(async () =>
      stubAgent({
        getMessages: () => messages,
        compact: async () => {
          compactCalls += 1;
        },
        clearMessages: async () => {
          clearCalls += 1;
        },
        truncateHistory: async (index) => {
          truncatedTo = index;
        },
      }),
    );

    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: app.home }),
    });
    expect(created.status).toBe(200);
    const session = (await created.json()) as { id: string };

    const compactRes = await fetch(
      `${app.baseUrl}/sessions/${session.id}/compact`,
      { method: "POST" },
    );
    expect(compactRes.status).toBe(200);
    expect(compactCalls).toBe(1);

    const clearRes = await fetch(
      `${app.baseUrl}/sessions/${session.id}/clear`,
      { method: "POST" },
    );
    expect(clearRes.status).toBe(200);
    expect(clearCalls).toBe(1);

    const checkpointsRes = await fetch(
      `${app.baseUrl}/sessions/${session.id}/rewind-checkpoints`,
    );
    expect(checkpointsRes.status).toBe(200);
    expect(await checkpointsRes.json()).toEqual({
      checkpoints: [{ id: "u1", content: "first" }],
    });

    const rewindRes = await fetch(
      `${app.baseUrl}/sessions/${session.id}/rewind`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: "u1" }),
      },
    );
    expect(rewindRes.status).toBe(200);
    expect(await rewindRes.json()).toEqual({
      ok: true,
      inputContent: "first",
    });
    expect(truncatedTo).toBe(0);
  });

  it("GET slash-commands returns the fixed system list", async () => {
    const app = await listen(async () => stubAgent());
    const created = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: app.home }),
    });
    const session = (await created.json()) as { id: string };
    const res = await fetch(
      `${app.baseUrl}/sessions/${session.id}/slash-commands`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { commands: Array<{ name: string }> };
    expect(body.commands.map((c) => c.name)).toEqual([
      "compact",
      "clear",
      "rewind",
      "mcp",
      "status",
      "tasks",
      "workflows",
    ]);
  });
});
