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
  Button,
  Dialog,
  Select,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import {
  MuseApiClient,
  type MuseAgent,
} from "../../muse/apiClient";
import { resolveMuseServerUrl } from "../../muse/hostBridge";
import { useAgentsStore } from "../../stores/agentsStore";
import { MuseModelSelect } from "../shared/MuseModelSelect";
import { Field } from "../../ui/Field";
import "../../styles/AgentManager.css";

/** 内置 agent key 不可删除。 */
const BUILTIN_AGENT_KEYS = new Set(["default", "plan", "execute", "popo"]);

/** 10 选一性格（与 server PERSONALITIES 对齐）。 */
const PERSONALITIES: Array<{ key: string; label: string; description: string }> = [
  { key: "professional", label: "专业严谨", description: "用语规范、逻辑严密、直奔重点，不过度寒暄" },
  { key: "warm-patient", label: "温和耐心", description: "语气柔和、详细解释、循循善诱" },
  { key: "lively", label: "活泼热情", description: "轻快积极、爱用语气词、乐于鼓励" },
  { key: "humorous", label: "幽默风趣", description: "轻松搞笑、偶尔调侃、活跃气氛" },
  { key: "concise", label: "简洁干练", description: "惜字如金、只给结论、不绕弯" },
  { key: "rational", label: "理性冷静", description: "客观中立、克制情绪、就事论事" },
  { key: "energetic", label: "元气满满", description: "精力充沛、热血鼓励、行动力强" },
  { key: "wise-terse", label: "高冷睿智", description: "话少但精、一针见血、气场沉稳" },
  { key: "scholarly", label: "学术严谨", description: "引经据典、结构严谨、深入全面" },
  { key: "friendly", label: "亲切贴心", description: "像朋友、考虑感受、细致周到" },
];

export interface AgentForm {
  key: string;
  name: string;
  personality: string;
  systemPrompt: string;
  model: string;
  fastModel: string;
  tools: string;
  permission: string;
}

function toForm(agent: MuseAgent): AgentForm {
  return {
    key: agent.key,
    name: agent.name,
    personality: agent.personality,
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    fastModel: agent.fastModel,
    tools: (agent.tools ?? []).join(", "),
    permission: (agent.permission ?? []).join("\n"),
  };
}

