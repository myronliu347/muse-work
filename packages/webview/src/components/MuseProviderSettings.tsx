import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Progress,
  Select,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import {
  MuseApiClient,
  type MuseCodeMakerQuota,
  type MuseModelInfo,
  type MuseOpenAiCompatibleConfig,
  type MuseProvidersResponse,
} from "../muse/apiClient";
import { resolveMuseServerUrl } from "../muse/hostBridge";
import { notifyProvidersChanged } from "../muse/providersEvents";
import { Field } from "../ui/Field";

export interface MuseProviderSettingsProps {
  api?: MuseApiClient;
  onSavingChange?: (saving: boolean) => void;
}

export interface MuseProviderSettingsHandle {
  /** Persist draft settings. Returns true on success. */
  save: () => Promise<boolean>;
  /** Whether the draft differs from the last loaded/saved baseline. */
  isDirty: () => boolean;
}

function formatQuotaNumber(n: number | undefined): string {
  if (n === undefined) return "—";
  return `￥${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatQuotaPercent(n: number | undefined): string {
  if (n === undefined) return "—";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function quotaBarWidth(percentage: number | undefined): number {
  if (percentage === undefined || !Number.isFinite(percentage)) return 0;
  return Math.min(100, Math.max(0, percentage));
}

function modelsToText(models: MuseModelInfo[]): string {
  return models
    .map((m) => (m.label && m.label !== m.id ? `${m.id}|${m.label}` : m.id))
    .join("\n");
}

function parseModelsText(text: string): MuseModelInfo[] {
  const models: MuseModelInfo[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf("|");
    if (sep === -1) {
      models.push({ id: trimmed, label: trimmed });
    } else {
      const id = trimmed.slice(0, sep).trim();
      const label = trimmed.slice(sep + 1).trim() || id;
      if (id) models.push({ id, label });
    }
  }
  return models;
}

/**
 * Provider settings panel (draft until parent calls save via ref).
 */
export const MuseProviderSettings = forwardRef<
  MuseProviderSettingsHandle,
  MuseProviderSettingsProps
>(function MuseProviderSettings({ api, onSavingChange }, ref) {
  const [data, setData] = useState<MuseProvidersResponse | null>(null);
  const [draftProviderId, setDraftProviderId] = useState("");
  const [quota, setQuota] = useState<MuseCodeMakerQuota | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [openaiCfg, setOpenaiCfg] = useState<MuseOpenAiCompatibleConfig | null>(
    null,
  );
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const baselineRef = useRef<{
    providerId: string;
    baseURL: string;
    modelsText: string;
  }>({ providerId: "", baseURL: "", modelsText: "" });
  /** Bumps on each panel load so stale responses are ignored. */
  const loadGenRef = useRef(0);

  const client = useMemo(
    () =>
      api ??
      new MuseApiClient({
        baseUrl: resolveMuseServerUrl(),
      }),
    [api],
  );

  const setSavingState = useCallback(
    (next: boolean) => {
      setSaving(next);
      onSavingChange?.(next);
    },
    [onSavingChange],
  );

  const loadQuota = useCallback(
    async (gen: number) => {
      setQuota(null);
      setQuotaError(null);
      try {
        const body = await client.getCodeMakerQuota();
        if (gen !== loadGenRef.current) return;
        setQuota(body);
      } catch (err) {
        if (gen !== loadGenRef.current) return;
        setQuota(null);
        setQuotaError(err instanceof Error ? err.message : String(err));
      }
    },
    [client],
  );

  const loadOpenai = useCallback(
    async (gen: number) => {
      try {
        const cfg = await client.getOpenAiCompatibleConfig();
        if (gen !== loadGenRef.current) return;
        setOpenaiCfg(cfg);
        setBaseURL(cfg.baseURL);
        setApiKey("");
        const text = modelsToText(cfg.models);
        setModelsText(text);
        baselineRef.current = {
          ...baselineRef.current,
          baseURL: cfg.baseURL,
          modelsText: text,
        };
      } catch (err) {
        if (gen !== loadGenRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [client],
  );

  const loadPanelForProvider = useCallback(
    async (providerId: string) => {
      const gen = ++loadGenRef.current;
      if (providerId === "codemaker") {
        setOpenaiCfg(null);
        await loadQuota(gen);
      } else if (providerId === "openai-compatible") {
        setQuota(null);
        setQuotaError(null);
        await loadOpenai(gen);
      }
    },
    [loadQuota, loadOpenai],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await client.listProviders();
        if (cancelled) return;
        setData(body);
        setDraftProviderId(body.active.providerId);
        baselineRef.current = {
          ...baselineRef.current,
          providerId: body.active.providerId,
        };
        setError(null);
        await loadPanelForProvider(body.active.providerId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
      loadGenRef.current += 1;
    };
  }, [client, loadPanelForProvider]);

  const onChangeProvider = (providerId: string) => {
    if (!data) return;
    const provider = data.providers.find((p) => p.id === providerId);
    if (!provider) return;
    setDraftProviderId(providerId);
    setError(null);
    void loadPanelForProvider(providerId);
  };

  const isDirty = useCallback(() => {
    const baseline = baselineRef.current;
    if (!baseline.providerId) return false;
    if (draftProviderId !== baseline.providerId) return true;
    if (draftProviderId === "openai-compatible") {
      if (baseURL.trim() !== baseline.baseURL.trim()) return true;
      if (modelsText !== baseline.modelsText) return true;
      if (apiKey.trim() !== "") return true;
    }
    return false;
  }, [apiKey, baseURL, draftProviderId, modelsText]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!data || !draftProviderId) return false;

    let modelId: string;
    let openaiModels: MuseModelInfo[] | null = null;

    if (draftProviderId === "openai-compatible") {
      openaiModels = parseModelsText(modelsText);
      if (openaiModels.length === 0) {
        setError("请至少配置一个 model（每行一个：id 或 id|显示名）");
        return false;
      }
      modelId =
        openaiModels.find((m) => m.id === data.active.modelId)?.id ??
        openaiModels[0]!.id;
    } else {
      const provider = data.providers.find((p) => p.id === draftProviderId);
      if (!provider || provider.models.length === 0) {
        setError("该供应商没有可用模型");
        return false;
      }
      modelId =
        provider.models.find((m) => m.id === data.active.modelId)?.id ??
        provider.models[0]!.id;
    }

    setSavingState(true);
    setError(null);
    try {
      if (draftProviderId === "openai-compatible" && openaiModels) {
        const patch: {
          baseURL: string;
          models: MuseModelInfo[];
          apiKey?: string;
        } = { baseURL: baseURL.trim(), models: openaiModels };
        if (apiKey.trim()) patch.apiKey = apiKey.trim();
        await client.updateOpenAiCompatibleConfig(patch);
      }
      await client.setActive(draftProviderId, modelId);
      const body = await client.listProviders();
      setData(body);
      setDraftProviderId(body.active.providerId);
      baselineRef.current = {
        providerId: body.active.providerId,
        baseURL: baseURL.trim(),
        modelsText,
      };
      setApiKey("");
      notifyProvidersChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSavingState(false);
    }
  }, [
    apiKey,
    baseURL,
    client,
    data,
    draftProviderId,
    modelsText,
    setSavingState,
  ]);

  useImperativeHandle(ref, () => ({ save, isDirty }), [save, isDirty]);

  return (
    <div className="muse-settings-stack" data-testid="muse-provider-settings">
      <Field label="AI 供应商 (Provider)" htmlFor="muse-provider">
        <Select.Root
          value={draftProviderId}
          disabled={!data || saving}
          onValueChange={onChangeProvider}
        >
          <Select.Trigger
            id="muse-provider"
            aria-label="AI 供应商 (Provider)"
            title={error ?? undefined}
            placeholder={error ? "加载失败" : "加载中…"}
          />
          <Select.Content>
            {data?.providers.map((p) => (
              <Select.Item key={p.id} value={p.id}>
                {p.displayName}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Field>

      {draftProviderId === "codemaker" && (
        <div data-testid="muse-codemaker-quota">
          <div className="muse-quota-header">
            <label>Token 额度</label>
            {quota?.user ? (
              <span className="muse-quota-user">{quota.user}</span>
            ) : null}
          </div>
          {quotaError ? (
            <div className="config-model-hint">
              <span>{quotaError}</span>
            </div>
          ) : !quota ? (
            <div className="config-model-hint">
              <span>加载中…</span>
            </div>
          ) : (
            <div className="muse-quota-grid">
              <div className="muse-quota-row">
                <span className="muse-quota-label">总额度</span>
                <span>{formatQuotaNumber(quota.total)}</span>
              </div>
              <div className="muse-quota-row">
                <span className="muse-quota-label">已使用</span>
                <span>{formatQuotaNumber(quota.used)}</span>
              </div>
              <div className="muse-quota-row">
                <span className="muse-quota-label">剩余</span>
                <span>{formatQuotaNumber(quota.remaining)}</span>
              </div>
              <div className="muse-quota-progress">
                <div className="muse-quota-progress-meta">
                  <span className="muse-quota-label">本月使用</span>
                  <span>{formatQuotaPercent(quota.percentage)}</span>
                </div>
                <Progress
                  data-testid="muse-quota-progress"
                  value={quotaBarWidth(quota.percentage)}
                  aria-label="本月额度使用百分比"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {draftProviderId === "openai-compatible" && (
        <div className="muse-settings-stack" data-testid="muse-openai-form">
          <Field label="API URL" htmlFor="muse-openai-base-url">
            <TextField.Root
              id="muse-openai-base-url"
              type="text"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              disabled={saving || !openaiCfg}
              placeholder="https://api.example.com/v1"
            />
          </Field>
          <Field label="API Key" htmlFor="muse-openai-api-key">
            <TextField.Root
              id="muse-openai-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={saving || !openaiCfg}
              placeholder={
                openaiCfg?.hasApiKey
                  ? "已配置（留空则保持不变）"
                  : "请输入 API Key"
              }
              autoComplete="off"
            />
          </Field>
          <Field
            label="支持的 Model 列表"
            htmlFor="muse-openai-models"
            hint="每行一个模型：`id` 或 `id|显示名`。"
          >
            <TextArea
              id="muse-openai-models"
              value={modelsText}
              onChange={(e) => setModelsText(e.target.value)}
              disabled={saving || !openaiCfg}
              rows={6}
              placeholder={"gpt-4.1\ngpt-4.1-mini|GPT-4.1 Mini"}
            />
          </Field>
        </div>
      )}

      {error && (
        <div className="configuration-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      <Text size="1" color="gray">
        修改后需点击保存才生效；下次发消息会按新配置重建 Agent。
      </Text>
    </div>
  );
});

export default MuseProviderSettings;
