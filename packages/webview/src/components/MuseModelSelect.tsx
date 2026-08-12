import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  MuseApiClient,
  type MuseProvidersResponse,
} from "../muse/apiClient";
import { resolveMuseServerUrl } from "../muse/hostBridge";

export interface MuseModelSelectProps {
  api?: MuseApiClient;
}

/**
 * Header model selector for the *active* provider only.
 * Provider switching lives in Settings → AI 供应商.
 */
export const MuseModelSelect: React.FC<MuseModelSelectProps> = ({ api }) => {
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
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const activeProvider = data?.providers.find(
    (p) => p.id === data.active.providerId,
  );
  const models = activeProvider?.models ?? [];
  const value = data?.active.modelId ?? "";

  return (
    <select
      data-testid="muse-model-select"
      aria-label="Model"
      value={value}
      disabled={!data || models.length === 0}
      title={
        error ??
        (activeProvider
          ? `当前供应商：${activeProvider.displayName}`
          : undefined)
      }
      onChange={(e) => {
        if (!data?.active.providerId) return;
        const modelId = e.target.value;
        void client.setActive(data.active.providerId, modelId).then(refresh);
      }}
      style={{
        maxWidth: 220,
        fontSize: 12,
        height: 24,
        borderRadius: 4,
        border: "1px solid var(--vscode-dropdown-border, #555)",
        background: "var(--vscode-dropdown-background, #1e1e1e)",
        color: "var(--vscode-dropdown-foreground, #ccc)",
      }}
    >
      {models.length === 0 ? (
        <option value="">{error ? "模型不可用" : "加载模型…"}</option>
      ) : (
        models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label || m.id}
          </option>
        ))
      )}
    </select>
  );
};

export default MuseModelSelect;
