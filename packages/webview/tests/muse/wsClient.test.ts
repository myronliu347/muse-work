import { describe, it, expect, beforeEach } from "vitest";
import { MuseWsClient } from "../../src/muse/wsClient.js";

type Listener = (ev?: { data?: string }) => void;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  emit(type: string, ev?: { data?: string }): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(ev);
    }
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }
}

describe("MuseWsClient", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  it("connect resolves after WebSocket open", async () => {
    const client = new MuseWsClient({
      baseUrl: "http://127.0.0.1:8787",
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const pending = client.connect("sess-1");
    const socket = MockWebSocket.instances[0]!;
    expect(socket.url).toBe("ws://127.0.0.1:8787/ws?sessionId=sess-1");

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    socket.open();
    await pending;
  });

  it("connect returns same promise while connecting to same session", async () => {
    const client = new MuseWsClient({
      baseUrl: "http://127.0.0.1:8787",
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const first = client.connect("sess-1");
    const second = client.connect("sess-1");
    expect(first).toBe(second);

    MockWebSocket.instances[0]!.open();
    await first;
  });

  it("delivers parsed events to handlers", async () => {
    const client = new MuseWsClient({
      baseUrl: "http://127.0.0.1:8787",
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });
    const events: unknown[] = [];
    client.onEvent((ev) => events.push(ev));

    const pending = client.connect("sess-1");
    const socket = MockWebSocket.instances[0]!;
    socket.open();
    await pending;

    socket.emit("message", {
      data: JSON.stringify({ type: "message:delta", text: "hi" }),
    });
    expect(events).toEqual([{ type: "message:delta", text: "hi" }]);
  });
});
