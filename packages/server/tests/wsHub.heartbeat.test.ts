import { describe, expect, it } from "vitest";
import { sweepWsHeartbeat, type HeartbeatSocket } from "../src/services/wsHub.js";

function fakeSocket(
  overrides: Partial<HeartbeatSocket> = {},
): HeartbeatSocket & { pings: number; terminated: number } {
  const socket = {
    readyState: 1,
    OPEN: 1,
    isAlive: true as boolean | undefined,
    pings: 0,
    terminated: 0,
    ping() {
      socket.pings += 1;
    },
    terminate() {
      socket.terminated += 1;
    },
    ...overrides,
  };
  return socket;
}

describe("sweepWsHeartbeat", () => {
  it("pings live sockets and terminates those that missed a pong", () => {
    const live = fakeSocket({ isAlive: true });
    const dead = fakeSocket({ isAlive: false });

    sweepWsHeartbeat([live, dead]);

    expect(live.pings).toBe(1);
    expect(live.isAlive).toBe(false);
    expect(live.terminated).toBe(0);
    expect(dead.terminated).toBe(1);
    expect(dead.pings).toBe(0);
  });
});
