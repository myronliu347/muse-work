/**
 * ConfigDialog — settings overlay. Currently only hosts provider settings.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Button } from "@radix-ui/themes";
import { ConfigDialogProps, VsCodeApi } from "../types";
import { CloseIcon } from "./HeaderIcons";
import {
  MuseProviderSettings,
  type MuseProviderSettingsHandle,
} from "./MuseProviderSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import "../styles/ConfigurationDialog.css";

const ConfigDialog: React.FC<ConfigDialogProps & { vscode: VsCodeApi }> = ({
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<MuseProviderSettingsHandle>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"appearance" | "provider">(
    "appearance",
  );
  const savingRef = useRef(false);
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const panelTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 380, damping: 28 };
  const tabUnderlineTransition = reduceMotion ? { duration: 0 } : undefined;
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
    <motion.div
      className="configuration-dialog-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.16 }}
    >
      <motion.div
        ref={dialogRef}
        className="configuration-dialog config-dialog"
        data-testid="config-dialog"
        initial={
          reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }
        }
        animate={{ opacity: 1, scale: 1 }}
        transition={panelTransition}
      >
        <div className="configuration-dialog-header config-dialog-header">
          <h3>设置</h3>
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

        <div className="config-tabs" role="tablist" aria-label="设置">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "appearance"}
            aria-controls="config-appearance-panel"
            className={`config-tab${activeTab === "appearance" ? " active" : ""}`}
            onClick={() => setActiveTab("appearance")}
            style={{ position: "relative", borderBottomColor: "transparent" }}
          >
            外观
            {activeTab === "appearance" && (
              <motion.span
                className="settings-tab-underline"
                layoutId="settings-tab-underline"
                transition={tabUnderlineTransition}
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: -1,
                  left: 0,
                  height: 2,
                  backgroundColor: "var(--accent-9)",
                }}
              />
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "provider"}
            aria-controls="config-provider-panel"
            className={`config-tab${activeTab === "provider" ? " active" : ""}`}
            onClick={() => setActiveTab("provider")}
            style={{ position: "relative", borderBottomColor: "transparent" }}
          >
            供应商
            {activeTab === "provider" && (
              <motion.span
                className="settings-tab-underline"
                layoutId="settings-tab-underline"
                transition={tabUnderlineTransition}
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: -1,
                  left: 0,
                  height: 2,
                  backgroundColor: "var(--accent-9)",
                }}
              />
            )}
          </button>
        </div>

        <div className="configuration-form">
          <div className="configuration-fields-scroll-area">
            <div
              id="config-appearance-panel"
              role="tabpanel"
              hidden={activeTab !== "appearance"}
            >
              <AppearanceSettings />
            </div>
            <div
              id="config-provider-panel"
              role="tabpanel"
              hidden={activeTab !== "provider"}
            >
              <MuseProviderSettings
                ref={settingsRef}
                onSavingChange={setSaving}
              />
            </div>
          </div>

          <div className="configuration-actions">
            <Button
              variant="soft"
              color="gray"
              onClick={requestClose}
              disabled={saving}
            >
              关闭
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={saving}
              data-testid="config-dialog-save"
            >
              {saving ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default ConfigDialog;
