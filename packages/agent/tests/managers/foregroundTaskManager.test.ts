import { describe, it, expect, vi } from "vitest";
import { ForegroundTaskManager } from "../../src/managers/foregroundTaskManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
import { ForegroundTask } from "../../src/types/processes.js";
import { Container } from "../../src/utils/container.js";

describe("ForegroundTaskManager", () => {
  it("should register and unregister foreground tasks", () => {
    const container = new Container();
    const manager = new ForegroundTaskManager(container);
    const task: ForegroundTask = {
      id: "test-task",
      backgroundHandler: vi.fn().mockResolvedValue(undefined),
    };

    manager.registerForegroundTask(task);
    // Internal state is private, but we can test behavior via backgroundCurrentTask

    manager.unregisterForegroundTask("test-task");
    // After unregistering, backgrounding should do nothing
  });

  it("should background the current task and remove it from the stack", async () => {
    const container = new Container();
    const manager = new ForegroundTaskManager(container);
    const backgroundHandler = vi.fn().mockResolvedValue(undefined);
    const task: ForegroundTask = {
      id: "test-task",
      backgroundHandler,
    };

    manager.registerForegroundTask(task);
    await manager.backgroundCurrentTask();

    expect(backgroundHandler).toHaveBeenCalledTimes(1);

    // Calling it again should not call the handler again (task was popped)
    await manager.backgroundCurrentTask();
    expect(backgroundHandler).toHaveBeenCalledTimes(1);
  });

  it("should background all tasks in the stack", async () => {
    const container = new Container();
    const manager = new ForegroundTaskManager(container);
    const handler1 = vi.fn().mockResolvedValue(undefined);
    const handler2 = vi.fn().mockResolvedValue(undefined);

    manager.registerForegroundTask({
      id: "task1",
      backgroundHandler: handler1,
    });
    manager.registerForegroundTask({
      id: "task2",
      backgroundHandler: handler2,
    });

    await manager.backgroundCurrentTask();
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler1).toHaveBeenCalledTimes(1);

    // Calling it again should not call handlers again (tasks were popped)
    await manager.backgroundCurrentTask();
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler1).toHaveBeenCalledTimes(1);
  });

  it("should do nothing if no tasks are registered", async () => {
    const container = new Container();
    const manager = new ForegroundTaskManager(container);
    await expect(manager.backgroundCurrentTask()).resolves.not.toThrow();
  });

  it("yields only subagent tasks and leaves shell tasks in the foreground", async () => {
    const container = new Container();
    const manager = new ForegroundTaskManager(container);
    const shellHandler = vi.fn().mockResolvedValue(undefined);
    const subagentHandler = vi.fn().mockResolvedValue(undefined);
    const yieldForFollowUp = vi.fn().mockResolvedValue(undefined);

    manager.registerForegroundTask({
      id: "bash_1",
      backgroundHandler: shellHandler,
    });
    manager.registerForegroundTask({
      id: "subagent-1",
      backgroundHandler: subagentHandler,
      yieldForFollowUp,
    });

    await manager.yieldRunningSubagents();

    expect(yieldForFollowUp).toHaveBeenCalledTimes(1);
    expect(subagentHandler).not.toHaveBeenCalled();
    expect(shellHandler).not.toHaveBeenCalled();

    await manager.backgroundCurrentTask();
    expect(shellHandler).toHaveBeenCalledTimes(1);
    expect(yieldForFollowUp).toHaveBeenCalledTimes(1);
  });

  it("yields a subagent that starts while a follow-up is already queued", async () => {
    const container = new Container();
    const queue = new MessageQueue();
    queue.enqueue({ content: "快一点" });
    container.register("MessageQueue", queue);
    const manager = new ForegroundTaskManager(container);
    const yieldForFollowUp = vi.fn().mockResolvedValue(undefined);
    const shellHandler = vi.fn().mockResolvedValue(undefined);

    manager.registerForegroundTask({
      id: "bash_1",
      backgroundHandler: shellHandler,
    });
    manager.registerForegroundTask({
      id: "subagent-1",
      backgroundHandler: vi.fn().mockResolvedValue(undefined),
      yieldForFollowUp,
    });

    await manager.yieldIfQueuedFollowUp();

    expect(yieldForFollowUp).toHaveBeenCalledTimes(1);
    expect(shellHandler).not.toHaveBeenCalled();
    expect(queue.getQueue().map((message) => message.content)).toEqual([
      "快一点",
    ]);
  });

  it("leaves the subagent in the foreground when the queue has no follow-up", async () => {
    const container = new Container();
    const queue = new MessageQueue();
    queue.enqueue({ content: "/compact" });
    queue.enqueueNotification("<task-notification/>");
    container.register("MessageQueue", queue);
    const manager = new ForegroundTaskManager(container);
    const yieldForFollowUp = vi.fn().mockResolvedValue(undefined);

    manager.registerForegroundTask({
      id: "subagent-1",
      backgroundHandler: vi.fn().mockResolvedValue(undefined),
      yieldForFollowUp,
    });

    await manager.yieldIfQueuedFollowUp();
    expect(yieldForFollowUp).not.toHaveBeenCalled();

    await manager.backgroundCurrentTask();
    expect(yieldForFollowUp).not.toHaveBeenCalled();
  });

  it("should not fail when unregistering non-existent task", () => {
    const container = new Container();
    const manager = new ForegroundTaskManager(container);
    expect(() =>
      manager.unregisterForegroundTask("non-existent"),
    ).not.toThrow();
  });

  it("should handle race condition where task is unregistered while backgrounding is requested", async () => {
    const container = new Container();
    const manager = new ForegroundTaskManager(container);
    const handler = vi.fn().mockResolvedValue(undefined);
    const task: ForegroundTask = {
      id: "test-task",
      backgroundHandler: handler,
    };

    manager.registerForegroundTask(task);

    // Simulate task finishing (unregistering) just before backgrounding logic processes it
    manager.unregisterForegroundTask("test-task");

    await manager.backgroundCurrentTask();

    // Handler should not be called because the task was already removed from the stack by unregister
    expect(handler).not.toHaveBeenCalled();
  });
});
