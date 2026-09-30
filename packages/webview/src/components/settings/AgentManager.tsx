import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { Text } from "@radix-ui/themes";
import { MuseApiClient } from "../../muse/apiClient";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import { useScenarioModelsStore } from "../../stores/scenarioModelsStore";
import { MuseModelSelect } from "../shared/MuseModelSelect";
import "../../styles/AgentManager.css";

const SCENARIO_LABELS: Array<{
  key: "session" | "popo" | "issue-plan" | "issue-exec";
  label: string;
}> = [
  { key: "session", label: "普通会话" },
  { key: "popo", label: "POPO 机器人" },
  { key: "issue-plan", label: "Issue 规划" },
  { key: "issue-exec", label: "Issue 执行" },
];

export interface AgentManagerHandle {
  save: () => Promise<boolean>;
}

export const AgentManager = forwardRef<
  AgentManagerHandle,
  { api?: MuseApiClient }
>(function AgentManager(props, ref) {
  const client = useMemo(
    () =>
      props.api ??
      new MuseApiClient({
        baseUrl: resolveMuseServerUrl(),
      }),
    [props.api],
  );
  const [models, setModels] = useState<
    Partial<Record<(typeof SCENARIO_LABELS)[number]["key"], string>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await client.getScenarioModels();
      setModels(res.models);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (): Promise<boolean> => {
    setError(null);
    for (const s of SCENARIO_LABELS) {
      if (!models[s.key]?.trim()) {
        setError(`${s.label} 须选择默认模型`);
        return false;
      }
    }
    try {
      const res = await client.putScenarioModels({
        version: 1,
        models: {
          session: models.session!,
          popo: models.popo!,
          "issue-plan": models["issue-plan"]!,
          "issue-exec": models["issue-exec"]!,
        },
      });
      setModels(res.models);
      void useScenarioModelsStore.getState().refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [client, models]);

  useImperativeHandle(ref, () => ({ save }), [save]);

  if (loadError) {
    return <div className="agent-manager-error">{loadError}</div>;
  }

  return (
    <div className="agent-manager" data-testid="agent-manager">
      <div className="agent-manager-section">
        <div className="agent-manager-header">
          <h4>场景默认模型</h4>
        </div>
        <Text as="p" size="2" color="gray" mb="3">
          为不同使用场景指定默认模型；新会话与对应 Issue 流程会优先使用该模型（仍可在输入框单独切换）。
        </Text>
        <div className="agent-manager-scenarios">
          {SCENARIO_LABELS.map((s) => (
            <div key={s.key} className="agent-manager-scenario-row">
              <span className="agent-manager-scenario-label">{s.label}</span>
              <MuseModelSelect
                api={client}
                modelId={models[s.key] || undefined}
                onModelChange={(modelId) =>
                  setModels((prev) => ({ ...prev, [s.key]: modelId }))
                }
                triggerVariant="surface"
                testId={`scenario-model-${s.key}`}
              />
            </div>
          ))}
        </div>
        {error && <div className="agent-manager-error">{error}</div>}
      </div>
    </div>
  );
});

export default AgentManager;
