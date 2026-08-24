import { postToWebview } from "./utils.js";
import type { BridgeCtx } from "./ctx.js";

export interface TasksModule {
  pushSessionControlState: (id: string) => Promise<void>;
  setRunningWork: (id: string, kind: "tasks" | "workflows", items: unknown) => void;
  handleGetStatus: () => Promise<void>;
  handleGetBackgroundTasks: () => Promise<void>;
  handleStopBackgroundTask: (msg: { taskId?: string }) => Promise<void>;
  handleGetWorkflowRuns: () => Promise<void>;
  handleStopWorkflowRun: (msg: { runId?: string }) => Promise<void>;
}

export function createTasksModule(ctx: BridgeCtx): TasksModule {
  const hasRunningStatus = (items: unknown): boolean =>
    Array.isArray(items) &&
    items.some(
      (item) =>
        Boolean(item) &&
        typeof item === "object" &&
        (item as { status?: unknown }).status === "running",
    );

  const setRunningWork = (
    id: string,
    kind: "tasks" | "workflows",
    items: unknown,
  ): void => {
    const prev = ctx.runningWorkBySession.get(id) ?? {
      tasks: false,
      workflows: false,
    };
    const next = { ...prev, [kind]: hasRunningStatus(items) };
    if (!next.tasks && !next.workflows) ctx.runningWorkBySession.delete(id);
    else ctx.runningWorkBySession.set(id, next);
    ctx.publishAgentBusy();
  };

  const pushSessionControlState = async (id: string): Promise<void> => {
    const stillHere = () => ctx.sessionId === id && !ctx.pendingNewSession;
    try {
      const { tasks } = await ctx.api.getBackgroundTasks(id);
      if (!stillHere()) return;
      setRunningWork(id, "tasks", tasks);
      postToWebview({
        command: "updateBackgroundTasks",
        tasks: Array.isArray(tasks) ? tasks : [],
      });
    } catch {
      if (!stillHere()) return;
      postToWebview({ command: "updateBackgroundTasks", tasks: [] });
    }
    try {
      const { tasks } = await ctx.api.getTasks(id);
      if (!stillHere()) return;
      postToWebview({
        command: "updateTasks",
        tasks: Array.isArray(tasks) ? tasks : [],
      });
    } catch {
      if (!stillHere()) return;
      postToWebview({ command: "updateTasks", tasks: [] });
    }
    try {
      const { runs } = await ctx.api.getWorkflowRuns(id);
      if (!stillHere()) return;
      setRunningWork(id, "workflows", runs);
      postToWebview({
        command: "updateWorkflowRuns",
        runs: Array.isArray(runs) ? runs : [],
      });
    } catch {
      if (!stillHere()) return;
      postToWebview({ command: "updateWorkflowRuns", runs: [] });
    }
  };

  async function handleGetStatus(): Promise<void> {
    if (!ctx.sessionId || ctx.pendingNewSession) {
      postToWebview({
        command: "statusResponse",
        sessionId: "",
        workdir: ctx.currentWorkdir,
        latestTotalTokens: ctx.latestTokens,
      });
      return;
    }
    try {
      const status = await ctx.api.getSessionStatus(ctx.sessionId);
      ctx.latestTokens = status.latestTotalTokens;
      postToWebview({
        command: "statusResponse",
        sessionId: status.sessionId,
        workdir: status.workdir,
        latestTotalTokens: status.latestTotalTokens,
        permissionMode: status.permissionMode,
      });
    } catch {
      postToWebview({
        command: "statusResponse",
        sessionId: ctx.sessionId,
        workdir: ctx.currentWorkdir,
        latestTotalTokens: ctx.latestTokens,
      });
    }
  }

  async function handleGetBackgroundTasks(): Promise<void> {
    const id = ctx.sessionId;
    if (!id || ctx.pendingNewSession) return;
    try {
      const { tasks } = await ctx.api.getBackgroundTasks(id);
      if (ctx.sessionId !== id || ctx.pendingNewSession) return;
      setRunningWork(id, "tasks", tasks);
      postToWebview({ command: "updateBackgroundTasks", tasks });
    } catch {
      // Keep the WS snapshot; opening /tasks should not wipe a live list.
    }
  }

  async function handleStopBackgroundTask(msg: {
    taskId?: string;
  }): Promise<void> {
    const taskId = typeof msg.taskId === "string" ? msg.taskId : "";
    if (!taskId || !ctx.sessionId || ctx.pendingNewSession) return;
    try {
      await ctx.api.stopBackgroundTask(ctx.sessionId, taskId);
    } catch {
      // Still release the dialog stop spinner.
    }
    postToWebview({ command: "backgroundTaskStopped", taskId });
    await handleGetBackgroundTasks();
  }

  async function handleGetWorkflowRuns(): Promise<void> {
    const id = ctx.sessionId;
    if (!id || ctx.pendingNewSession) {
      postToWebview({ command: "updateWorkflowRuns", runs: [] });
      return;
    }
    try {
      const { runs } = await ctx.api.getWorkflowRuns(id);
      if (ctx.sessionId !== id || ctx.pendingNewSession) return;
      setRunningWork(id, "workflows", runs);
      postToWebview({ command: "updateWorkflowRuns", runs });
    } catch {
      if (ctx.sessionId !== id || ctx.pendingNewSession) return;
      postToWebview({ command: "updateWorkflowRuns", runs: [] });
    }
  }

  async function handleStopWorkflowRun(msg: { runId?: string }): Promise<void> {
    const runId = typeof msg.runId === "string" ? msg.runId : "";
    if (!runId || !ctx.sessionId || ctx.pendingNewSession) return;
    try {
      await ctx.api.stopWorkflowRun(ctx.sessionId, runId);
      postToWebview({ command: "workflowRunStopped", runId });
    } catch {
      postToWebview({ command: "workflowRunStopped", runId });
    }
  }

  return {
    pushSessionControlState,
    setRunningWork,
    handleGetStatus,
    handleGetBackgroundTasks,
    handleStopBackgroundTask,
    handleGetWorkflowRuns,
    handleStopWorkflowRun,
  };
}
