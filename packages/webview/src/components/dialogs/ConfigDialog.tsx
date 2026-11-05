/**
 * ConfigDialog — settings overlay hosts appearance, agent, provider, and POPO.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";
import { Button } from "@radix-ui/themes";
import { ConfigDialogProps, VsCodeApi } from "../../types";
import { ConfigurationDialogClose } from "./ConfigurationDialogClose";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import {
  MuseProviderSettings,
  type MuseProviderSettingsHandle,
} from "../settings/MuseProviderSettings";
import { AppearanceSettings } from "../settings/AppearanceSettings";
import { HostPluginPanel } from "../settings/HostPluginPanel";
import {
  AgentSettings,
  type AgentSettingsHandle,
} from "../settings/AgentSettings";
import { MuseApiClient, type HostPluginSettingsPanel } from "../../muse/apiClient";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import "../../styles/ConfigurationDialog.css";

/**
 * Radix 弹层（Select 下拉、DropdownMenu 菜单、Tooltip 等）默认 portal 到
 * document.body，DOM 不在 `.configuration-dialog` 内。点击这些弹层里的元素
 * 会被 outside-click 误判为「点设置弹窗外」而关闭整个设置弹窗。
 * 这里豁免：target 落在 Radix 弹层（popper wrapper / listbox）内时不算外部点击。
 */
export interface ConfigDialogHandle {
  /** False when a save is in flight or the user keeps unsaved drafts. */
  confirmDiscardUnsaved: () => boolean;
}

/** True when leaving the settings page for another rail destination should abort. */
export function settingsPageLeaveBlocked(
  current: string,
  next: string,
  page: ConfigDialogHandle | null,
): boolean {
  if (current !== "settings" || next === "settings") return false;
  return page?.confirmDiscardUnsaved() === false;
}

function isRadixPopupTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      '[data-radix-popper-content-wrapper], [role="listbox"], [role="menu"], [data-radix-select-content]',
    ),
  );
}

const ConfigDialog = forwardRef<
  ConfigDialogHandle,
  ConfigDialogProps & {
    vscode: VsCodeApi;
    isAuthenticated?: boolean;
    onLogin?: () => void;
    pluginPanels?: HostPluginSettingsPanel[];
  }
