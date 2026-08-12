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
 * Minimal provider/model selector wired to Muse HTTP `/providers` + `/providers/active`.
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
  }, [refresh]);

  const value = data
    ? `${data.active.providerId}::${data.active.modelId ?? ""}`
    : "";

  const options =
    data?.providers.flatMap((p) =>
      p.models.map((m) => ({
        key: `${p.id}::${m.id}`,
        label: `${p.displayName} / ${m.label || m.id}`,
        providerId: p.id,
        modelId: m.id,
      })),
    ) ?? [];

  return (
    <select
      data-testid="muse-model-select"
      aria-label="Model"
      value={value}
      disabled={!data || options.length === 0}
      title={error ?? undefined}
      onChange={(e) => {
        const opt = options.find((o) => o.key === e.target.value);
        if (!opt) return;
        void client.setActive(opt.providerId, opt.modelId).then(refresh);
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
      {options.length === 0 ? (
        <option value="">{error ? "模型不可用" : "加载模型…"}</option>
      ) : (
        options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))
      )}
    </select>
  );
};

export default MuseModelSelect;
