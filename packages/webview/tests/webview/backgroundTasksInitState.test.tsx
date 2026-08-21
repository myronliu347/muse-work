import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderChatApp, screen, act, sendCommand } from "./test-utils";
import type { BackgroundTaskSummary } from "../../src/types";

const runningTask: BackgroundTaskSummary = {
  id: "bg-1",
  type: "shell",
  status: "running",
  startTime: 1000,
  command: "sleep 300",
  description: "long-running build",
};

describe("Background tasks inline list above the sender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves running background tasks when the host re-pushes setInitialState (webview re-init / pane switch)", () => {
    // Repro: agent starts a background bash task; a mid-session setInitialState
    // (webview re-init, desktop pane/session switch, rewind) re-pushes
    // state. The host includes backgroundTasks in the payload, so the running
    // task must stay visible in the inline list — not wiped.
    renderChatApp();

    act(() => {
      sendCommand("setInitialState", {
        messages: [],
        backgroundTasks: [runningTask],
        isAuthenticated: true,
      });
    });

    const list = screen.getByTestId("background-task-list");
    expect(list).toHaveTextContent("sleep 300");
    expect(list).toHaveTextContent("后台任务 (1)");
    expect(list).toHaveTextContent("进行中 1");
  });

  it("shows background tasks pushed incrementally via updateBackgroundTasks (baseline)", () => {
    // Baseline: the incremental notification path (also used by stopTask)
    // populates the inline list and is unaffected by the setInitialState wiring.
    renderChatApp();

    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
    });

    const list = screen.getByTestId("background-task-list");
    expect(list).toHaveTextContent("sleep 300");
    expect(list).toHaveTextContent("后台任务 (1)");
  });
});
