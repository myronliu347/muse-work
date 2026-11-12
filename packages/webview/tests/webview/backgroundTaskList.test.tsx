import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  act,
  sendCommand,
  fireEvent,
} from "./test-utils";
import type { BackgroundTaskSummary } from "../../src/types";

const runningTask: BackgroundTaskSummary = {
  id: "bg-1",
  type: "shell",
  status: "running",
  startTime: 1000,
  command: "npm run build",
  description: "构建 monorepo",
};

const completedTask: BackgroundTaskSummary = {
  id: "bg-2",
  type: "subagent",
  status: "completed",
  startTime: 1000,
  endTime: 60000,
  description: "探索代码结构",
};

describe("BackgroundTaskList inline interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when there are no background tasks", () => {
    renderChatApp();
    expect(screen.queryByTestId("background-task-list")).not.toBeInTheDocument();
  });

  it("posts stopBackgroundTask when the stop button of a running task is clicked", () => {
    const { vscode } = renderChatApp();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
    });

    fireEvent.click(screen.getByTestId("background-task-stop-bg-1"));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "stopBackgroundTask",
      taskId: "bg-1",
    });
  });

  it("hides when there are no running tasks (completed/failed only)", () => {
    renderChatApp();
    act(() => {
      sendCommand("updateBackgroundTasks", {
        tasks: [{ ...runningTask, status: "failed" }],
      });
    });
    expect(screen.queryByTestId("background-task-list")).not.toBeInTheDocument();

    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [completedTask] });
    });
    expect(screen.queryByTestId("background-task-list")).not.toBeInTheDocument();
  });

  it("shows only running tasks when the payload mixes statuses", () => {
    renderChatApp();
    act(() => {
      sendCommand("updateBackgroundTasks", {
        tasks: [runningTask, completedTask],
      });
    });
    const list = screen.getByTestId("background-task-list");
    expect(list).toHaveTextContent("后台任务 (1)");
    expect(list).toHaveTextContent("npm run build");
    expect(list).not.toHaveTextContent("探索代码结构");
  });
});