>(function ConfigDialog(
  { onCancel, layout = "dialog", isAuthenticated, onLogin, pluginPanels },
  ref,
) {
  const page = layout === "page";
  const dialogRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<MuseProviderSettingsHandle>(null);
  const agentSettingsRef = useRef<AgentSettingsHandle>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const savedTimerRef = useRef<number | null>(null);
  const [activeTab, setActiveTab] = useState("appearance");
  const [loadedPanels, setLoadedPanels] = useState<HostPluginSettingsPanel[]>([]);
  const savingRef = useRef(false);
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const panelTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 380, damping: 28 };
  const tabUnderlineTransition = reduceMotion ? { duration: 0 } : undefined;
  const tabRailStyle: React.CSSProperties = {
    position: "absolute",
    top: 6,
    bottom: 6,
    left: 0,
    width: 2,
    backgroundColor: "var(--accent-9)",
  };
  savingRef.current = saving;
  const persistTab = activeTab === "agent" || activeTab === "provider";

  const showSaved = useCallback(() => {
    setSavedNotice(true);
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => {
      savedTimerRef.current = null;
      setSavedNotice(false);
    }, 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    };
  }, []);
  useEffect(() => {
    if (pluginPanels) return;
    const client = new MuseApiClient({ baseUrl: resolveMuseServerUrl() });
    let cancelled = false;
    client
      .listHostPluginSettings()
      .then((body) => {
        if (!cancelled) setLoadedPanels(body.panels ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadedPanels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginPanels]);
  const panels = pluginPanels ?? loadedPanels;
  const settingsTabs = (
    <div className="config-tabs" role="tablist" aria-label="设置">
      {([
        ["appearance", "外观", "config-appearance-panel"],
        ["agent", "Agent", "config-agent-panel"],
        ["provider", "供应商", "config-provider-panel"],
        ...panels.map(
          (panel) =>
            [panel.id, panel.title, `config-plugin-${panel.id}`] as [
              string,
              string,
              string,
            ],
        ),
      ] as Array<[string, string, string]>).map(([id, label, controls]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={activeTab === id}
          aria-controls={controls}
          className={`config-tab${activeTab === id ? " active" : ""}`}
          onClick={() => {
            setSavedNotice(false);
            setActiveTab(id);
          }}
          style={{ position: "relative" }}
        >
          {label}
          {activeTab === id && (
            <motion.span
              className="settings-tab-underline"
              layoutId="settings-tab-underline"
              transition={tabUnderlineTransition}
              style={tabRailStyle}
            />
          )}
        </button>
      ))}
    </div>
  );
  useDialogFocusTrap(dialogRef, !page);

  const confirmDiscardUnsaved = useCallback(() => {
    if (savingRef.current) return false;
    if (settingsRef.current?.isDirty() || agentSettingsRef.current?.isDirty()) {
      return window.confirm("有未保存的修改，确定关闭？");
    }
    return true;
  }, []);

  useImperativeHandle(
    ref,
    () => ({ confirmDiscardUnsaved }),
    [confirmDiscardUnsaved],
  );

  const requestClose = useCallback(() => {
    if (!confirmDiscardUnsaved()) return;
    onCancel();
  }, [confirmDiscardUnsaved, onCancel]);

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

    if (page) return;

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
  }, [page, requestClose]);

  const handleSave = async () => {
    if (!persistTab) return;
    setSavedNotice(false);
    const finish = (ok: boolean | undefined) => {
      if (!ok) return;
      if (page) showSaved();
      else onCancel();
    };
    if (activeTab === "agent") {
      setSaving(true);
      try {
        finish(await agentSettingsRef.current?.save());
      } finally {
        setSaving(false);
      }
      return;
    }
    finish(await settingsRef.current?.save());
  };

  const panel = (
    <>
        <div className="configuration-dialog-header config-dialog-header">
          <h3 id="config-dialog-title">设置</h3>
          {page ? settingsTabs : null}
          {page ? (
            isAuthenticated === false && onLogin ? (
              <button
                type="button"
                className="desktop-sidebar-icon-btn"
                onClick={onLogin}
                data-testid="desktop-login-btn"
                aria-label="登录"
              >
                <span className="codicon codicon-sign-in" aria-hidden="true" />
              </button>
            ) : null
          ) : (
            <ConfigurationDialogClose onClick={requestClose} disabled={saving} />
          )}
        </div>

        <div className="config-dialog-body">
        {page ? null : settingsTabs}

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
            {panels.map((panel) => (
              <div
                key={panel.id}
                id={`config-plugin-${panel.id}`}
                role="tabpanel"
                hidden={activeTab !== panel.id}
              >
                <HostPluginPanel panel={panel} />
              </div>
            ))}
          </div>
        </div>
        </div>

          {!page || persistTab ? (
          <div className="configuration-actions">
            {page ? null : (
              <Button
                variant="soft"
                color="gray"
                onClick={requestClose}
                disabled={saving}
              >
                关闭
              </Button>
            )}
            {savedNotice ? (
              <span
                className="config-dialog-saved"
                role="status"
                data-testid="config-dialog-saved"
              >
                已保存
              </span>
            ) : null}
            {persistTab && (
              <Button
                onClick={() => void handleSave()}
                disabled={saving}
                data-testid="config-dialog-save"
              >
                {saving ? "保存中..." : "保存"}
              </Button>
            )}
          </div>
          ) : null}
    </>
  );

  if (page) {
    return (
      <div
        ref={dialogRef}
        className="configuration-dialog config-dialog desktop-settings-page"
        aria-labelledby="config-dialog-title"
        data-testid="desktop-settings-page"
      >
        {panel}
      </div>
    );
  }

  return (
    <motion.div
      className="configuration-dialog-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.16 }}
    >
      <motion.div
        ref={dialogRef}
        className={`configuration-dialog config-dialog${
          activeTab === "agent" ? " config-dialog--wide" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-dialog-title"
        data-testid="config-dialog"
        initial={
          reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }
        }
        animate={{ opacity: 1, scale: 1 }}
        transition={panelTransition}
      >
        {panel}
      </motion.div>
    </motion.div>
  );
});

export default ConfigDialog;
