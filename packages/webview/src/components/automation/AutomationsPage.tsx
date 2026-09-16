import { useCallback, useEffect, useState } from "react";
import type { MuseApiClient, MuseAutomation } from "../../muse/apiClient";
import { AutomationEditor } from "./AutomationEditor";
import { summarizeTrigger } from "./scheduleUi";
import "../../styles/AutomationsPage.css";
import "../../styles/ConfirmDialog.css";

type PostToHost = (msg: Record<string, unknown>) => void;

export interface AutomationsPageProps {
  api: MuseApiClient;
  postToHost: PostToHost;
  recentWorkdirs: string[];
}

function lastMeta(automation: MuseAutomation): string {
  return automation.enabled ? "尚未运行" : "已停用";
}

export const AutomationsPage: React.FC<AutomationsPageProps> = ({
  api,
  postToHost,
  recentWorkdirs,
}) => {
  const [automations, setAutomations] = useState<MuseAutomation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.listAutomations();
    setAutomations(res.automations);
  }, [api]);

  useEffect(() => {
    void load().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [load]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.command !== "automation:changed") return;
      void load().catch(() => undefined);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [load]);

  const selected = automations.find((item) => item.id === selectedId) ?? null;

  const toggle = async (automation: MuseAutomation, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const res = automation.enabled
        ? await api.disableAutomation(automation.id)
        : await api.enableAutomation(automation.id);
      setAutomations((prev) =>
        prev.map((item) => (item.id === res.automation.id ? res.automation : item)),
      );
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "无法切换启用状态");
    }
  };

  const createDraft = async () => {
    const { automation } = await api.createAutomation({});
    setAutomations((prev) => [automation, ...prev]);
    setSelectedId(automation.id);
  };

  return (
    <div className="automations-page" data-testid="automations-page">
      <div className="automations-page-scroll">
        {selected ? (
          <AutomationEditor
            key={selected.id}
            api={api}
            automation={selected}
            recentWorkdirs={recentWorkdirs}
            postToHost={postToHost}
            onBack={() => {
              setSelectedId(null);
              void load();
            }}
            onChanged={(next) => {
              setAutomations((prev) =>
                prev.map((item) => (item.id === next.id ? next : item)),
              );
            }}
            onDeleted={() => {
              setSelectedId(null);
              void load();
            }}
          />
        ) : (
          <div className="automations-page-inner">
            <div className="automations-page-head">
              <div>
                <h1>自动化</h1>
                <p>按定时或本机 Issue 事件无人值守跑 Agent。运行记录不进日常会话。</p>
              </div>
              <span className="automations-grow" />
              <button
                type="button"
                className="automations-btn automations-btn-primary"
                onClick={() => void createDraft()}
              >
                新建自动化
              </button>
            </div>
            {error ? <div className="automations-empty">{error}</div> : null}
            {automations.length === 0 && !error ? (
              <div className="automations-empty">还没有自动化。点右上角新建。</div>
            ) : (
              automations.map((automation) => (
                <button
                  key={automation.id}
                  type="button"
                  className={`automations-card${automation.enabled ? "" : " off"}`}
                  onClick={() => setSelectedId(automation.id)}
                >
                  <span
                    className={`automations-switch${automation.enabled ? " on" : ""}`}
                    role="switch"
                    aria-checked={automation.enabled}
                    onClick={(event) => void toggle(automation, event)}
                  >
                    <i />
                  </span>
                  <div className="automations-card-body">
                    <div className="automations-card-title">
                      {automation.name.trim() || "未命名"}
                    </div>
                    <div className="automations-card-sub">
                      <span className="automations-pill">
                        {automation.triggers.length
                          ? automation.triggers.map(summarizeTrigger).join(" · ")
                          : "未设置触发器"}
                      </span>
                      <span>{automation.workdir || "未选目录"}</span>
                    </div>
                  </div>
                  <span className="automations-pill">{lastMeta(automation)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
