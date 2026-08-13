import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MuseWsClient } from "../../src/muse/wsClient.js";

type Listener = (ev?: { data?: string }) => void;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
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

  send(data: string): void {
    this.sent.push(data);
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

  it("reconnects after close and keeps delivering events", async () => {
    const queued: Array<() => void> = [];
    const statuses: string[] = [];
    const client = new MuseWsClient({
      baseUrl: "http://127.0.0.1:8787",
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      reconnectBackoffMs: 10,
      schedule: (fn) => {
        queued.push(fn);
        return queued.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearSchedule: () => {
        queued.length = 0;
      },
    });
    const events: unknown[] = [];
    client.onEvent((ev) => events.push(ev));
    client.onStatus((status) => statuses.push(status));

    const pending = client.connect("sess-1");
    MockWebSocket.instances[0]!.open();
    await pending;
    expect(statuses).toEqual(["open"]);

    MockWebSocket.instances[0]!.close();
    expect(statuses).toContain("closed");
    expect(queued).toHaveLength(1);

    queued.shift()!();
    expect(MockWebSocket.instances).toHaveLength(2);

    MockWebSocket.instances[1]!.open();
    await Promise.resolve();
    expect(statuses.at(-1)).toBe("open");

    MockWebSocket.instances[1]!.emit("message", {
      data: JSON.stringify({ type: "loading", loading: true }),
    });
    expect(events).toEqual([{ type: "loading", loading: true }]);
  });

  it("close() stops reconnect attempts", async () => {
    const queued: Array<() => void> = [];
    const client = new MuseWsClient({
      baseUrl: "http://127.0.0.1:8787",
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      schedule: (fn) => {
        queued.push(fn);
        return queued.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearSchedule: () => {
        queued.length = 0;
      },
    });

    const pending = client.connect("*");
    MockWebSocket.instances[0]!.open();
    await pending;

    client.close();
    MockWebSocket.instances[0]!.close();
    expect(queued).toHaveLength(0);
  });

  it("reconnectNow opens immediately without waiting for backoff", async () => {
    const queued: Array<() => void> = [];
    const client = new MuseWsClient({
      baseUrl: "http://127.0.0.1:8787",
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      reconnectBackoffMs: 10_000,
      schedule: (fn) => {
        queued.push(fn);
        return queued.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearSchedule: () => {
        queued.length = 0;
      },
    });

    const pending = client.connect("*");
    MockWebSocket.instances[0]!.open();
    await pending;
    MockWebSocket.instances[0]!.close();
    expect(queued).toHaveLength(1);

    const reopened = client.reconnectNow();
    expect(queued).toHaveLength(0);
    expect(MockWebSocket.instances).toHaveLength(2);
    MockWebSocket.instances[1]!.open();
    await reopened;
  });

  describe("heartbeat", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("sends ping and does not surface pong to event handlers", async () => {
      vi.useFakeTimers();
      const client = new MuseWsClient({
        baseUrl: "http://127.0.0.1:8787",
        WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
        pingIntervalMs: 15,
        pongTimeoutMs: 50,
      });
      const events: unknown[] = [];
      client.onEvent((ev) => events.push(ev));

      const pending = client.connect("*");
      const socket = MockWebSocket.instances[0]!;
      socket.open();
      await pending;

      await vi.advanceTimersByTimeAsync(15);
      expect(socket.sent).toEqual([JSON.stringify({ type: "ping" })]);

      socket.emit("message", {
        data: JSON.stringify({ type: "pong" }),
      });
      expect(events).toEqual([]);
      client.close();
    });

    it("closes and reconnects when pong does not arrive", async () => {
      vi.useFakeTimers();
      const client = new MuseWsClient({
        baseUrl: "http://127.0.0.1:8787",
        WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
        pingIntervalMs: 15,
        pongTimeoutMs: 20,
        reconnectBackoffMs: 10,
      });
      const statuses: string[] = [];
      client.onStatus((status) => statuses.push(status));

      const pending = client.connect("*");
      MockWebSocket.instances[0]!.open();
      await pending;

      await vi.advanceTimersByTimeAsync(15);
      expect(MockWebSocket.instances[0]!.sent).toEqual([
        JSON.stringify({ type: "ping" }),
      ]);
      expect(MockWebSocket.instances).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(20);
      expect(statuses).toContain("closed");

      await vi.advanceTimersByTimeAsync(10);
      expect(MockWebSocket.instances).toHaveLength(2);
      client.close();
    });
  });
});
