import type { ChatState, ChatAction } from "../../types";

type Action = Extract<ChatAction, { type: "SET_TASKS" | "SET_BACKGROUND_TASKS" | "SET_WORKFLOW_RUNS" | "TOGGLE_TASK_LIST_COLLAPSE" | "SET_TASK_LIST_COLLAPSED" | "TOGGLE_BACKGROUND_TASKS_COLLAPSE" | "EXPAND_BACKGROUND_TASKS" | "TOGGLE_QUEUE_COLLAPSE" | "START_STREAMING" | "END_STREAMING" | "SET_COMPACTING" | "INPUT_CLEARED" }>;

export function reduceTasks(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "SET_TASKS":
      return {
        ...state,
        tasks: action.payload,
        // Auto-expand task list when tasks are first created
        isTaskListCollapsed:
          state.tasks.length === 0 && action.payload.length > 0
            ? false
            : state.isTaskListCollapsed,
      };
    case "SET_BACKGROUND_TASKS":
      return {
        ...state,
        backgroundTasks: action.payload,
        // 首批后台任务到达时自动展开（与 SET_TASKS 首次出现自动展开一致）
        isBackgroundTasksCollapsed:
          state.backgroundTasks.length === 0 && action.payload.length > 0
            ? false
            : state.isBackgroundTasksCollapsed,
      };
    case "SET_WORKFLOW_RUNS":
      return { ...state, workflowRuns: action.payload };
    case "TOGGLE_TASK_LIST_COLLAPSE":
      return {
        ...state,
        isTaskListCollapsed: !state.isTaskListCollapsed,
      };
    case "SET_TASK_LIST_COLLAPSED":
      return {
        ...state,
        isTaskListCollapsed: action.payload,
      };
    case "TOGGLE_BACKGROUND_TASKS_COLLAPSE":
      return {
        ...state,
        isBackgroundTasksCollapsed: !state.isBackgroundTasksCollapsed,
      };
    case "EXPAND_BACKGROUND_TASKS":
      return { ...state, isBackgroundTasksCollapsed: false };
    case "TOGGLE_QUEUE_COLLAPSE":
      return {
        ...state,
        isQueueCollapsed: !state.isQueueCollapsed,
      };
    case "START_STREAMING":
      return {
        ...state,
        isStreaming: true,
      };
    case "END_STREAMING": {
      // Abort posts endStreaming before the server's reasoning finalize, and
      // that finalize is dropped while the turn is marked aborted. Close any
      // open thought here so "思考中" stops with the turn.
      const now = Date.now();
      let changed = false;
      const messages = state.messages.map((message) => {
        if (message.role !== "assistant") return message;
        let touched = false;
        const blocks = message.blocks.map((block) => {
          if (block.type !== "reasoning" || block.stage === "end") return block;
          touched = true;
          return {
            ...block,
            stage: "end" as const,
            endTime: block.endTime ?? now,
          };
        });
        if (!touched) return message;
        changed = true;
        return { ...message, blocks };
      });
      return {
        ...state,
        isStreaming: false,
        ...(changed ? { messages } : {}),
      };
    }
    case "SET_COMPACTING":
      return {
        ...state,
        isCompacting: action.payload,
      };
    case "INPUT_CLEARED":
      return {
        ...state,
        shouldClearInput: false,
      };
  }
}
