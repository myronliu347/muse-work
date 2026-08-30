import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Select } from "@radix-ui/themes";
import {
  MuseApiClient,
  type MuseProvidersResponse,
} from "../../muse/apiClient";
import { DEFAULT_SESSION_MODEL_ID } from "../../muse/defaultModel";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import { MUSE_PROVIDERS_CHANGED_EVENT } from "../../muse/providersEvents";
import { Tooltip } from "./Tooltip";
import "../../styles/MuseModelSelect.css";

/** Radix Select items cannot use "" as a value; map the "留空" option through this sentinel. */
const EMPTY_VALUE = "__muse_model_empty__";

export interface MuseModelSelectProps {
  api?: MuseApiClient;
  /** Controlled session model id (sender / per-session). */
  modelId?: string;
  onModelChange?: (modelId: string) => void;
  /** default false — when true, also POST /providers/active (settings only) */
  syncGlobalActive?: boolean;
  /** When true, prepend an empty option (emptyLabel) whose value is "" — used
   *  for optional model fields ("留空=主模型"). Picking it calls onModelChange("").
   *  Default false; existing callers are unaffected. */
  allowEmpty?: boolean;
  /** Label for the empty option shown when allowEmpty is true. */
  emptyLabel?: string;
  /** data-testid on the trigger. Defaults to "muse-model-select". */
  testId?: string;
}

/**
 * Model selector for the *active* provider's model list, rendered as a Radix
 * Select with a fixed-width trigger (ellipsized) and a hover tooltip showing
 * the full model name.
 * Session path: pass modelId + onModelChange (no global setActive).
 * Settings path: set syncGlobalActive to also update providers/active.
 */
export const MuseModelSelect: React.FC<MuseModelSelectProps> = ({
  api,
  modelId,
  onModelChange,
  syncGlobalActive = false,
  allowEmpty = false,
  emptyLabel = "",
  testId = "muse-model-select",
}) => {
  const [data, setData] = useState<MuseProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useMemo(
    () =>
      api ??
      new MuseApiClient({
        baseUrl: resolveMuseServerUrl(),
      }),
    [api],
  );

  const refresh = useCallback(async () => {
    try {
      const body = await client.listProviders();
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    const onProvidersChanged = () => void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener(MUSE_PROVIDERS_CHANGED_EVENT, onProvidersChanged);
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        MUSE_PROVIDERS_CHANGED_EVENT,
        onProvidersChanged,
      );
      window.clearInterval(timer);
    };
  }, [refresh]);

  const activeProvider = data?.providers.find(
    (p) => p.id === data.active.providerId,
  );
  const models = activeProvider?.models ?? [];
  const resolvedModelId = modelId?.trim() ? modelId : undefined;
  const rawValue =
    resolvedModelId ??
    (allowEmpty
      ? ""
      : (onModelChange && !syncGlobalActive
          ? DEFAULT_SESSION_MODEL_ID
          : data?.active.modelId) ??
        data?.active.modelId ??
        "");

  const loading = !data || (models.length === 0 && !allowEmpty);
  // Keep the Radix Select fully controlled: loading uses "" so the placeholder
  // shows; an empty pick maps through the sentinel.
  const value = loading
    ? ""
    : rawValue === "" && allowEmpty
      ? EMPTY_VALUE
      : rawValue;

  const currentModel = models.find((m) => m.id === rawValue);
  const currentLabel = loading
    ? error ?? "加载模型…"
    : currentModel?.label ??
      (rawValue === "" ? emptyLabel || "（留空）" : rawValue);
  const tooltipText = error
    ? error
    : activeProvider
      ? `${activeProvider.displayName} · ${currentLabel}`
      : currentLabel;

  const handleValueChange = (next: string) => {
    if (!data?.active.providerId) return;
    const nextModelId = next === EMPTY_VALUE ? "" : next;
    onModelChange?.(nextModelId);
    if (syncGlobalActive || !onModelChange) {
      void client
        .setActive(data.active.providerId, nextModelId)
        .then(refresh);
    }
  };

  return (
    <Tooltip text={tooltipText} position="top" className="muse-model-select-tooltip">
      <Select.Root
        value={value}
        onValueChange={handleValueChange}
        disabled={loading}
      >
        <Select.Trigger
          data-testid={testId}
          aria-label="Model"
          placeholder={loading ? (error ? "模型不可用" : "加载模型…") : undefined}
          className="muse-model-select"
        />
        <Select.Content position="popper" className="muse-model-select-content">
          {!loading && allowEmpty && (
            <Select.Item value={EMPTY_VALUE}>
              {emptyLabel || "（留空）"}
            </Select.Item>
          )}
          {!loading &&
            models.map((m) => (
              <Select.Item key={m.id} value={m.id}>
                {m.label || m.id}
              </Select.Item>
            ))}
        </Select.Content>
      </Select.Root>
    </Tooltip>
  );
};

export default MuseModelSelect;
