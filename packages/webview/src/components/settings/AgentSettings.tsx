import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { MuseApiClient } from "../../muse/apiClient";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import { Field } from "../../ui/Field";
import "../../styles/AgentSettings.css";

export interface AgentSettingsHandle {
  isDirty: () => boolean;
  /** Validate + PUT ~/.wave/settings.json. Returns true on success. */
  save: () => Promise<boolean>;
}

function validateJsonText(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "JSON 格式无效";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "根节点必须是 JSON 对象";
  }
  return null;
}

export const AgentSettings = forwardRef<
  AgentSettingsHandle,
  { api?: MuseApiClient }
>(function AgentSettings(props, ref) {
  const client = useMemo(
    () =>
      props.api ??
      new MuseApiClient({
        baseUrl: resolveMuseServerUrl(),
      }),
    [props.api],
  );
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [baseline, setBaseline] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parseError = useMemo(() => validateJsonText(text), [text]);

  useEffect(() => {
    let cancelled = false;
    void client.getSettingsRaw().then(
      (raw) => {
        if (cancelled) return;
        setPath(raw.path);
        setText(raw.content);
        setBaseline(raw.content);
        setLoadError(null);
        setSaveError(null);
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  const save = useCallback(async () => {
    const localError = validateJsonText(text);
    if (localError) {
      setSaveError(localError);
      return false;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const result = await client.putSettingsRaw(text);
      setPath(result.path);
      setText(result.content);
      setBaseline(result.content);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [client, text]);

  useImperativeHandle(
    ref,
    () => ({
      isDirty: () => text !== baseline,
      save,
    }),
    [text, baseline, save],
  );

  const error = loadError || saveError || parseError;

  return (
    <div data-testid="agent-settings" className="agent-settings">
      <Field
        label="Agent 设置"
        hint={
          path
            ? `编辑 Wave 用户配置 ${path}。保存后空闲会话会在下次对话重建 Agent；正在进行的对话不受影响。`
            : "读取 ~/.wave/settings.json"
        }
        error={error}
      >
        <textarea
          className="agent-settings-editor"
          data-testid="agent-settings-editor"
          spellCheck={false}
          value={text}
          disabled={!!loadError || saving}
          onChange={(event) => {
            setText(event.target.value);
            setSaveError(null);
          }}
          aria-invalid={Boolean(parseError || saveError)}
        />
      </Field>
    </div>
  );
});

export default AgentSettings;
