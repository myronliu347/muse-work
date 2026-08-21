import React, { useEffect, useMemo, useState } from "react";
import {
  MuseApiClient,
  type MuseSettings,
} from "../../muse/apiClient";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import { Field } from "../../ui/Field";

function PluginToggle(props: {
  label: string;
  hint: string;
  testId: string;
  checked: boolean;
  pending: boolean;
  error?: string | null;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Field label={props.label} hint={props.hint} error={props.error}>
      <label className="switch">
        <input
          type="checkbox"
          data-testid={props.testId}
          checked={props.checked}
          disabled={props.pending}
          onChange={(event) => {
            props.onToggle(event.target.checked);
          }}
        />
        <span className="slider round" />
      </label>
    </Field>
  );
}

export function PluginSettings(props: { api?: MuseApiClient }) {
  const client = useMemo(
    () =>
      props.api ??
      new MuseApiClient({
        baseUrl: resolveMuseServerUrl(),
      }),
    [props.api],
  );
  const [plugins, setPlugins] = useState({ superpowers: false, mattpocock: true });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void client.getSettings().then(
      (settings: MuseSettings) => {
        if (cancelled) return;
        setPlugins(settings.plugins);
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

  const onToggle = async (key: "superpowers" | "mattpocock", next: boolean) => {
    const prev = plugins;
    setPlugins({ ...plugins, [key]: next });
    setError(null);
    setPending(true);
    try {
      const settings = await client.updateSettings({
        plugins: { [key]: next },
      });
      setPlugins(settings.plugins);
    } catch (err) {
      setPlugins(prev);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="muse-settings-stack" data-testid="plugin-settings">
      <PluginToggle
        label="Matt Pocock Skills"
        hint="Matt Pocock 的工程技能库（grilling 追问、TDD、spec/ticket 流程、code review、domain modeling 等）。关闭后新的对话轮次不再加载这些 skill。"
        testId="mattpocock-toggle"
        checked={plugins.mattpocock}
        pending={pending}
        error={error}
        onToggle={(next) => onToggle("mattpocock", next)}
      />
      <PluginToggle
        label="Superpowers"
        hint="内置技能库（TDD、调试、协作流程）。关闭后新的对话轮次不再加载这些 skill。"
        testId="superpowers-toggle"
        checked={plugins.superpowers}
        pending={pending}
        error={error}
        onToggle={(next) => onToggle("superpowers", next)}
      />
    </div>
  );
}
