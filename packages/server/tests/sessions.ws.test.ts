import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import {
  createProviderRegistry,
  loadProvidersConfig,
  saveProvidersConfig,
  type AiProvider,
  type AuthStatus,
  type GatewayResolution,
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

type WsEvent = Record<string, unknown> & { type: string };

describe("sessions + websocket streaming", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  it("POST message streams message:delta then message:completed over WS", async () => {
    const createAgent: CreateAgent = async (opts) => {
      const agent: SessionAgent = {
        sendMessage: async () => {
          opts.callbacks?.onLoadingChange?.(true);
          opts.callbacks?.onAssistantMessageAdded?.("m1");
          opts.callbacks?.onAssistantContentUpdated?.({
            messageId: "m1",
            chunk: "hi",
            stage: "streaming",
          });
          opts.callbacks?.onAssistantContentUpdated?.({
            messageId: "m1",
            chunk: "",
            stage: "end",
          });
          opts.callbacks?.onLoadingChange?.(false);
        },
        dispose: async () => {},
      };
      return agent;
    };

    const app = await listenSessionsApp({ createAgent });
    server = app.server;
    home = app.home;

    const sessionRes = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: home }),
    });
    expect(sessionRes.status).toBe(200);
    const session = (await sessionRes.json()) as { id: string };
    expect(session.id).toBeTruthy();

    const { ready, events } = openWsCollector(app.baseUrl, session.id, {
      minCount: 2,
      filter: (e) => e.type === "message:delta" || e.type === "message:completed",
    });
    await ready;

    const msgRes = await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(msgRes.status).toBe(200);
    expect(await msgRes.json()).toEqual({ accepted: true });

    const received = await events;
    expect(received).toEqual([
      {
        type: "message:delta",
        messageId: "m1",
        text: "hi",
        stage: "streaming",
        sessionId: session.id,
      },
      {
        type: "message:delta",
        messageId: "m1",
        text: "",
        stage: "end",
        sessionId: session.id,
      },
      { type: "message:completed", messageId: "m1", sessionId: session.id },
    ]);
  });

  it("broadcast includes sessionId and * subscriber receives it", async () => {
    const createAgent: CreateAgent = async (opts) => {
      const agent: SessionAgent = {
        sendMessage: async () => {
          opts.callbacks?.onAssistantContentUpdated?.({
            messageId: "m1",
            chunk: "hi",
            stage: "streaming",
          });
          opts.callbacks?.onAssistantContentUpdated?.({
            messageId: "m1",
            chunk: "",
            stage: "end",
          });
        },
        dispose: async () => {},
      };
      return agent;
    };

    const app = await listenSessionsApp({ createAgent });
    server = app.server;
    home = app.home;

    const sessionRes = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: home }),
    });
    const session = (await sessionRes.json()) as { id: string };

    const { ready, events } = openWsCollector(app.baseUrl, "*", {
      minCount: 1,
      filter: (e) => e.type === "message:delta" && e.stage === "streaming",
    });
    await ready;

    await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });

    const [first] = await events;
    expect(first.sessionId).toBe(session.id);
    expect(first).toMatchObject({
      type: "message:delta",
      messageId: "m1",
      text: "hi",
      stage: "streaming",
    });
  });

  it("forwards compaction and subagent callbacks over WS", async () => {
    const compacted = [
      {
        id: "c1",
        role: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [{ type: "compact", content: "summary" }],
      },
    ];

    const createAgent: CreateAgent = async (opts) => {
      const agent: SessionAgent = {
        sendMessage: async () => {
          opts.callbacks?.onCompactionStateChange?.(true);
          opts.callbacks?.onCompactBlockAdded?.("summary");
          opts.callbacks?.onCompactionStateChange?.(false);
          opts.callbacks?.onSubagentAssistantMessageAdded?.("sa1", "sm1");
          opts.callbacks?.onSubagentAssistantContentUpdated?.({
            subagentId: "sa1",
            messageId: "sm1",
            chunk: "from-sub",
            stage: "streaming",
          });
          opts.callbacks?.onSubagentToolBlockUpdated?.("sa1", {
            messageId: "sm1",
            id: "t1",
            name: "Read",
            stage: "end",
            success: true,
          });
          opts.callbacks?.onAssistantContentUpdated?.({
            messageId: "m1",
            chunk: "",
            stage: "end",
          });
        },
        dispose: async () => {},
        getMessages: () => compacted,
      };
      return agent;
    };

    const app = await listenSessionsApp({ createAgent });
    server = app.server;
    home = app.home;

    const sessionRes = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: home }),
    });
    const session = (await sessionRes.json()) as { id: string };

    const { ready, events } = openWsCollector(app.baseUrl, session.id, {
      minCount: 5,
      filter: (e) =>
        e.type === "compaction:state" ||
        e.type === "messages:replace" ||
        e.type === "subagent:assistant:message" ||
        e.type === "subagent:message:delta" ||
        e.type === "subagent:tool:update",
    });
    await ready;

    await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "compact please" }),
    });

    const received = await events;
    expect(received).toEqual(
      expect.arrayContaining([
        { type: "compaction:state", isCompacting: true, sessionId: session.id },
        { type: "messages:replace", messages: compacted, sessionId: session.id },
        { type: "compaction:state", isCompacting: false, sessionId: session.id },
        {
          type: "subagent:assistant:message",
          subagentId: "sa1",
          messageId: "sm1",
          sessionId: session.id,
        },
        {
          type: "subagent:message:delta",
          subagentId: "sa1",
          messageId: "sm1",
          text: "from-sub",
          stage: "streaming",
          sessionId: session.id,
        },
        {
          type: "subagent:tool:update",
          subagentId: "sa1",
          params: {
            messageId: "sm1",
            id: "t1",
            name: "Read",
            stage: "end",
            success: true,
          },
          sessionId: session.id,
        },
      ]),
    );
  });

  it("canUseTool hangs until POST permission allow resolves", async () => {
    let permissionPromise: Promise<{ behavior: string }> | undefined;
    let resolveSend: (() => void) | undefined;
    const sendDone = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });

    const createAgent: CreateAgent = async (opts) => {
      const agent: SessionAgent = {
        sendMessage: async () => {
          if (!opts.canUseTool) {
            throw new Error("expected canUseTool");
          }
          permissionPromise = opts.canUseTool({
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "ls" },
          });
          const decision = await permissionPromise;
          expect(decision.behavior).toBe("allow");
          resolveSend?.();
        },
        dispose: async () => {},
      };
      return agent;
    };

    const app = await listenSessionsApp({ createAgent });
    server = app.server;
    home = app.home;

    const sessionRes = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: home }),
    });
    const session = (await sessionRes.json()) as { id: string };

    const { ready, events: permissionEvents } = openWsCollector(
      app.baseUrl,
      session.id,
      {
        minCount: 1,
        filter: (e) => e.type === "permission:request",
      },
    );
    await ready;

    void fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "run ls" }),
    });

    const [permissionEvent] = await permissionEvents;
    expect(permissionEvent.type).toBe("permission:request");
    expect(permissionEvent.toolName).toBe("Bash");
    expect(typeof permissionEvent.permissionId).toBe("string");
    expect(typeof permissionEvent.description).toBe("string");

    expect(permissionPromise).toBeTruthy();
    let settled = false;
    void permissionPromise!.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);

    const allowRes = await fetch(
      `${app.baseUrl}/sessions/${session.id}/permissions/${String(permissionEvent.permissionId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "allow" }),
      },
    );
    expect(allowRes.status).toBe(200);

    await sendDone;
    expect(settled).toBe(true);
  });

  it("second POST message while running is queued then processed", async () => {
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const seen: string[] = [];

    const createAgent: CreateAgent = async (opts) => ({
      sendMessage: async (content: string) => {
        seen.push(content);
        if (content === "first") {
          await sendGate;
        }
        opts.callbacks?.onAssistantContentUpdated?.({
          messageId: "m1",
          chunk: "",
          stage: "end",
        });
      },
      dispose: async () => {},
    });

    const app = await listenSessionsApp({ createAgent });
    server = app.server;
    home = app.home;

    const sessionRes = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: home }),
    });
    const session = (await sessionRes.json()) as { id: string };

    const first = await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "first" }),
    });
    expect(first.status).toBe(200);

    // Wait until session is marked running (fire-and-forget starts synchronously).
    await expect
      .poll(() => app.ctx.store.get(session.id)?.status)
      .toBe("running");

    const second = await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "second" }),
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ accepted: true });
    expect(seen).toEqual(["first"]);

    releaseSend();
    await expect
      .poll(() => app.ctx.store.get(session.id)?.status)
      .toBe("idle");
    await expect.poll(() => seen.slice()).toEqual(["first", "second"]);
  });

  it("sendMessage that returns without stage end still releases busy", async () => {
    const createAgent: CreateAgent = async () => ({
      sendMessage: async () => {
        // Simulate SDK swallowing an error / early return with no end callback.
      },
      dispose: async () => {},
    });

    const app = await listenSessionsApp({ createAgent });
    server = app.server;
    home = app.home;

    const sessionRes = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: home }),
    });
    const session = (await sessionRes.json()) as { id: string };

    const first = await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(first.status).toBe(200);

    await expect
      .poll(() => app.ctx.store.get(session.id)?.status)
      .toBe("idle");

    const second = await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "again" }),
    });
    expect(second.status).toBe(200);
  });

  it("401 from resolveGateway broadcasts auth:changed and marks session error", async () => {
    const createAgent: CreateAgent = async () => ({
      sendMessage: async () => {},
      dispose: async () => {},
    });

    const app = await listenSessionsApp({
      createAgent,
      resolveGateway: async () => {
        const err = new Error("Unauthorized") as Error & { status: number };
        err.status = 401;
        throw err;
      },
    });
    server = app.server;
    home = app.home;

    const sessionRes = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: home }),
    });
    const session = (await sessionRes.json()) as { id: string };

    const { ready, events } = openWsCollector(app.baseUrl, session.id, {
      minCount: 2,
      filter: (e) =>
        e.type === "auth:changed" ||
        (e.type === "session:status" && e.status === "error"),
    });
    await ready;

    const msgRes = await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(msgRes.status).toBe(200);
    expect(await msgRes.json()).toEqual({ accepted: true });

    const received = await events;
    expect(received.some((e) => e.type === "auth:changed")).toBe(true);
    expect(
      received.some((e) => e.type === "session:status" && e.status === "error"),
    ).toBe(true);
  });
});

function openWsCollector(
  baseUrl: string,
  sessionId: string,
  options: {
    minCount: number;
    filter?: (e: WsEvent) => boolean;
  },
): { ready: Promise<void>; events: Promise<WsEvent[]> } {
  const wsUrl =
    baseUrl.replace(/^http/, "ws") +
    `/ws?sessionId=${encodeURIComponent(sessionId)}`;
  const collected: WsEvent[] = [];
  let resolveReady!: () => void;
  let resolveEvents!: (events: WsEvent[]) => void;
  let rejectEvents!: (err: Error) => void;

  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const events = new Promise<WsEvent[]>((resolve, reject) => {
    resolveEvents = resolve;
    rejectEvents = reject;
  });

  const ws = new WebSocket(wsUrl);
  const timer = setTimeout(() => {
    ws.close();
    rejectEvents(
      new Error(
        `timeout waiting for ${options.minCount} WS events, got ${collected.length}`,
      ),
    );
  }, 5000);

  ws.on("open", () => resolveReady());
  ws.on("message", (data) => {
    const event = JSON.parse(String(data)) as WsEvent;
    if (options.filter && !options.filter(event)) {
      return;
    }
    collected.push(event);
    if (collected.length >= options.minCount) {
      clearTimeout(timer);
      ws.close();
      resolveEvents(collected);
    }
  });
  ws.on("error", (err) => {
    clearTimeout(timer);
    rejectEvents(err instanceof Error ? err : new Error(String(err)));
  });

  return { ready, events };
}

async function listenSessionsApp(options: {
  createAgent: CreateAgent;
  resolveGateway?: (modelId: string) => Promise<GatewayResolution>;
}): Promise<{ server: Server; baseUrl: string; home: string; ctx: AppContext }> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-server-"));
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
      if (options.resolveGateway) {
        return options.resolveGateway(modelId);
      }
      return {
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-test",
        model: modelId,
      };
    },
  };

  const registry = createProviderRegistry([provider], home);
  const sessions = createSessionServices({
    home,
    registry,
    createAgent: options.createAgent,
  });
  const ctx: AppContext = { home, registry, ...sessions };
  const server = createApp(ctx);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP address");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    home,
    ctx,
  };
}
