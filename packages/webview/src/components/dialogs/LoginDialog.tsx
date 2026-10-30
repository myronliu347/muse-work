import React, { useEffect, useState } from "react";
import "../../styles/ConfirmDialog.css";

export interface LoginDialogProps {
  /** True once the active provider reports authenticated (drives auto-close). */
  isAuthenticated: boolean;
  /** Human-readable login failure (timeout / SSO error), shown for retry. */
  loginError?: string;
  /** Product name in the title. CodeMaker and ChatGPT share this dialog. */
  serviceName?: string;
  /** Starts the browser login flow. */
  onLogin: () => void;
  onCancel: () => void;
}

/**
 * Modal guiding a re-login after a turn fails on auth grounds
 * (missing/expired credentials or a revoked token). Clicking 去登录 starts the
 * browser flow; the dialog auto-closes once authentication succeeds.
 */
export const LoginDialog: React.FC<LoginDialogProps> = ({
  isAuthenticated,
  loginError,
  serviceName = "CodeMaker",
  onLogin,
  onCancel,
}) => {
  const [waiting, setWaiting] = useState(false);

  // Auto-close only after the user started SSO and it succeeded. Opening the
  // dialog while local state is still authenticated (API already 403'd) must
  // not dismiss it immediately.
  useEffect(() => {
    if (waiting && isAuthenticated) onCancel();
  }, [waiting, isAuthenticated, onCancel]);

  // A reported failure ends the waiting state so the user can retry.
  useEffect(() => {
    if (loginError) setWaiting(false);
  }, [loginError]);

  const handleLogin = () => {
    setWaiting(true);
    onLogin();
  };

  return (
    <div className="confirm-dialog-overlay" data-testid="login-dialog-overlay">
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={`${serviceName} 登录已失效`}
      >
        <div className="confirm-dialog-message-row">
          <i
            className="codicon codicon-sign-in confirm-dialog-icon"
            aria-hidden="true"
          ></i>
          <div className="confirm-dialog-message-content">
            <div className="confirm-dialog-title">{serviceName} 登录已失效</div>
            <div className="confirm-dialog-description">
              发送消息时发现登录凭证缺失或已过期，请重新登录后重试。
            </div>
            {loginError && (
              <div
                className="login-dialog-error"
                data-testid="login-dialog-error"
              >
                {loginError}
              </div>
            )}
            {waiting && (
              <div
                className="login-dialog-waiting"
                data-testid="login-dialog-waiting"
              >
                请在浏览器中完成登录…
              </div>
            )}
          </div>
        </div>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-cancel"
            data-testid="login-dialog-cancel"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-confirm"
            data-testid="login-dialog-login"
            onClick={handleLogin}
            disabled={waiting}
            autoFocus
          >
            去登录
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginDialog;
