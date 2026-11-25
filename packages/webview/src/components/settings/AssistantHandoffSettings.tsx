import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Select, Switch } from "@radix-ui/themes";
import {
  MuseApiClient,
  type AssistantHandoffState,
} from "../../muse/apiClient";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import "../../styles/AssistantHandoffSettings.css";

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

function formatWhen(at: number | undefined | null): string {
  if (!at) return "还没收工过";
  return new Date(at).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function AssistantHandoffSettings({ api }: { api?: MuseApiClient }) {
  const client = useMemo(
    () => api ?? new MuseApiClient({ baseUrl: resolveMuseServerUrl() }),
    [api],
  );
  const [state, setState] = useState<AssistantHandoffState | null>(null);
  const [busy, setBusy] = useState<"load" | "toggle" | "hour" | "run" | null>(
    "load",
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await client.getAssistantHandoff();
      setState(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    setBusy("load");
    void refresh().finally(() => setBusy(null));
  }, [refresh]);

  const update = async (patch: { enabled?: boolean; hour?: number }) => {
    setBusy(patch.enabled !== undefined ? "toggle" : "hour");
    setError(null);
    setNotice(null);
    try {
      const next = await client.setAssistantHandoff(patch);
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    if (!state) return;
    if (
      !window.confirm(
        "收工只换掉助手的内部上下文，聊天记录保留。现在收工？",
      )
    ) {
      return;
    }
    setBusy("run");
    setError(null);
    setNotice(null);
    try {
      const result = await client.runAssistantHandoff();
      await refresh();
      setNotice(
        result.skipped === "no_activity"
          ? "没有新的进展，已跳过这次收工。"
          : `已换好上下文；交接写在 ${result.handoffPath}。`,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(
        detail.includes("409")
          ? "助手还在处理事情，等这一轮结束再收工。"
          : detail,
      );
    } finally {
      setBusy(null);
    }
  };

  if (!state) {
    return (
      <div className="ah-root">
        <div className="ah-header">
          <h3>每日收工</h3>
          <p>
            收工时把正在推进的事项和下一步写进交接文件，只换助手的内部上下文，聊天记录保留。
          </p>
        </div>
        {error ? (
          <p className="ah-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="ah-muted">读取中…</p>
        )}
      </div>
    );
  }

  return (
    <div className="ah-root" data-testid="assistant-handoff-settings">
      <div className="ah-header">
        <h3>每日收工</h3>
        <p>
          收工时让助手自己写一份交接，只换掉助手的内部上下文，聊天记录不动，界面上不会出现收工通知。
          写不出来就不换；第二天助手从交接继续，不再背着几轮压缩后的旧上下文。
        </p>
      </div>

      <div className="ah-card ah-toggle-card">
        <div className="ah-toggle-text">
          <div className="ah-toggle-title">每天自动收工</div>
          <div className="ah-toggle-hint">
            默认 04:00。只在助手空闲时执行；当天已经用过助手、或还有事件在排队，就跳过。换班只影响内部上下文，不动聊天记录。关闭后仍可手动收工。
          </div>
        </div>
        <Switch
          checked={state.enabled}
          disabled={busy === "toggle" || busy === "run"}
          onCheckedChange={(checked) => void update({ enabled: checked })}
          aria-label="每天自动收工"
        />
      </div>

      <div className="ah-card ah-schedule-card">
        <div className="ah-row">
          <div>
            <div className="ah-row-title">收工时间</div>
            <div className="ah-row-hint">
              本机时间。到点时助手空闲才会执行；忙的话当天跳过，不打断。
            </div>
          </div>
          <Select.Root
            value={String(state.hour)}
            disabled={busy === "hour" || busy === "run"}
            onValueChange={(value) => void update({ hour: Number(value) })}
          >
            <Select.Trigger aria-label="收工时间" variant="soft" />
            <Select.Content>
              {HOUR_OPTIONS.map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </div>
        <div className="ah-meta">
          <span>
            {state.enabled
              ? `下次自动收工：${formatWhen(state.nextRunAt)}`
              : "自动收工已关闭"}
          </span>
          <span>上次：{formatWhen(state.lastRunAt)}</span>
          {state.working ? (
            <Badge size="1" color="blue" variant="soft">
              助手处理中
            </Badge>
          ) : null}
        </div>
      </div>

      {state.lastError ? (
        <p className="ah-error" role="alert">
          {state.lastError}
        </p>
      ) : null}
      {error ? (
        <p className="ah-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="ah-notice">{notice}</p> : null}

      <div className="ah-actions">
        <Button
          onClick={() => void runNow()}
          disabled={busy !== null || state.working}
          data-testid="assistant-handoff-run"
        >
          {busy === "run" ? "收工中…" : "立即收工"}
        </Button>
        <span className="ah-actions-hint">
          只换内部上下文，聊天记录和文件都不删；没写成交接就不会换。
        </span>
      </div>

      <div className="ah-card ah-preview">
        <div className="ah-preview-head">
          <span>当前交接</span>
          <span className="ah-preview-path">{state.handoffPath}</span>
        </div>
        {state.handoff ? (
          <details>
            <summary>展开查看</summary>
            <pre className="ah-preview-body">{state.handoff}</pre>
          </details>
        ) : (
          <p className="ah-muted">还没有交接。下次收工时会生成。</p>
        )}
      </div>
    </div>
  );
}

export default AssistantHandoffSettings;
