import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { TodoNotifyStack } from "../../src/components/todo/TodoNotifyStack";
import { useTodoBoardStore } from "../../src/stores/todoBoardStore";

describe("TodoNotifyStack", () => {
  beforeEach(() => {
    useTodoBoardStore.setState({ notifications: [], reviewCount: 0 });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function pushNotification() {
    useTodoBoardStore.getState().handleNotify({
      todoId: "t1",
      taskId: "k1",
      todoTitle: "修复竞态",
      taskTitle: "实现 aborted 标记",
      priority: "p0",
    });
  }

  it("renders notification card with title and body; click opens", () => {
    const onOpen = vi.fn();
    pushNotification();
    render(<TodoNotifyStack onOpen={onOpen} />);
    expect(screen.getByTestId("todo-notify-stack")).toBeTruthy();
    expect(screen.getByText("Muse · 任务待审核")).toBeTruthy();
    expect(screen.getByText(/修复竞态 · 实现 aborted 标记 待审核/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("todo-notify-stack").firstChild as Element);
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "k1", todoId: "t1" }),
    );
  });

  it("auto-dismisses after 8s", () => {
    pushNotification();
    render(<TodoNotifyStack onOpen={() => {}} />);
    expect(screen.getByTestId("todo-notify-stack")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.queryByTestId("todo-notify-stack")).toBeNull();
  });

  it("renders nothing when no notifications", () => {
    render(<TodoNotifyStack onOpen={() => {}} />);
    expect(screen.queryByTestId("todo-notify-stack")).toBeNull();
  });
});
