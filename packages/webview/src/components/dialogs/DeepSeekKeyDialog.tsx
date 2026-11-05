import React, { useEffect, useState } from "react";
import "../../styles/ConfirmDialog.css";
import type { VsCodeApi } from "../../types";

export const DeepSeekKeyDialog: React.FC<{
  vscode: VsCodeApi;
  error?: string;
  onCancel: () => void;
}> = ({ vscode, error, onCancel }) => {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (error) setSaving(false);
  }, [error]);

  const save = () => {
    const value = apiKey.trim();
    if (!value || saving) return;
    setSaving(true);
    vscode.postMessage({ command: "saveDeepSeekKey", apiKey: value });
  };

  return (
    <div className="confirm-dialog-overlay" data-testid="deepseek-key-dialog">
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="填写 DeepSeek API Key"
      >
        <div className="confirm-dialog-message-row">
          <i className="codicon codicon-key confirm-dialog-icon" aria-hidden="true" />
          <div className="confirm-dialog-message-content">
            <div className="confirm-dialog-title">DeepSeek 需要 API Key</div>
            <div className="confirm-dialog-description">
              密钥会写入环境变量 DEEPSEEK_API_KEY，只保存在本机。
            </div>
            <input
              className="confirm-dialog-input"
              data-testid="deepseek-key-input"
              type="password"
              value={apiKey}
              autoFocus
              autoComplete="off"
              placeholder="sk-..."
              onChange={(event) => setApiKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
              }}
            />
            {error ? (
              <div className="login-dialog-error" data-testid="deepseek-key-error">
                {error}
              </div>
            ) : null}
          </div>
        </div>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-cancel"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-confirm"
            data-testid="deepseek-key-save"
            onClick={save}
            disabled={saving || apiKey.trim().length === 0}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};
