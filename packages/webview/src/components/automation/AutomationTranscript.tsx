import { useEffect, useState } from "react";
import type { MuseApiClient, MuseAutomationRun } from "../../muse/apiClient";

function messageText(message: unknown): { role: string; text: string } {
  if (!message || typeof message !== "object") {
    return { role: "message", text: String(message ?? "") };
  }
  const rec = message as Record<string, unknown>;
  const role = typeof rec.role === "string" ? rec.role : "message";
  if (typeof rec.content === "string") return { role, text: rec.content };
  if (Array.isArray(rec.content)) {
    const text = rec.content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
    return { role, text };
  }
  return { role, text: JSON.stringify(message) };
}

export const AutomationTranscript: React.FC<{
  api: MuseApiClient;
  run: MuseAutomationRun;
  onClose: () => void;
  onStop: () => void;
}> = ({ api, run, onClose, onStop }) => {
  const [messages, setMessages] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!run.sessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void api
      .getMessages(run.sessionId)
      .then((res) => {
        if (!cancelled) setMessages(res.messages);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, run.sessionId]);

  return (
    <aside className="automations-drawer" data-testid="automation-transcript">
      <div className="automations-drawer-h">
        <strong>运行</strong>
        <span className="automations-grow" />
        {run.status === "running" ? (
          <button
            type="button"
            className="automations-btn automations-btn-ghost"
            onClick={onStop}
          >
            停止
          </button>
        ) : null}
        <button
          type="button"
          className="automations-btn automations-btn-ghost"
          onClick={onClose}
        >
          关闭
        </button>
      </div>
      <div className="automations-msgs">
        {run.status === "skipped" ? (
          <div className="automations-bubble">
            <div className="k">系统</div>
            未启动 Agent。
            {run.skipReason === "rule_running"
              ? "该规则已有一轮在跑"
              : run.skipReason === "global_concurrency"
                ? "全局并发已满"
                : ""}
          </div>
        ) : null}
        {error ? <div className="automations-bubble">{error}</div> : null}
        {messages.map((message, index) => {
          const item = messageText(message);
          return (
            <div className="automations-bubble" key={index}>
              <div className="k">{item.role}</div>
              {item.text}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
