import React, { useEffect } from "react";
import "../../styles/ConfirmDialog.css";
import { bodyPortal } from "../../utils/bodyPortal";

export interface ConfirmDialogProps {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  confirmDisabled?: boolean;
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Centered modal dialog for destructive-action confirmation (Figma 2294:1496).
 * Esc = cancel, Enter = confirm; clicking the scrim does NOT dismiss.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  description,
  confirmText = "确定",
  cancelText = "取消",
  confirmDisabled = false,
  children,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Enter") {
        // A focused button fires its own click on Enter — let it win.
        if (document.activeElement instanceof HTMLButtonElement) return;
        if (document.activeElement instanceof HTMLTextAreaElement) return;
        if (confirmDisabled) return;
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmDisabled, onConfirm, onCancel]);

  return bodyPortal(
    <div
      className="confirm-dialog-overlay"
      data-testid="confirm-dialog-overlay"
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="confirm-dialog-message-row">
          <i
            className="codicon codicon-warning confirm-dialog-icon"
            aria-hidden="true"
          ></i>
          <div className="confirm-dialog-message-content">
            <div className="confirm-dialog-title">{title}</div>
            {description && (
              <div className="confirm-dialog-description">{description}</div>
            )}
          </div>
        </div>
        {children}
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-cancel"
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-confirm"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            disabled={confirmDisabled}
            autoFocus={!children}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
