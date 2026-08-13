import React, { useEffect, useMemo, useState } from "react";
import {
  MuseApiClient,
  type MuseSettings,
} from "../muse/apiClient";
import { resolveMuseServerUrl } from "../muse/hostBridge";
import { Field } from "../ui/Field";

export function PluginSettings(props: { api?: MuseApiClient }) {
  const client = useMemo(
    () =>
      props.api ??
      new MuseApiClient({
        baseUrl: resolveMuseServerUrl(),
      }),
    [props.api],
  );
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void client.getSettings().then(
      (settings: MuseSettings) => {
        if (cancelled) return;
        setEnabled(settings.plugins.superpowers);
        setError(null);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  const onToggle = async (next: boolean) => {
    const prev = enabled;
    setEnabled(next);
    setError(null);
    setPending(true);
    try {
      const settings = await client.updateSettings({
        plugins: { superpowers: next },
      });
      setEnabled(settings.plugins.superpowers);
    } catch (err) {
      setEnabled(prev);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div data-testid="plugin-settings">
      <Field
        label="Superpowers"
        hint="内置技能库（TDD、调试、协作流程）。关闭后新的对话轮次不再加载这些 skill。"
        error={error}
      >
        <div className="config-project-row">
          <span className="config-project-title">启用插件</span>
          <label className="switch">
            <input
              type="checkbox"
              data-testid="superpowers-toggle"
              checked={enabled}
              disabled={pending}
              onChange={(event) => {
                void onToggle(event.target.checked);
              }}
            />
            <span className="slider round" />
          </label>
        </div>
      </Field>
    </div>
  );
}
