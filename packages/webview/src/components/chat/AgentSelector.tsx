import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MuseApiClient } from "../../muse/apiClient";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import { useAgentsStore } from "../../stores/agentsStore";
import { AgentIcon } from "../shared/HeaderIcons";
import { Tooltip } from "../shared/Tooltip";
import "../../styles/AgentSelector.css";

/**
 * 消息输入框底部左侧的 agent（数字人）选择器。
 * 显示当前会话 agent（Session.agentName ?? session 场景映射），点击弹出全部
 * agent 列表，hover 显示名称 + 性格显示名 + 语气描述。
 */
export interface AgentSelectorProps {
  api?: MuseApiClient;
  /** 当前会话选中的 agent key（Session.agentName）。 */
  agentName?: string;
  /** 该会话所属场景的默认 agent key（session 场景映射；无会话 agentName 时展示）。 */
  defaultAgentName?: string;
  /** 会话切换/变更时刷新。 */
  onSelect?: (agentKey: string) => void;
  /** 输入框禁用态（agent 选择也禁用）。 */
  disabled?: boolean;
}

export const AgentSelector: React.FC<AgentSelectorProps> = ({
  api,
  agentName,
  defaultAgentName,
  onSelect,
  disabled,
}) => {
  const client = useMemo(
    () => api ?? new MuseApiClient({ baseUrl: resolveMuseServerUrl() }),
    [api],
  );
  const agents = useAgentsStore((s) => s.agents);
  const initStore = useAgentsStore((s) => s.init);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initStore(client);
  }, [client, initStore]);

  const currentKey = agentName ?? defaultAgentName ?? "";
  const currentAgent = agents.find((a) => a.key === currentKey);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const handleSelect = useCallback(
    (key: string) => {
      setOpen(false);
      onSelect?.(key);
    },
    [onSelect],
  );

  const displayName = currentAgent?.name ?? (currentKey || "默认");
  // 性格显示名：直接用 server PERSONALITIES 导出的 personalityLabel（单一数据源）
  const personalityLabel = currentAgent?.personalityLabel ?? "";

  const tooltipContent = (
    <div className="agent-selector-tooltip">
      <div className="agent-selector-tooltip-name">
        {currentAgent?.name ?? "未选择 agent"}
      </div>
      {personalityLabel && (
        <div className="agent-selector-tooltip-personality">
          性格：{personalityLabel}
        </div>
      )}
    </div>
  );

  return (
    <div className="agent-selector-container" ref={containerRef}>
      <Tooltip
        text={displayName}
        content={tooltipContent}
        position="top"
        wrap={false}
      >
        <button
          type="button"
          className={`agent-selector-trigger${open ? " open" : ""}`}
          data-testid="agent-selector"
          aria-label="选择 Agent"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
        >
          <AgentIcon className="agent-selector-icon" />
          <span className="agent-selector-label">{displayName}</span>
          <i className="codicon codicon-chevron-down agent-selector-caret" />
        </button>
      </Tooltip>
      {open && (
        <ul className="agent-selector-menu" role="listbox" data-testid="agent-selector-menu">
          {agents.map((a) => (
            <li
              key={a.key}
              role="option"
              aria-selected={a.key === currentKey}
              data-value={a.key}
              className={`agent-selector-item${a.key === currentKey ? " selected" : ""}`}
              onClick={() => handleSelect(a.key)}
            >
              <span className="agent-selector-item-name">{a.name}</span>
              <span className="agent-selector-item-personality">
                {a.personalityLabel ?? a.personality}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AgentSelector;
