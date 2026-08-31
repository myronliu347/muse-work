import { describe, it, expect, afterEach, vi } from "vitest";
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
} from "../src/services/appContext.js";

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

  it("generates AI title via askBtw on first message and broadcasts session:titled", async () => {
    const askBtw = vi.fn(async () => '"修复登录页白屏问题"');
    const createAgent: CreateAgent = async () => {
      const agent: SessionAgent = {
        sendMessage: async () => {},
        askBtw,
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

    const { ready, events } = openWsCollector(app.baseUrl, session.id, {
      minCount: 1,
      filter: (e) => e.type === "session:titled",
    });
    await ready;

    await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "帮我修复登录页白屏问题" }),
    });

    const [titled] = await events;
    expect(titled).toMatchObject({
      type: "session:titled",
      sessionId: session.id,
      title: "修复登录页白屏问题",
    });
    expect(askBtw).toHaveBeenCalledTimes(1);
    await expect
      .poll(() => app.ctx.store.get(session.id)?.title)
      .toBe("修复登录页白屏问题");
  });

  it("falls back to truncated title when askBtw throws", async () => {
    const createAgent: CreateAgent = async () => {
      const agent: SessionAgent = {
        sendMessage: async () => {},
        askBtw: async () => {
          throw new Error("boom");
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

    await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "帮我修复登录页白屏问题" }),
    });

    await expect
      .poll(() => app.ctx.store.get(session.id)?.title)
      .toBe("帮我修复登录页白屏问题");
  });

  it("does not overwrite a title renamed while AI generation runs", async () => {
    const askBtw = vi.fn(
      async () => new Promise<string>((resolve) => setTimeout(resolve, 200)),
    );
    const createAgent: CreateAgent = async () => {
      const agent: SessionAgent = {
        sendMessage: async () => {},
        askBtw,
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

    await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "帮我修复登录页白屏问题" }),
    });

    // Rename while the AI generation is in flight.
    await fetch(`${app.baseUrl}/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "手动标题" }),
    });

    // Give the AI generation time to (attempt to) complete.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(app.ctx.store.get(session.id)?.title).toBe("手动标题");
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

  it("forwards SDK error blocks without treating them as a fatal session error", async () => {
    const compactError =
      "Failed to compact conversation history: Compaction failed: the model produced no summary output. You may encounter context limit issues.";
    const createAgent: CreateAgent = async (opts) => ({
      sendMessage: async () => {
        opts.callbacks?.onLoadingChange?.(true);
        opts.callbacks?.onCompactionStateChange?.(true);
        opts.callbacks?.onErrorBlockAdded?.(compactError);
        opts.callbacks?.onCompactionStateChange?.(false);
        opts.callbacks?.onLoadingChange?.(false);
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

    const { ready, events } = openWsCollector(app.baseUrl, session.id, {
      minCount: 3,
      filter: (e) =>
        e.type === "error:block" ||
        e.type === "compaction:state" ||
        (e.type === "session:status" && e.status === "error"),
    });
    await ready;

    await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "continue" }),
    });

    const received = await events;
    expect(received).toEqual(
      expect.arrayContaining([
        {
          type: "compaction:state",
          isCompacting: true,
          sessionId: session.id,
        },
        { type: "error:block", error: compactError, sessionId: session.id },
        {
          type: "compaction:state",
          isCompacting: false,
          sessionId: session.id,
        },
      ]),
    );
    expect(
      received.some((e) => e.type === "session:status" && e.status === "error"),
    ).toBe(false);
  });

  it("attaches nested Agent transcripts on GET messages", async () => {
    const nested = [
      {
        id: "sm1",
        role: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [{ type: "text", content: "explored" }],
      },
    ];
    const parent = [
      {
        id: "m1",
        role: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [
          {
            type: "tool",
            id: "call-1",
            name: "Agent",
            stage: "end",
            compactParams: "Explore: 结构",
          },
        ],
      },
    ];

    const createAgent: CreateAgent = async (opts) => {
      const agent: SessionAgent = {
        sendMessage: async () => {
          opts.callbacks?.onToolBlockUpdated?.({
            messageId: "m1",
            id: "call-1",
            name: "Agent",
            stage: "running",
          });
          opts.callbacks?.onSubagentMessagesChange?.("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", nested);
          opts.callbacks?.onAssistantContentUpdated?.({
            messageId: "m1",
            chunk: "",
            stage: "end",
          });
        },
        dispose: async () => {},
        getMessages: () => parent,
      };
      return agent;
    };

    const app = await listenSessionsApp({
      createAgent,
      loadSubagentMessages: async (subagentId) =>
        subagentId === "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" ? nested : null,
    });
    server = app.server;
    home = app.home;

    const sessionRes = await fetch(`${app.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: home }),
    });
    const session = (await sessionRes.json()) as { id: string };

    await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "explore" }),
    });

    // The subagent id is bound synchronously inside the turn; poll GET until
    // the transcript is loaded from the injected loader.
    await expect
      .poll(
        async () => {
          const loaded = await fetch(
            `${app.baseUrl}/sessions/${session.id}/messages`,
          );
          const body = (await loaded.json()) as {
            messages: Array<{ blocks: Array<{ nestedMessages?: unknown }> }>;
          };
          return body.messages[0]?.blocks[0]?.nestedMessages;
        },
        { timeout: 3000 },
      )
      .toEqual(nested);
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
    expect(permissionEvent.toolInput).toEqual({ command: "ls" });

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

  it("AskUserQuestion permission carries toolInput and answer message", async () => {
    let permissionPromise: Promise<{ behavior: string; message?: string }> | undefined;
    let resolveSend: (() => void) | undefined;
    const sendDone = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    const questions = [
      {
        question: "Which?",
        header: "Choice",
        options: [{ label: "A" }, { label: "B" }],
      },
    ];

    const createAgent: CreateAgent = async (opts) => {
      const agent: SessionAgent = {
        sendMessage: async () => {
          if (!opts.canUseTool) {
            throw new Error("expected canUseTool");
          }
          permissionPromise = opts.canUseTool({
            toolName: "AskUserQuestion",
            permissionMode: "acceptEdits",
            toolInput: { questions },
            hidePersistentOption: true,
          });
          const decision = await permissionPromise;
          expect(decision.behavior).toBe("allow");
          expect(decision.message).toBe(JSON.stringify({ "Which?": "A" }));
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
      body: JSON.stringify({ content: "ask me" }),
    });

    const [permissionEvent] = await permissionEvents;
    expect(permissionEvent.toolName).toBe("AskUserQuestion");
    expect(permissionEvent.toolInput).toEqual({ questions });
    expect(permissionEvent.hidePersistentOption).toBe(true);

    const allowRes = await fetch(
      `${app.baseUrl}/sessions/${session.id}/permissions/${String(permissionEvent.permissionId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          behavior: "allow",
          message: JSON.stringify({ "Which?": "A" }),
        }),
      },
    );
    expect(allowRes.status).toBe(200);

    await sendDone;
    expect(permissionPromise).toBeTruthy();
  });

  it("bypassPermissions: AskUserQuestion still raises permission:request and waits for decision", async () => {
    let permissionPromise:
      | Promise<{ behavior: string; message?: string }>
      | undefined;
    let resolveSend: (() => void) | undefined;
    const sendDone = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    const questions = [
      {
        question: "Which?",
        header: "Choice",
        options: [{ label: "A" }, { label: "B" }],
      },
    ];

    const createAgent: CreateAgent = async (opts) => {
      const agent: SessionAgent = {
        sendMessage: async () => {
          if (!opts.canUseTool) {
            throw new Error("expected canUseTool");
          }
          permissionPromise = opts.canUseTool({
            toolName: "AskUserQuestion",
            permissionMode: "bypassPermissions",
            toolInput: { questions },
            hidePersistentOption: true,
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
      body: JSON.stringify({
        workdir: home,
        permissionMode: "bypassPermissions",
      }),
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
      body: JSON.stringify({ content: "ask me" }),
    });

    const [permissionEvent] = await permissionEvents;
    expect(permissionEvent.type).toBe("permission:request");
    expect(permissionEvent.toolName).toBe("AskUserQuestion");
    expect(permissionEvent.toolInput).toEqual({ questions });

    // bypass must NOT auto-allow the question: the turn waits for a decision.
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

  it("bypassPermissions: other tools are allowed without permission:request", async () => {
    let decision: { behavior: string } | undefined;
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
          decision = await opts.canUseTool({
            toolName: "Bash",
            permissionMode: "bypassPermissions",
            toolInput: { command: "ls" },
          });
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
      body: JSON.stringify({
        workdir: home,
        permissionMode: "bypassPermissions",
      }),
    });
    const session = (await sessionRes.json()) as { id: string };

    // Collect any permission:request events on the WS channel.
    const requests: WsEvent[] = [];
    const ws = new WebSocket(
      `${app.baseUrl.replace(/^http/, "ws")}/ws?sessionId=${encodeURIComponent(session.id)}`,
    );
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
    ws.on("message", (data) => {
      const event = JSON.parse(String(data)) as WsEvent;
      if (event.type === "permission:request") requests.push(event);
    });

    await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "run ls" }),
    });

    // sendMessage completes without any external permission decision.
    await sendDone;
    expect(decision).toEqual({ behavior: "allow" });

    await new Promise((r) => setTimeout(r, 100));
    expect(requests).toHaveLength(0);
    ws.close();
  });

  it("second POST message while running is queued then processed", async () => {
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const seen: string[] = [];
    // Mock the SDK's own serialized queue: while a turn is in flight, sendMessage
    // enqueues and returns; once loading drops, the next queued item is dispatched.
    let busy = false;
    const pending: string[] = [];

    const createAgent: CreateAgent = async (opts) => {
      const run = async (content: string) => {
        busy = true;
        opts.callbacks?.onLoadingChange?.(true);
        seen.push(content);
        if (content === "first") {
          await sendGate;
        }
        opts.callbacks?.onAssistantContentUpdated?.({
          messageId: "m1",
          chunk: "",
          stage: "end",
        });
        opts.callbacks?.onLoadingChange?.(false);
        busy = false;
        const next = pending.shift();
        if (next) {
          await run(next); // SDK tryDispatch chains the next queued message
        }
      };
      return {
        sendMessage: async (content: string) => {
          if (busy) {
            pending.push(content);
            return;
          }
          await run(content);
        },
        dispose: async () => {},
      };
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

  it("surfaces an error when SDK loading ends with no assistant output", async () => {
    const createAgent: CreateAgent = async (opts) => ({
      sendMessage: async () => {
        // Real SDK path: InteractionService setIsLoading(true/false) after an
        // empty/swallowed generation — no assistant, no error block.
        opts.callbacks?.onLoadingChange?.(true);
        opts.callbacks?.onLoadingChange?.(false);
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

    const { ready, events } = openWsCollector(app.baseUrl, session.id, {
      minCount: 1,
      filter: (e) => e.type === "error:block",
    });
    await ready;

    await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "改了么" }),
    });

    const received = await events;
    expect(received).toEqual([
      expect.objectContaining({
        type: "error:block",
        error: expect.stringMatching(/没有产生输出/),
        sessionId: session.id,
      }),
    ]);
    await expect
      .poll(() => app.ctx.store.get(session.id)?.status)
      .toBe("idle");
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

    const { ready, events } = openWsCollector(app.baseUrl, session.id, {
      minCount: 1,
      filter: (e) => e.type === "error:block",
    });
    await ready;

    const first = await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(first.status).toBe(200);

    await expect
      .poll(() => app.ctx.store.get(session.id)?.status)
      .toBe("idle");
    const received = await events;
    expect(received).toEqual([
      expect.objectContaining({
        type: "error:block",
        error: expect.stringMatching(/没有产生输出/),
        sessionId: session.id,
      }),
    ]);

    const second = await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "again" }),
    });
    expect(second.status).toBe(200);
  });

  it("does not report empty turn when loading callback arrives after sendMessage", async () => {
    // Race: the SDK's async onLoadingChange(true) may not have fired yet when
    // runTurn checks its fallback. That window must NOT be treated as a
    // finished empty turn (bogus "模型没有产生输出" error block).
    const createAgent: CreateAgent = async (opts) => {
      const cbs = opts.callbacks as {
        onLoadingChange?: (loading: boolean) => void;
        onAssistantContentUpdated?: (p: {
          messageId: string;
          chunk: string;
          stage: "streaming" | "end";
        }) => void;
      };
      return {
        sendMessage: async () => {
          // The SDK reports loading on a later tick, after sendMessage settles.
          setImmediate(() => cbs.onLoadingChange?.(true));
          setImmediate(() =>
            cbs.onAssistantContentUpdated?.({
              messageId: "m1",
              chunk: "hi",
              stage: "end",
            }),
          );
          setImmediate(() => cbs.onLoadingChange?.(false));
        },
        dispose: async () => {},
      };
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

    const errorEvents: Array<{ type?: string; error?: string }> = [];
    const origBroadcast = app.ctx.hub.broadcast.bind(app.ctx.hub);
    app.ctx.hub.broadcast = (sessionId, event) => {
      if (
        (event as { type?: string }).type === "error:block" &&
        (event as { error?: string }).error?.includes("没有产生输出")
      ) {
        errorEvents.push(event as { type?: string; error?: string });
      }
      return origBroadcast(sessionId, event);
    };

    const msgRes = await fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(msgRes.status).toBe(200);

    // The turn completes with real output; the late loading callbacks must not
    // have triggered a spurious empty-turn error.
    await expect
      .poll(() => app.ctx.store.get(session.id)?.status)
      .toBe("idle");
    expect(errorEvents).toEqual([]);
  });

  it("does not report an empty turn when the send is queued behind a running turn", async () => {
    // A send landing while the previous turn is still loading is enqueued by the
    // SDK and only dispatched after that turn's loading drops. runTurn must not
    // treat the queued window (nor the previous turn's own end) as a finished
    // empty turn — a bogus "模型没有产生输出" error block lands between the
    // optimistic bubble and the user:message echo, duplicating the user bubble.
    let cbs: {
      onLoadingChange?: (loading: boolean) => void;
      onUserMessageAdded?: (p: { content: string; isMeta?: boolean }) => void;
      onAssistantContentUpdated?: (p: {
        messageId: string;
        chunk: string;
        stage: "streaming" | "end";
      }) => void;
    } = {};
    let sendCalls = 0;
    const createAgent: CreateAgent = async (opts) => {
      cbs = opts.callbacks as typeof cbs;
      return {
        sendMessage: async () => {
          sendCalls++;
          if (sendCalls === 1) {
            // Previous turn starts loading and produces output; loading stays
            // up (slow stream) until the test drops it below.
            cbs.onLoadingChange?.(true);
            cbs.onAssistantContentUpdated?.({
              messageId: "m1",
              chunk: "first reply",
              stage: "end",
            });
            return;
          }
          // Second POST while the agent is busy: the SDK enqueues the message
          // and returns without any callback.
        },
        dispose: async () => {},
      };
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

    const errorEvents: Array<{ type?: string; error?: string }> = [];
    const origBroadcast = app.ctx.hub.broadcast.bind(app.ctx.hub);
    app.ctx.hub.broadcast = (sessionId, event) => {
      if (
        (event as { type?: string }).type === "error:block" &&
        (event as { error?: string }).error?.includes("没有产生输出")
      ) {
        errorEvents.push(event as { type?: string; error?: string });
      }
      return origBroadcast(sessionId, event);
    };

    // First send starts a turn that stays loading.
    const first = await fetch(
      `${app.baseUrl}/sessions/${session.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "first" }),
      },
    );
    expect(first.status).toBe(200);

    // Second send lands while the agent is busy → the SDK enqueues it.
    const second = await fetch(
      `${app.baseUrl}/sessions/${session.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "second" }),
      },
    );
    expect(second.status).toBe(200);

    // Give runTurn's setImmediate fallback a chance to (wrongly) fire.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(errorEvents).toEqual([]);

    // The previous turn's loading finally drops: still no empty-turn report —
    // its turnHadOutput must survive the queued send's runTurn.
    cbs.onLoadingChange?.(false);

    // The queued message dispatches: user message + loading cycle + output.
    cbs.onUserMessageAdded?.({ content: "second" });
    cbs.onLoadingChange?.(true);
    cbs.onAssistantContentUpdated?.({
      messageId: "m2",
      chunk: "second reply",
      stage: "end",
    });
    cbs.onLoadingChange?.(false);

    await expect
      .poll(() => app.ctx.store.get(session.id)?.status)
      .toBe("idle");
    expect(errorEvents).toEqual([]);
  });

  it("does not report empty turn when the previous turn's loading-drop lands after the queued dispatch", async () => {
    // Real-world race observed in production: a turn B queued behind a running
    // turn A is dispatched (onUserMessageAdded) at nearly the same instant A's
    // trailing onLoadingChange(false) settles. If that trailing drop reset the
    // turn bookkeeping after onUserMessageAdded cleared turnHadOutput, it would
    // misreport the freshly-dispatched turn as "模型没有产生输出" (empty turn).
    let cbs: {
      onLoadingChange?: (loading: boolean) => void;
      onUserMessageAdded?: (p: { content: string; isMeta?: boolean }) => void;
      onAssistantContentUpdated?: (p: {
        messageId: string;
        chunk: string;
        stage: "streaming" | "end";
      }) => void;
    } = {};
    let sendCalls = 0;
    const createAgent: CreateAgent = async (opts) => {
      cbs = opts.callbacks as typeof cbs;
      return {
        sendMessage: async () => {
          sendCalls++;
          if (sendCalls === 1) {
            // Turn A: loading up, real output, and the loading state stays up.
            // The trailing onLoadingChange(false) is NOT fired here — it will be
            // fired by the test after the queued dispatch, mimicking the
            // production ordering where A's loading only drops when A's agent
            // loop finally settles (well after B has been enqueued + dispatched).
            cbs.onLoadingChange?.(true);
            cbs.onAssistantContentUpdated?.({
              messageId: "m1",
              chunk: "first reply",
              stage: "end",
            });
            return;
          }
          // Turn B: SDK enqueues while A is busy — returns without callbacks.
        },
        dispose: async () => {},
      };
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

    const errorEvents: Array<{ type?: string; error?: string }> = [];
    const origBroadcast = app.ctx.hub.broadcast.bind(app.ctx.hub);
    app.ctx.hub.broadcast = (sessionId, event) => {
      if (
        (event as { type?: string }).type === "error:block" &&
        (event as { error?: string }).error?.includes("没有产生输出")
      ) {
        errorEvents.push(event as { type?: string; error?: string });
      }
      return origBroadcast(sessionId, event);
    };

    const first = await fetch(
      `${app.baseUrl}/sessions/${session.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "first" }),
      },
    );
    expect(first.status).toBe(200);

    const second = await fetch(
      `${app.baseUrl}/sessions/${session.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "second" }),
      },
    );
    expect(second.status).toBe(200);

    // Give B's runTurn a chance to (wrongly) fire its setImmediate fallback.
    await new Promise((r) => setImmediate(r));
    expect(errorEvents).toEqual([]);

    // Production ordering (logs 08:24:11.742 / .743): the queued message B is
    // dispatched (onUserMessageAdded) and, ~1ms later, A's trailing
    // onLoadingChange(false) settles — BEFORE B has produced any output. The
    // trailing drop must NOT be misread as "B produced no output".
    cbs.onUserMessageAdded?.({ content: "second" });
    cbs.onLoadingChange?.(false); // A's trailing drop lands here

    // B then runs normally and produces output.
    cbs.onLoadingChange?.(true);
    cbs.onAssistantContentUpdated?.({
      messageId: "m2",
      chunk: "second reply",
      stage: "end",
    });
    cbs.onLoadingChange?.(false);

    await expect
      .poll(() => app.ctx.store.get(session.id)?.status)
      .toBe("idle");
    expect(errorEvents).toEqual([]);
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

  it("new WS client receives runtime snapshot for a running session", async () => {
    const hang = Promise.withResolvers<void>();
    const createAgent: CreateAgent = async (opts) => ({
      sendMessage: async () => {
        opts.callbacks?.onLoadingChange?.(true);
        await hang.promise;
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

    void fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    await expect
      .poll(() => app.ctx.store.get(session.id)?.status)
      .toBe("running");

    const { ready, events } = openWsCollector(app.baseUrl, session.id, {
      minCount: 2,
      filter: (e) => e.type === "session:status" || e.type === "loading",
    });
    await ready;
    const received = await events;
    expect(received).toEqual(
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

  it("POST /control/resume aborts a hung running turn", async () => {
    const hang = Promise.withResolvers<void>();
    const createAgent: CreateAgent = async () => ({
      sendMessage: async () => hang.promise,
      abortMessage: () => hang.resolve(),
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

    void fetch(`${app.baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    await expect
      .poll(() => app.ctx.store.get(session.id)?.status)
      .toBe("running");

    const res = await fetch(`${app.baseUrl}/control/resume`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ aborted: 1 });
    await expect
      .poll(() => app.ctx.store.get(session.id)?.status)
      .toBe("idle");
  });

  it("replies to application ping with pong", async () => {
    const app = await listenSessionsApp({
      createAgent: async () => ({
        sendMessage: async () => {},
        dispose: async () => {},
      }),
    });
    server = app.server;
    home = app.home;

    const wsUrl = app.baseUrl.replace(/^http/, "ws") + "/ws?sessionId=*";
    const ws = new WebSocket(wsUrl);
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });

      const pong = new Promise<WsEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("pong timeout")), 2000);
        ws.on("message", (data) => {
          const event = JSON.parse(String(data)) as WsEvent;
          if (event.type === "pong") {
            clearTimeout(timer);
            resolve(event);
          }
        });
      });
      ws.send(JSON.stringify({ type: "ping" }));
      await expect(pong).resolves.toEqual({ type: "pong" });
    } finally {
      ws.close();
    }
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
  loadSubagentMessages?: (
    subagentId: string,
    workdir: string,
  ) => Promise<unknown[] | null>;
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
    loadSubagentMessages: options.loadSubagentMessages,
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
