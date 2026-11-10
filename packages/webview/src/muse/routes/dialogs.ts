import type { MessageRouteContext } from "./context";
import { openDesktopNewSessionPage } from "../desktopNewSessionNav";
import { openDesktopSettingsPage } from "../desktopSettingsNav";
import { patchPaneUi } from "../../stores";

export function routeDialogs(message: any, ctx: MessageRouteContext): boolean {
  const { chatContainerRef, messageInputRef, messageListRef, forThisPane, dispatch, stateRef, hostRef, vscode, myPane } = ctx;
  switch (message.command) {
      case "hideConfirmation":
        if (!forThisPane(message)) break;
        if (typeof message.confirmationId === "string") {
          dispatch({ type: "HIDE_CONFIRMATION", payload: message.confirmationId });
        }
        break;
      case "showConfirmation":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SHOW_CONFIRMATION",
          payload: {
            confirmationId: message.confirmationId,
            toolName: message.toolName,
            confirmationType: message.confirmationType,
            toolInput: message.toolInput,
            suggestedPrefix: message.suggestedPrefix,
            hidePersistentOption: message.hidePersistentOption,
            permissionMode: message.permissionMode,
            warning: message.warning,
          },
        });
        // Scroll to bottom when confirmation is shown
        setTimeout(() => {
          if (
            messageListRef.current &&
            typeof messageListRef.current.scrollToBottom === "function"
          ) {
            messageListRef.current.scrollToBottom("auto");
          }
        }, 0);
        break;
      case "configurationResponse":
        dispatch({
          type: "SET_CONFIGURATION_DATA",
          payload: message.configurationData,
        });
        break;
      case "issue:changed":
        // 对话内（AI 跑 issue.mjs）等非 UI 来源的 Issue 变更 → 刷新侧栏分组。
        vscode.postMessage({ command: "desktopRefreshSessionTree" });
        break;
      case "showToast":
        // Toasts are window-global (no paneId) — only the root instance (the
        // one that renders the shell/sidebar, never a split-view pane) tracks
        // them, so a multi-pane desktop never stacks duplicates.
        if (myPane !== undefined) break;
        patchPaneUi(undefined, (slice) => ({
          toasts: [
            ...slice.toasts.filter((t) => t.id !== message.toast.id),
            message.toast,
          ],
        }));
        break;
      case "desktopNewSessionShortcut":
        // Menu accelerator is window-global; the shell / single-pane instance
        // owns newSession so split panes do not spawn duplicates. The shell
        // also leaves Muse Bot for 会话 — the accelerator never reaches the page.
        if (myPane !== undefined) break;
        if (!openDesktopNewSessionPage()) {
          vscode.postMessage({ command: "newSession" });
        }
        break;
      case "showConfiguration":
        if (!forThisPane(message)) break;
        if (hostRef.current?.type === "desktop") {
          dispatch({
            type: "SET_CONFIGURATION_DATA",
            payload:
              message.configurationData ||
              stateRef.current.configurationData ||
              {},
          });
          dispatch({
            type: "SET_CONFIGURATION_ERROR",
            payload: message.error,
          });
          openDesktopSettingsPage();
          break;
        }
        dispatch({
          type: "SHOW_DIALOG",
          payload: {
            type: "config" as const,
            data:
              message.configurationData ||
              stateRef.current.configurationData ||
              {},
            error: message.error,
          },
        });
        break;
      case "showDialog":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SHOW_DIALOG",
          payload: { type: message.dialogType },
        });
        break;
      case "configurationUpdated":
        dispatch({ type: "HIDE_DIALOG" });
        break;
      case "statusResponse":
        if (!forThisPane(message)) break;
        if (message.configurationData) {
          dispatch({
            type: "SET_CONFIGURATION_DATA",
            payload: message.configurationData,
          });
        }
        break;
      case "configurationError":
        if (!forThisPane(message)) break;
        dispatch({ type: "SET_CONFIGURATION_ERROR", payload: message.error });
        break;
      case "focusInput":
        if (!forThisPane(message)) break;
        // When a confirm/rewind dialog is open in this pane, focus its
        // primary action instead of the message input. The input is hidden
        // (display:none) during a tool-permission confirmation, so focusing it
        // silently no-ops; a rewind modal also covers it. Landing focus on
        // the dialog lets the user act on it immediately (Enter to confirm,
        // Esc to cancel) right after the pane switch. Falls back to the
        // message input when no dialog is open.
        {
          const root = chatContainerRef.current ?? document;
          const rewindBtn = root.querySelector<HTMLElement>(
            ".confirm-dialog-btn-confirm:not([disabled])",
          );
          if (rewindBtn) {
            rewindBtn.focus();
            break;
          }
          const applyBtn = root.querySelector<HTMLElement>(
            ".confirmation-btn-apply:not([disabled])",
          );
          if (applyBtn) {
            applyBtn.focus();
            break;
          }
          if (
            messageInputRef.current &&
            typeof messageInputRef.current.focus === "function"
          ) {
            messageInputRef.current.focus();
          }
        }
        break;
      case "authStatusResponse":
        dispatch({
          type: "SET_AUTHENTICATED",
          payload: message.isAuthenticated || false,
        });
        break;
      case "showAuthDialog":
        dispatch({
          type: "SHOW_DIALOG",
          payload:
            message.providerId === "deepseek"
              ? { type: "deepseek-key" }
              : {
                  type: "login",
                  serviceName: message.providerId === "codex" ? "ChatGPT" : "账号",
                },
        });
        break;
      case "deepseekKeyResponse":
        if (message.success) {
          dispatch({ type: "SET_AUTHENTICATED", payload: true });
          dispatch({ type: "HIDE_DIALOG" });
        } else {
          dispatch({
            type: "SET_LOGIN_ERROR",
            payload:
              typeof message.error === "string" ? message.error : "保存失败，请重试",
          });
        }
        break;
      case "loginResponse":
        if (message.success) {
          dispatch({ type: "SET_AUTHENTICATED", payload: true });
        } else {
          dispatch({
            type: "SET_LOGIN_ERROR",
            payload:
              typeof message.error === "string"
                ? message.error
                : "登录失败，请重试",
          });
        }
        break;
      case "logoutResponse":
        if (message.success) {
          dispatch({ type: "SET_AUTHENTICATED", payload: false });
        }
        break;
    default:
      return false;
  }
  return true;
}
