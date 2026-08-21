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

  it("collapses and expands on header click", () => {
    renderChatApp();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
    });

    const list = screen.getByTestId("background-task-list");
    expect(list).toHaveTextContent("npm run build");

    fireEvent.click(screen.getByLabelText("折叠后台任务"));
    expect(screen.queryByText(/npm run build/)).not.toBeInTheDocument();
    expect(screen.getByText("后台任务 (1)")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("展开后台任务"));
    expect(screen.getByText(/npm run build/)).toBeInTheDocument();
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

  it("keeps failed/killed tasks visible and hides when all tasks complete", () => {
    vi.useFakeTimers();
    try {
      renderChatApp();
      act(() => {
        sendCommand("updateBackgroundTasks", {
          tasks: [{ ...runningTask, status: "failed" }],
        });
      });
      expect(screen.getByTestId("background-task-list")).toBeInTheDocument();

      // 全部完成：5 秒宽限后自动隐藏（与任务列表一致）
      act(() => {
        sendCommand("updateBackgroundTasks", { tasks: [completedTask] });
      });
      expect(screen.getByTestId("background-task-list")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(5001);
      });
      expect(
        screen.queryByTestId("background-task-list"),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
