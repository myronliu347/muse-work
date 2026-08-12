import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  MuseApiClient,
  type MuseProvidersResponse,
} from "../muse/apiClient";
import { resolveMuseServerUrl } from "../muse/hostBridge";

export interface MuseProviderSettingsProps {
  api?: MuseApiClient;
}

/**
 * Provider picker for the settings dialog. Changing provider keeps a model
 * from that provider (prefer previous model id if still present, else first).
 */
export const MuseProviderSettings: React.FC<MuseProviderSettingsProps> = ({
  api,
}) => {
  const [data, setData] = useState<MuseProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  const onChangeProvider = async (providerId: string) => {
    if (!data) return;
    const provider = data.providers.find((p) => p.id === providerId);
    if (!provider || provider.models.length === 0) return;
    const keep =
      provider.models.find((m) => m.id === data.active.modelId)?.id ??
      provider.models[0]!.id;
    setSaving(true);
    try {
      await client.setActive(providerId, keep);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="configuration-field" data-testid="muse-provider-settings">
      <label htmlFor="muse-provider">AI 供应商 (Provider)</label>
      <select
        id="muse-provider"
        className="configuration-select"
        value={data?.active.providerId ?? ""}
        disabled={!data || saving}
        title={error ?? undefined}
        onChange={(e) => void onChangeProvider(e.target.value)}
      >
        {!data ? (
          <option value="">{error ? "加载失败" : "加载中…"}</option>
        ) : (
          data.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))
        )}
      </select>
      {error && (
        <div className="config-model-hint" style={{ marginTop: 8 }}>
          <span>{error}</span>
        </div>
      )}
      <div className="config-model-hint" style={{ marginTop: 8 }}>
        <span>切换供应商后，顶部模型列表会更新为该供应商下的可用模型。</span>
      </div>
    </div>
  );
};

export default MuseProviderSettings;
