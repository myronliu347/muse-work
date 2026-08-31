/**
 * ConfigDialog — settings overlay hosts appearance, plugins, and provider.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Button } from "@radix-ui/themes";
import { ConfigDialogProps, VsCodeApi } from "../../types";
import { CloseIcon } from "../shared/HeaderIcons";
import {
  MuseProviderSettings,
  type MuseProviderSettingsHandle,
} from "../settings/MuseProviderSettings";
import { AppearanceSettings } from "../settings/AppearanceSettings";
import { PluginSettings } from "../settings/PluginSettings";
import {
  AgentSettings,
  type AgentSettingsHandle,
} from "../settings/AgentSettings";
import "../../styles/ConfigurationDialog.css";

/**
 * Radix 弹层（Select 下拉、DropdownMenu 菜单、Tooltip 等）默认 portal 到
 * document.body，DOM 不在 `.configuration-dialog` 内。点击这些弹层里的元素
 * 会被 outside-click 误判为「点设置弹窗外」而关闭整个设置弹窗。
 * 这里豁免：target 落在 Radix 弹层（popper wrapper / listbox）内时不算外部点击。
 */
function isRadixPopupTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      '[data-radix-popper-content-wrapper], [role="listbox"], [role="menu"], [data-radix-select-content]',
    ),
  );
}

const ConfigDialog: React.FC<ConfigDialogProps & { vscode: VsCodeApi }> = ({
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<MuseProviderSettingsHandle>(null);
  const agentSettingsRef = useRef<AgentSettingsHandle>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "appearance" | "plugins" | "agent" | "provider"
  >("appearance");
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
    if (settingsRef.current?.isDirty() || agentSettingsRef.current?.isDirty()) {
      const discard = window.confirm("有未保存的修改，确定关闭？");
      if (!discard) return;
    }
    onCancel();
  }, [onCancel]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dialogRef.current &&
        !dialogRef.current.contains(event.target as Node) &&
        !isRadixPopupTarget(event.target)
      ) {
        requestClose();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      // Radix 弹层（Select/DropdownMenu）用 capture 阶段消费 Escape 并
      // preventDefault，冒泡阶段此时 defaultPrevented=true → 只关弹层，别连设置弹窗一起关。
      if (event.key === "Escape" && !event.defaultPrevented) {
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
    if (activeTab === "agent") {
      setSaving(true);
      try {
        const ok = await agentSettingsRef.current?.save();
        if (ok) onCancel();
      } finally {
        setSaving(false);
      }
      return;
    }
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
            aria-selected={activeTab === "plugins"}
            aria-controls="config-plugins-panel"
            className={`config-tab${activeTab === "plugins" ? " active" : ""}`}
            onClick={() => setActiveTab("plugins")}
            style={{ position: "relative", borderBottomColor: "transparent" }}
          >
            插件
            {activeTab === "plugins" && (
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
            aria-selected={activeTab === "agent"}
            aria-controls="config-agent-panel"
            className={`config-tab${activeTab === "agent" ? " active" : ""}`}
            onClick={() => setActiveTab("agent")}
            style={{ position: "relative", borderBottomColor: "transparent" }}
          >
            Agent
            {activeTab === "agent" && (
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
              id="config-plugins-panel"
              role="tabpanel"
              hidden={activeTab !== "plugins"}
            >
              <PluginSettings />
            </div>
            <div
              id="config-agent-panel"
              role="tabpanel"
              hidden={activeTab !== "agent"}
            >
              <AgentSettings ref={agentSettingsRef} />
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
