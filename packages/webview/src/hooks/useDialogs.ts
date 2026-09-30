import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type {
  ChatAction,
  ChatState,
  ConfigurationData,
  UpdateToast,
  VsCodeApi,
} from "../types";
import type { MainView } from "../components/ChatApp";
import type { ChatAppCore } from "./useChatAppCore";

export interface DialogHandlers {
  handleConfigurationSave: (configData: ConfigurationData) => void;
  handleDialogClose: () => void;
  handleLogin: () => void;
  handleLogout: () => void;
  handleOpenSettings: () => void;
  handleToastDismiss: (id: string) => void;
  handleToastAction: (toast: UpdateToast) => void;
  handleModelSelect: (model: string) => void;
  handleSessionModelChange: (model: string) => void;
  handleModelPopupClose: () => void;
  handleDesktopNewSession: () => void;
  handleDesktopNewSessionInWorkdir: (workdir: string) => void;
  handleInputCleared: () => void;
}

interface UseDialogsParams {
  postToHost: ChatAppCore["postToHost"];
  patchPane: ChatAppCore["patchPane"];
  dispatch: Dispatch<ChatAction>;
  vscode: VsCodeApi;
  stateRef: MutableRefObject<ChatState>;
  messageInputRef: RefObject<{ focus: () => void }>;
  setView: Dispatch<SetStateAction<MainView>>;
}

export function useDialogs({
  postToHost,
  patchPane,
  dispatch,
  vscode,
  stateRef,
  messageInputRef,
  setView,
}: UseDialogsParams): DialogHandlers {
  const handleToastDismiss = useCallback(
    (id: string) => {
      patchPane((slice) => ({
        toasts: slice.toasts.filter((t) => t.id !== id),
      }));
    },
    [patchPane],
  );

  const handleToastAction = useCallback(
    (toast: UpdateToast) => {
      if (!toast.action) return;
      postToHost({
        command: "toastAction",
        toastId: toast.id,
        action: toast.action,
      });
      patchPane((slice) => ({
        toasts: slice.toasts.filter((t) => t.id !== toast.id),
      }));
    },
    [postToHost, patchPane],
  );

  // Desktop 的"新对话"入口（侧边栏按钮）：由宿主 spawn 新 agent 承载全新会话，
  // 当前会话在后台继续，因此流式期间保持可用。
  const handleDesktopNewSession = useCallback(() => {
    // 同步退出机器人页，不依赖宿主推送新会话的时序。
    setView("chat");
    postToHost({
      command: "newSession",
    });
  }, [postToHost]);

  const handleDesktopNewSessionInWorkdir = useCallback(
    (workdir: string) => {
      setView("chat");
      postToHost({
        command: "newSession",
        workdir,
      });
    },
    [postToHost],
  );

  const handleLogin = useCallback(() => {
    vscode.postMessage({ command: "login" });
  }, [vscode]);

  const handleOpenSettings = useCallback(() => {
    dispatch({
      type: "SHOW_DIALOG",
      payload: {
        type: "config",
        data: stateRef.current.configurationData || {},
      },
    });
    vscode.postMessage({ command: "getConfiguration" });
  }, [vscode]);

  const handleLogout = useCallback(() => {
    vscode.postMessage({ command: "logout" });
  }, [vscode]);

  // Configuration handlers
  const handleConfigurationSave = useCallback(
    (configData: ConfigurationData) => {
      dispatch({ type: "SET_CONFIGURATION_LOADING", payload: true });
      vscode.postMessage({
        command: "updateConfiguration",
        configurationData: configData,
      });
    },
    [vscode],
  );

  const handleDialogClose = useCallback(() => {
    dispatch({ type: "HIDE_DIALOG" });
  }, []);

  const handleInputCleared = useCallback(() => {
    dispatch({ type: "INPUT_CLEARED" });
  }, []);

  // /model popup: send the switch and close silently (no toast/system message).
  const handleModelSelect = useCallback(
    (model: string) => {
      postToHost({ command: "setModel", model });
      patchPane({ modelPopupOpen: false });
      messageInputRef.current?.focus();
    },
    [postToHost, patchPane],
  );

  // Per-session model in sender toolbar → PATCH /sessions/:id { model }.
  const handleSessionModelChange = useCallback(
    (model: string) => {
      postToHost({ command: "setSessionModel", model });
    },
    [postToHost],
  );

  const handleModelPopupClose = useCallback(() => {
    patchPane({ modelPopupOpen: false });
    messageInputRef.current?.focus();
  }, [patchPane]);

  return {
    handleConfigurationSave,
    handleDialogClose,
    handleLogin,
    handleLogout,
    handleOpenSettings,
    handleToastDismiss,
    handleToastAction,
    handleModelSelect,
    handleSessionModelChange,
    handleModelPopupClose,
    handleDesktopNewSession,
    handleDesktopNewSessionInWorkdir,
    handleInputCleared,
  };
}
