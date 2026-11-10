import type { MessageRouteContext } from "./context";
import { patchPaneUi } from "../../stores";

export function routeSession(message: any, ctx: MessageRouteContext): boolean {
  const { forThisPane, dispatch, myPane } = ctx;
  switch (message.command) {
      case "updateTasks":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_TASKS", payload: message.tasks });
        if (message.isTaskListCollapsed !== undefined) {
          dispatch({
            type: "SET_TASK_LIST_COLLAPSED",
            payload: message.isTaskListCollapsed,
          });
        }
        break;
      case "updateBackgroundTasks":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_BACKGROUND_TASKS", payload: message.tasks });
        break;
      case "updateWorkflowRuns":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_WORKFLOW_RUNS", payload: message.runs });
        break;
      case "updateSelection":
        if (!forThisPane(message)) break;
        dispatch({ type: "UPDATE_SELECTION", payload: message.selection });
        break;
      case "updatePermissionMode":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_PERMISSION_MODE", payload: message.mode });
        break;
      case "updateWorkdir":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_WORKDIR", payload: message.workdir });
        break;
      case "updateQueue":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_QUEUED_MESSAGES", payload: message.messages });
        break;
      case "updateQueuedMessageMissing":
        if (!forThisPane(message)) break;
        // The edited queue message no longer exists. Keep input content, exit editing.
        dispatch({ type: "SET_EDITING_QUEUED_ID", payload: null });
        patchPaneUi(myPane, {
          queueEditWarning: "编辑的队列消息已不存在！",
        });
        break;
      case "rewindCheckpoints":
        if (!forThisPane(message)) break;
        patchPaneUi(myPane, {
          rewindCheckpoints: message.checkpoints || [],
          rewindCheckpointsLoading: false,
        });
        break;
      case "configuredModels":
        if (!forThisPane(message)) break;
        patchPaneUi(myPane, {
          configuredModels: message.models || [],
          currentModel: message.currentModel,
          modelLoading: false,
        });
        break;
      case "ensureUIReset":
        if (!forThisPane(message)) break;
        dispatch({ type: "END_STREAMING" });
        break;
      case "updateSessions":
        dispatch({ type: "SET_SESSIONS", payload: message.sessions });
        break;
      case "updateCurrentSession":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_CURRENT_SESSION", payload: message.session });
        break;
      case "setInitialState":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SET_INITIAL_STATE",
          payload: {
            messages: message.messages,
            tasks: message.tasks,
            isStreaming: message.isStreaming,
            isTaskListCollapsed: message.isTaskListCollapsed,
            isRestoring: message.isRestoring,
            sessions: message.sessions,
            currentSession: message.session,
            configurationData: message.configurationData,
            pendingConfirmations:
              message.pendingConfirmations ||
              (message.pendingConfirmation
                ? [message.pendingConfirmation]
                : []),
            selection: message.selection,
            inputContent: message.inputContent,
            permissionMode: message.permissionMode,
            attachedImages: message.attachedImages,
            queuedMessages: message.queuedMessages,
            isAuthenticated: message.isAuthenticated,
            workdir: message.workdir,
            theme: message.theme,
            // The desktop host includes the running background tasks + workflow
            // runs in the snapshot so a webview re-init / pane switch does not
            // wipe them. Without this the reducer falls back to [] and /tasks
            // shows "暂无后台任务" until the next incremental
            // updateBackgroundTasks (e.g. stop).
            backgroundTasks: message.backgroundTasks,
            workflowRuns: message.workflowRuns,
          },
        });
        break;
    default:
      return false;
  }
  return true;
}
