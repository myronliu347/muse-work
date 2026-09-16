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
  if (!automation.workdir) return "未选工作目录";
  return (
    automation.workdir.split(/[\\/]/).filter(Boolean).pop() || automation.workdir
  );
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
      setError(null);
      const res = automation.enabled
        ? await api.disableAutomation(automation.id)
        : await api.enableAutomation(automation.id);
      setAutomations((prev) =>
        prev.map((item) => (item.id === res.automation.id ? res.automation : item)),
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : "无法切换启用状态";
      setError(
        raw.includes("incomplete")
          ? "启用前需要指令、工作目录和至少一个触发器。"
          : raw.replace(/^Muse API \d+:\s*/, ""),
      );
    }
  };

  const createDraft = async () => {
    const { automation } = await api.createAutomation({});
    setAutomations((prev) => [automation, ...prev]);
    setSelectedId(automation.id);
  };

  return (
    <div
      className={`automations-page${selected ? " automations-page--editor" : ""}`}
      data-testid="automations-page"
    >
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
        <div className="automations-page-scroll">
          <div className="automations-page-inner">
            <div className="automations-page-head">
              <div>
                <h1>自动化</h1>
                <p>创建规则，按时间或条件自动运行 Agent。</p>
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
              <div className="automations-list">
                {automations.map((automation) => (
                  <div
                    key={automation.id}
                    className={`automations-card${automation.enabled ? "" : " off"}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(automation.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(automation.id);
                      }
                    }}
                  >
                    <button
                      type="button"
                      className={`automations-switch${automation.enabled ? " on" : ""}`}
                      aria-label="启用"
                      aria-checked={automation.enabled}
                      role="switch"
                      onClick={(event) => void toggle(automation, event)}
                    >
                      <i />
                    </button>
                    <div className="automations-card-body">
                      <div className="automations-card-title">
                        {automation.name.trim() || "未命名"}
                      </div>
                      <div className="automations-card-sub">
                        <span>
                          {automation.triggers.length
                            ? automation.triggers.map(summarizeTrigger).join(" · ")
                            : "未设置触发器"}
                        </span>
                        <span>{lastMeta(automation)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