function fromForm(form: AgentForm): Partial<MuseAgent> {
  const tools = form.tools
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const permission = form.permission
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const agent: Partial<MuseAgent> = {
    name: form.name.trim(),
    personality: form.personality,
  };
  if (form.systemPrompt.trim()) agent.systemPrompt = form.systemPrompt;
  if (form.model.trim()) agent.model = form.model.trim();
  if (form.fastModel.trim()) agent.fastModel = form.fastModel.trim();
  if (tools.length > 0) agent.tools = tools;
  if (permission.length > 0) agent.permission = permission;
  return agent;
}

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
  /** 保存当前 agent 草稿 + 场景映射（供设置页统一保存调用）。 */
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
  const [agents, setAgents] = useState<MuseAgent[]>([]);
  const [scenarios, setScenarios] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<AgentForm | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 编辑 Dialog 的 portal 容器。挂载在设置弹窗（.configuration-dialog）内时，
  // 指向该弹窗 DOM，避免 ConfigDialog 的 document mousedown 把弹窗外的点击
  // 误判为「点设置弹窗外」而关闭整个设置弹窗；找不到（测试环境）回落 body。
  const rootRef = useRef<HTMLDivElement>(null);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(
    null,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    setDialogContainer(
      rootRef.current?.closest<HTMLElement>(".configuration-dialog") ?? null,
    );
  }, []);

  const reload = useCallback(async () => {
    try {
      const [agentsRes, scenariosRes] = await Promise.all([
        client.getAgents(),
        client.getAgentScenarios(),
      ]);
      setAgents(agentsRes.agents);
      setScenarios(scenariosRes.scenarios);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const startEdit = (agent: MuseAgent) => {
    setDraft(toForm(agent));
    setIsNew(false);
    setError(null);
  };

  const startNew = () => {
    setDraft({
      key: "",
      name: "",
      personality: "professional",
      systemPrompt: "",
      model: "",
      fastModel: "",
      tools: "",
      permission: "",
    });
    setIsNew(true);
    setError(null);
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft) return true;
    if (!draft.key.trim() || !draft.name.trim()) {
      setError("key 与 name 不能为空");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      // 整份写盘：保留未编辑的 agent（含内置），仅覆盖当前编辑项
      const nextAgents: Record<string, Partial<MuseAgent>> = {};
      for (const a of agents) {
        nextAgents[a.key] = fromForm(toForm(a));
      }
      if (isNew && !nextAgents[draft.key]) {
        // 新增：key 未占用才允许
        if (agents.some((a) => a.key === draft.key)) {
          setError(`agent key "${draft.key}" 已存在`);
          return false;
        }
      }
      nextAgents[draft.key] = fromForm(draft);
      const res = await client.putAgents({ version: 1, agents: nextAgents });
      setAgents(res.agents);
      // 刷新全局 agentsStore，让消息输入框 AgentSelector 立即感知变更
      void useAgentsStore.getState().refresh();
      setDraft(null);
      setIsNew(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, agents, isNew, client]);

  const remove = useCallback(
    async (key: string) => {
      if (BUILTIN_AGENT_KEYS.has(key)) return;
      if (!window.confirm(`删除 agent「${key}」？`)) return;
      setSaving(true);
      setError(null);
      try {
        const nextAgents: Record<string, Partial<MuseAgent>> = {};
        for (const a of agents) {
          if (a.key === key) continue;
          nextAgents[a.key] = fromForm(toForm(a));
        }
        const res = await client.putAgents({ version: 1, agents: nextAgents });
        setAgents(res.agents);
        // 刷新全局 agentsStore，让 AgentSelector 立即移除已删除项
        void useAgentsStore.getState().refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [agents, client],
  );

  const saveScenarios = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await client.putAgentScenarios({
        version: 1,
        scenarios: {
          session: scenarios.session,
          popo: scenarios.popo,
          "issue-plan": scenarios["issue-plan"],
          "issue-exec": scenarios["issue-exec"],
        },
      });
      setScenarios(res.scenarios);
      // 场景映射变更会影响 AgentSelector 的 defaultAgentName，一并刷新全局缓存
      void useAgentsStore.getState().refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
    return true;
  }, [client, scenarios]);

  useImperativeHandle(
    ref,
    () => ({
      // 设置页统一保存：先落 agent（含草稿），再落场景映射。
      save: async () => {
        if (draft) {
          const ok = await save();
          if (!ok) return false;
        }
        return await saveScenarios();
      },
    }),
    [draft, save, saveScenarios],
  );

  if (loadError) {
    return <div className="agent-manager-error">{loadError}</div>;
  }

  return (
    <div
      className="agent-manager"
      data-testid="agent-manager"
      ref={rootRef}
    >
      {/* 数字人 agent 管理 */}
      <div className="agent-manager-section">
        <div className="agent-manager-header">
          <h4>数字人 Agent</h4>
          <Button
            type="button"
            variant="soft"
            color="gray"
            data-testid="agent-add-btn"
            onClick={startNew}
            disabled={saving}
          >
            + 新增 Agent
          </Button>
        </div>
        {agents.length === 0 ? (
          <div className="agent-manager-empty">加载中…</div>
        ) : (
          <ul className="agent-manager-list" data-testid="agent-manager-list">
            {agents.map((a) => (
              <li key={a.key} className="agent-manager-row">
                <div className="agent-manager-row-main">
                  <span className="agent-manager-row-name">{a.name}</span>
                  <span className="agent-manager-row-key">{a.key}</span>
                  <span className="agent-manager-row-personality">
                    {a.personalityLabel ?? PERSONALITIES.find((p) => p.key === a.personality)?.label ?? a.personality}
                  </span>
                </div>
                <div className="agent-manager-row-actions">
                  <Button
                    type="button"
                    size="1"
                    variant="soft"
                    color="gray"
                    data-testid={`agent-edit-${a.key}`}
                    onClick={() => startEdit(a)}
                    disabled={saving}
                  >
                    编辑
                  </Button>
                  {!BUILTIN_AGENT_KEYS.has(a.key) && (
                    <Button
                      type="button"
                      size="1"
                      variant="soft"
                      color="gray"
                      data-testid={`agent-delete-${a.key}`}
                      onClick={() => void remove(a.key)}
                      disabled={saving}
                    >
                      删除
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 编辑/新增表单：独立加宽 Dialog，字段分组成段 */}
      <Dialog.Root
        open={!!draft}
        onOpenChange={(open) => {
          // Esc / 遮罩点击 → 关闭（Radix Dialog 内建 dismissable）
          if (!open) {
            setDraft(null);
            setIsNew(false);
            setError(null);
          }
        }}
      >
        <Dialog.Content
          className="agent-manager-dialog"
          data-testid="agent-form"
          aria-describedby={undefined}
          container={dialogContainer ?? undefined}
        >
          <Dialog.Title className="agent-manager-dialog-title">
            {isNew ? "新增 Agent" : `编辑 Agent：${draft?.name ?? ""}`}
          </Dialog.Title>

          {draft && (
            <div className="agent-manager-form">
              {/* 基础信息 */}
              <div className="agent-manager-form-group">
                <Text size="2" weight="medium" color="gray">
                  基础信息
                </Text>
                <div className="agent-manager-form-grid">
                  <Field label="key" htmlFor="agent-form-key">
                    <TextField.Root
                      id="agent-form-key"
                      data-testid="agent-form-key"
                      value={draft.key}
                      disabled={!isNew || saving}
                      onChange={(e) =>
                        setDraft({ ...draft, key: e.target.value })
                      }
                      spellCheck={false}
                      placeholder="如：dev-assistant / customer-service"
                    />
                  </Field>
                  <Field label="name" htmlFor="agent-form-name">
                    <TextField.Root
                      id="agent-form-name"
                      data-testid="agent-form-name"
                      value={draft.name}
                      disabled={saving}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                      placeholder="如：开发者助手 / 客服小美"
                    />
                  </Field>
                  <Field
                    label="personality"
                    htmlFor="agent-form-personality"
                  >
                    <Select.Root
                      value={draft.personality}
                      onValueChange={(v) =>
                        setDraft({ ...draft, personality: v })
                      }
                      disabled={saving}
                    >
                      <Select.Trigger
                        id="agent-form-personality"
                        data-testid="agent-form-personality"
                        aria-label="personality"
                      />
                      <Select.Content>
                        {PERSONALITIES.map((p) => (
                          <Select.Item key={p.key} value={p.key}>
                            {p.label}（{p.description}）
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </Field>
                </div>
              </div>

              {/* 模型 */}
              <div className="agent-manager-form-group">
                <Text size="2" weight="medium" color="gray">
                  模型
                </Text>
                <div className="agent-manager-form-grid">
                  <Field label="model" htmlFor="agent-form-model">
                    <MuseModelSelect
                      api={client}
                      modelId={draft.model || undefined}
                      onModelChange={(m) => setDraft({ ...draft, model: m })}
                      testId="agent-form-model"
                    />
                  </Field>
                  <Field
                    label="fastModel"
                    htmlFor="agent-form-fastModel"
                    hint="留空=主模型"
                  >
                    <MuseModelSelect
                      api={client}
                      modelId={draft.fastModel || undefined}
                      onModelChange={(m) =>
                        setDraft({ ...draft, fastModel: m })
                      }
                      allowEmpty
                      emptyLabel="（留空）"
                      testId="agent-form-fastModel"
                    />
                  </Field>
                </div>
              </div>

              {/* 工具与权限 */}
              <div className="agent-manager-form-group">
                <Text size="2" weight="medium" color="gray">
                  工具与权限
                </Text>
                <Field
                  label="tools"
                  hint="允许工具列表，逗号分隔；留空=全部"
                  htmlFor="agent-form-tools"
                >
                  <TextField.Root
                    id="agent-form-tools"
                    data-testid="agent-form-tools"
                    value={draft.tools}
                    disabled={saving}
                    onChange={(e) =>
                      setDraft({ ...draft, tools: e.target.value })
                    }
                    spellCheck={false}
                    placeholder="如：Read, Write, Edit, Bash, Glob, Grep（逗号分隔，留空=全部）"
                  />
                </Field>
                <Field
                  label="permission"
                  hint="每行一条权限规则；无 ! 前缀=拒绝该工具，! 开头=豁免（如 Bash / !Read）"
                  htmlFor="agent-form-permission"
                >
                  <TextArea
                    id="agent-form-permission"
                    data-testid="agent-form-permission"
                    value={draft.permission}
                    disabled={saving}
                    onChange={(e) =>
                      setDraft({ ...draft, permission: e.target.value })
                    }
                    spellCheck={false}
                    rows={4}
                    placeholder={`如：
Bash(rm -rf *)  ← 拒绝
Edit(**/.env)   ← 拒绝
!Read           ← 豁免（! 开头）`}
                  />
                </Field>
              </div>

              {/* 系统提示 */}
              <div className="agent-manager-form-group">
                <Text size="2" weight="medium" color="gray">
                  系统提示
                </Text>
                <Field
                  label="systemPrompt"
                  hint="留空=内置默认（人格段 + 场景动态上下文）；填写后附加在人格段之后"
                  htmlFor="agent-form-systemPrompt"
                >
                  <TextArea
                    id="agent-form-systemPrompt"
                    data-testid="agent-form-systemPrompt"
                    value={draft.systemPrompt}
                    disabled={saving}
                    onChange={(e) =>
                      setDraft({ ...draft, systemPrompt: e.target.value })
                    }
                    spellCheck={false}
                    rows={4}
                    placeholder="如：你是资深工程师，回答代码问题时先分析再给方案"
                  />
                </Field>
              </div>

              {error && <div className="agent-manager-error">{error}</div>}
              <div className="agent-manager-form-actions">
                <Button
                  type="button"
                  variant="soft"
                  color="gray"
                  data-testid="agent-form-cancel"
                  onClick={() => {
                    setDraft(null);
                    setIsNew(false);
                    setError(null);
                  }}
                  disabled={saving}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  data-testid="agent-form-save"
                  onClick={() => void save()}
                  disabled={saving}
                >
                  {saving ? "保存中..." : "保存"}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Root>

      {/* 场景映射 */}
      <div className="agent-manager-section">
        <div className="agent-manager-header">
          <h4>场景映射</h4>
          <Button
            type="button"
            variant="soft"
            color="gray"
            data-testid="scenarios-save-btn"
            onClick={() => void saveScenarios()}
            disabled={saving || agents.length === 0}
          >
            {saving ? "保存中..." : "保存场景"}
          </Button>
        </div>
        <div className="agent-manager-scenarios">
          {SCENARIO_LABELS.map((s) => (
            <div key={s.key} className="agent-manager-scenario-row">
              <span className="agent-manager-scenario-label">{s.label}</span>
              <Select.Root
                value={scenarios[s.key] ?? "default"}
                onValueChange={(v) =>
                  setScenarios((prev) => ({ ...prev, [s.key]: v }))
                }
                disabled={saving || agents.length === 0}
              >
                <Select.Trigger
                  data-testid={`scenario-${s.key}`}
                  aria-label={s.label}
                />
                <Select.Content>
                  {agents.map((a) => (
                    <Select.Item key={a.key} value={a.key}>
                      {a.name}（{a.key}）
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default AgentManager;
