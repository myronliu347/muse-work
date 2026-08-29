import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MuseApiClient,
  type MuseProvidersResponse,
} from "../../muse/apiClient";
import { DEFAULT_SESSION_MODEL_ID } from "../../muse/defaultModel";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import { MUSE_PROVIDERS_CHANGED_EVENT } from "../../muse/providersEvents";

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
  /** data-testid on the native <select>. Defaults to "muse-model-select". */
  testId?: string;
}

/**
 * Model selector for the *active* provider's model list.
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
  const userDrivenRef = useRef(false);
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
  const value =
    resolvedModelId ??
    (allowEmpty
      ? ""
      : (onModelChange && !syncGlobalActive
          ? DEFAULT_SESSION_MODEL_ID
          : data?.active.modelId) ??
        data?.active.modelId ??
        "");

  return (
    <select
      data-testid={testId}
      aria-label="Model"
      value={value}
      disabled={!data || (models.length === 0 && !allowEmpty)}
      title={
        error ??
        (activeProvider
          ? `当前供应商：${activeProvider.displayName}`
          : undefined)
      }
      onMouseDown={() => {
        userDrivenRef.current = true;
      }}
      onPointerDown={() => {
        userDrivenRef.current = true;
      }}
      onKeyDown={() => {
        userDrivenRef.current = true;
      }}
      onBlur={() => {
        userDrivenRef.current = false;
      }}
      onChange={(e) => {
        if (!data?.active.providerId) return;
        const nextModelId = e.target.value;
        if (!userDrivenRef.current) {
          // Chromium fires change with models[0] when <option>s replace the
          // loading placeholder. Restore the controlled value.
          e.target.value = value;
          return;
        }
        userDrivenRef.current = false;
        onModelChange?.(nextModelId);
        if (syncGlobalActive || !onModelChange) {
          void client
            .setActive(data.active.providerId, nextModelId)
            .then(refresh);
        }
      }}
      className="muse-model-select"
    >
      {models.length === 0 && !allowEmpty ? (
        <option value="">{error ? "模型不可用" : "加载模型…"}</option>
      ) : (
        <>
          {allowEmpty && (
            <option value="">{emptyLabel || "（留空）"}</option>
          )}
          {models.length === 0 ? (
            <option value="" disabled>
              {error ? "模型不可用" : "加载模型…"}
            </option>
          ) : (
            models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label || m.id}
              </option>
            ))
          )}
        </>
      )}
    </select>
  );
};

export default MuseModelSelect;
