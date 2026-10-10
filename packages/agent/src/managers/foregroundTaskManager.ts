import { ForegroundTask, IForegroundTaskManager } from "../types/processes.js";
import { Container } from "../utils/container.js";
import { MessageQueue } from "./messageQueue.js";

export class ForegroundTaskManager implements IForegroundTaskManager {
  private activeForegroundTasks: ForegroundTask[] = [];

  constructor(private container: Container) {}

  public registerForegroundTask(task: ForegroundTask): void {
    this.activeForegroundTasks.push(task);
  }

  public unregisterForegroundTask(id: string): void {
    this.activeForegroundTasks = this.activeForegroundTasks.filter(
      (t) => t.id !== id,
    );
  }

  public async backgroundCurrentTask(): Promise<void> {
    const tasks = [...this.activeForegroundTasks].reverse();
    this.activeForegroundTasks = [];
    for (const task of tasks) {
      await task.backgroundHandler();
    }
  }

  /**
   * Move running foreground subagents to the background. Shell tasks stay in
   * the foreground until their own timeout.
   */
  public async yieldRunningSubagents(): Promise<void> {
    const yielding = this.activeForegroundTasks.filter(
      (task) => task.yieldForFollowUp,
    );
    if (yielding.length === 0) return;
    this.activeForegroundTasks = this.activeForegroundTasks.filter(
      (task) => !task.yieldForFollowUp,
    );
    for (const task of yielding.reverse()) {
      await task.yieldForFollowUp?.();
    }
  }

  /**
   * A follow-up can arrive while the model request is still in flight, before
   * any subagent is registered. When that subagent then starts, yield it
   * immediately so the queued message does not wait for it to finish.
   */
  public async yieldIfQueuedFollowUp(): Promise<void> {
    const messageQueue = this.container.has("MessageQueue")
      ? this.container.get<MessageQueue>("MessageQueue")
      : undefined;
    if (!messageQueue?.hasSteerableUserMessages()) return;
    await this.yieldRunningSubagents();
  }

  public hasActiveTasks(): boolean {
    return this.activeForegroundTasks.length > 0;
  }
}
