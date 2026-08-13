/**
 * ConfigDialog — settings overlay. Currently only hosts provider settings.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ConfigDialogProps, VsCodeApi } from "../types";
import { CloseIcon } from "./HeaderIcons";
import {
  MuseProviderSettings,
  type MuseProviderSettingsHandle,
} from "./MuseProviderSettings";
import "../styles/ConfigurationDialog.css";

const ConfigDialog: React.FC<ConfigDialogProps & { vscode: VsCodeApi }> = ({
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<MuseProviderSettingsHandle>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  savingRef.current = saving;

  const requestClose = useCallback(() => {
    if (savingRef.current) return;
    if (settingsRef.current?.isDirty()) {
      const discard = window.confirm("有未保存的修改，确定关闭？");
      if (!discard) return;
    }
    onCancel();
  }, [onCancel]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dialogRef.current &&
        !dialogRef.current.contains(event.target as Node)
      ) {
        requestClose();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        requestClose();
      }
    };

    // Defer registration so the click that opened this dialog doesn't close it.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    document.addEventListener("keydown", handleEscapeKey);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [requestClose]);

  const handleSave = async () => {
    const ok = await settingsRef.current?.save();
    if (ok) onCancel();
  };

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog config-dialog"
        data-testid="config-dialog"
      >
        <div className="configuration-dialog-header config-dialog-header">
          <h3>供应商设置</h3>
          <button
            type="button"
            className="configuration-close-btn"
            aria-label="关闭"
            onClick={requestClose}
            disabled={saving}
          >
            <CloseIcon className="configuration-close-icon" />
          </button>
        </div>

        <div className="configuration-form">
          <div className="configuration-fields-scroll-area">
            <MuseProviderSettings
              ref={settingsRef}
              onSavingChange={setSaving}
            />
          </div>

          <div className="configuration-actions">
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="configuration-cancel-btn"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="configuration-save-btn"
              data-testid="config-dialog-save"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigDialog;
