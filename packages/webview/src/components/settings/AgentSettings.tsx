import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { MuseApiClient } from "../../muse/apiClient";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import { Field } from "../../ui/Field";
import { AgentManager } from "./AgentManager";
import "../../styles/AgentSettings.css";

export interface AgentSettingsHandle {
  isDirty: () => boolean;
  /** 保存数字人 agent + 场景映射 + ~/.wave/settings.json。Returns true on success. */
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
  const managerRef = useRef<{ save: () => Promise<boolean> }>(null);

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

  const saveRawJson = useCallback(async (): Promise<boolean> => {
    const localError = validateJsonText(text);
    if (localError) {
      setSaveError(localError);
      return false;
    }
    try {
      const result = await client.putSettingsRaw(text);
      setPath(result.path);
      setText(result.content);
      setBaseline(result.content);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [client, text]);

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      // 先保存数字人 agent + 场景映射（内部自校验），再保存原始 JSON
      if (managerRef.current) {
        const ok = await managerRef.current.save();
        if (!ok) return false;
      }
      return await saveRawJson();
    } finally {
      setSaving(false);
    }
  }, [saveRawJson]);

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
    <div
      data-testid="agent-settings"
      className="muse-settings-stack agent-settings"
    >
      {/* 数字人 agent 管理 + 场景映射（新） */}
      <AgentManager api={client} ref={managerRef} />

      {/* 原 ~/.wave/settings.json 原始 JSON 编辑器（保留现状） */}
      <div className="agent-settings-raw">
        <Field
          label="Wave 用户配置（原始 JSON）"
          hint={
            path
              ? `编辑 ${path}。保存后空闲会话会在下次对话重建 Agent；正在进行的对话不受影响。`
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
    </div>
  );
});

export default AgentSettings;
