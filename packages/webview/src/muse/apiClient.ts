export type MuseFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface MuseApiClientOptions {
  baseUrl: string;
  fetch?: MuseFetch;
}

export interface MuseModelInfo {
  id: string;
  label: string;
  capabilities?: { vision?: boolean; thinking?: boolean };
  group?: string;
}

export interface MuseProviderInfo {
  id: string;
  displayName: string;
  models: MuseModelInfo[];
}

export interface MuseProvidersResponse {
  providers: MuseProviderInfo[];
  active: { providerId: string; modelId?: string };
}

/** 各场景默认 model id（GET /scenarios/models）。 */
export interface MuseScenarioModels {
  models: Record<
    "session" | "issue-plan" | "issue-exec" | "assistant",
    string
  >;
}

/** 网页搜索密钥状态。接口不返回密钥本身。 */
export interface MuseTavilyConfig {
  configured: boolean;
  source: "stored" | "env" | "none";
}

export interface MuseCodeMakerQuota {
  raw: unknown;
  user?: string;
  total?: number;
  used?: number;
  remaining?: number;
  /** Usage percent (e.g. 0.07 means 0.07%). */
  percentage?: number;
}

export interface MuseOpenAiCompatibleConfig {
  baseURL: string;
  apiKeyEnv: string;
  hasApiKey: boolean;
  hasStoredApiKey: boolean;
  models: MuseModelInfo[];
}

export interface MuseOpenAiCompatibleConfigPatch {
  baseURL?: string;
  apiKey?: string;
  models?: MuseModelInfo[];
}

export interface MuseAuthStatus {
  state: "authenticated" | "unauthenticated" | "needs_config" | "expired";
  user?: string;
  providerId: string;
}

export type MuseLoginStart =
  | { authUrl: string }
  | { reused: true }
  | MuseAuthStatus;

export interface MuseSession {
  id: string;
  workdir: string;
  createdAt: number;
  lastActiveAt: number;
  status: string;
  title: string;
  model: string;
  pinned: boolean;
  permissionMode?: "acceptEdits" | "bypassPermissions";
  museSessionId?: string;
  worktreeName?: string;
  worktreeBranch?: string;
  baseBranch?: string;
  worktreeRepoRoot?: string;
  /** 内置角色 key（default/plan/execute/popo），会话创建时写入；不可再通过 API 切换。 */
  agentName?: string;
  /** 自定义 system prompt（会话级覆盖）。 */
  systemPrompt?: string;
  /** Runtime-only unread-done flag; may be absent from list payloads. */
  unreadDone?: boolean;
  /** True when the previous process died mid-turn. */
  interrupted?: boolean;
}

export type MuseIssuePriority = "p0" | "p1" | "p2";
export type MuseIssueStatus =
  | "pending"
  | "planning"
  | "executing"
  | "review"
  | "awaiting_close"
  | "completed"
  | "cancelled";
export type MuseChecklistItemStatus = "pending" | "running" | "done";
export type MuseIssueType =
  | "bug"
  | "feature"
  | "research"
  | "analysis"
  | "review"
  | "work";

export interface MuseChecklistItem {
  id: string;
  content: string;
  status: MuseChecklistItemStatus;
}

/** Issue 实体，字段与 server `Issue` 对齐。 */
export interface MuseIssue {
  id: string;
  title: string;
  description: string;
  priority: MuseIssuePriority;
  type: MuseIssueType;
  status: MuseIssueStatus;
  agentMode?: "single" | "split";
  workdir?: string;
  worktreeEnabled?: boolean;
  baseBranch?: string;
  planningSessionId?: string;
  executionSessionId?: string;
  items: MuseChecklistItem[];
  closeNote?: string;
  createdAt: number;
  updatedAt: number;
}

/** Issue 侧栏分组：规划/执行会话（sessions 为 MuseSession，emit 时再 toEntry）。 */
export interface MuseIssueGroup {
  issueId: string;
  title: string;
  description?: string;
  priority: string;
  type?: string;
  status: string;
  items: MuseChecklistItem[];
  planningSessionId?: string;
  executionSessionId?: string;
  agentMode?: "single" | "split";
  closeNote?: string;
  workdir?: string;
  baseBranch?: string;
  sessions: MuseSession[];
}

export interface MuseSessionsGrouped {
  pinned: MuseSession[];
  recent: MuseSession[];
  activeSessionId?: string;
  /** Issue 分组：规划会话 + 执行会话（侧栏按 Issue 折叠展示）。 */
  issueGroups?: MuseIssueGroup[];
  /** 已完成 / 已取消，不与进行中 Issue 混在 issueGroups。 */
  closedIssueGroups?: MuseIssueGroup[];
}

export type MuseAutomationPermission = "workspace";
export type MuseAutomationRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "stopped"
  | "skipped";
export type MuseIssueEvent = "created" | "review" | "completed" | "cancelled";

export type MuseAutomationTrigger =
  | { type: "cron"; expr: string }
  | { type: "once"; at: number; firedAt?: number }
  | {
      type: "issue";
      events: MuseIssueEvent[];
      tags?: string[];
      priority?: "p0" | "p1" | "p2";
    };

export interface MuseAutomation {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** 缺省按 agent。remind 不跑 Agent，只把 assistantHint 交给助手。 */
  mode?: "agent" | "remind";
  prompt: string;
  /** 助手收到这次结果后要做的事。 */
  assistantHint?: string;
  workdir: string;
  agentName?: string;
  model?: string;
  permission: MuseAutomationPermission;
  triggers: MuseAutomationTrigger[];
  createdAt: number;
  updatedAt: number;
}

export interface MuseAutomationRun {
  id: string;
  automationId: string;
  sessionId?: string;
  status: MuseAutomationRunStatus;
  trigger: {
    type: "cron" | "once" | "issue" | "manual";
    firedAt: number;
    expr?: string;
    issue?: {
      id: string;
      title: string;
      status: string;
      priority: string;
      type?: string;
      tags?: string[];
    };
  };
  skipReason?: "rule_running" | "global_concurrency";
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export type MuseScheduleUi =
  | {
      mode: "cycle";
      cycle: "daily" | "weekday" | "0" | "1" | "2" | "3" | "4" | "5" | "6";
      time: string;
    }
  | { mode: "interval"; every: number; unit: "h" | "m" }
  | { mode: "once"; at: number };

export type MuseAutomationPatch = {
  name?: string;
  description?: string;
  enabled?: boolean;
  mode?: "agent" | "remind";
  prompt?: string;
  assistantHint?: string;
  workdir?: string;
  agentName?: string;
  model?: string;
  permission?: MuseAutomationPermission;
  triggers?: MuseAutomationTrigger[];
  schedule?: MuseScheduleUi;
};

export interface PopoConfigInfo {
  url: string;
  token: string;
  aesKey: string;
  masterUid: string;
  port: number;
  ready: boolean;
  /** 本地存在 popo 配置（~/.popo-config.json）；false 时隐藏机器人入口 */
  configured: boolean;
  error: string | null;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // ignore
    }
    throw new Error(`Muse API ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

export class MuseApiClient {
  readonly baseUrl: string;
  private readonly fetchImpl: MuseFetch;

  constructor(opts: MuseApiClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  private request(path: string, init?: RequestInit): Promise<Response> {
    return this.fetchImpl(joinUrl(this.baseUrl, path), init);
  }

  async getHealth(): Promise<{ ok: boolean }> {
    const res = await this.request("/health");
    return parseJson(res);
  }

  async getTavilyConfig(): Promise<MuseTavilyConfig> {
    const res = await this.request("/settings/tavily");
    return parseJson(res);
  }

  async updateTavilyConfig(body: { apiKey: string }): Promise<MuseTavilyConfig> {
    const res = await this.request("/settings/tavily", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseJson(res);
  }

  async getSettingsRaw(): Promise<{ path: string; content: string }> {
    const res = await this.request("/settings/raw");
    return parseJson(res);
  }

  async putSettingsRaw(
    content: string,
  ): Promise<{ path: string; content: string }> {
    const res = await this.request("/settings/raw", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    return parseJson(res);
  }

  async listProviders(): Promise<MuseProvidersResponse> {
    const res = await this.request("/providers");
    return parseJson(res);
  }

  async setActive(
    providerId: string,
    modelId: string,
  ): Promise<{ ok: true; active: { providerId: string; modelId?: string } }> {
    const res = await this.request("/providers/active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId, modelId }),
    });
    return parseJson(res);
  }

  async getCodeMakerQuota(): Promise<MuseCodeMakerQuota> {
    const res = await this.request("/providers/codemaker/quota");
    return parseJson(res);
  }

  async getOpenAiCompatibleConfig(): Promise<MuseOpenAiCompatibleConfig> {
    const res = await this.request("/providers/openai-compatible");
    return parseJson(res);
  }

  async updateOpenAiCompatibleConfig(
    patch: MuseOpenAiCompatibleConfigPatch,
  ): Promise<{ ok: true; active: { providerId: string; modelId?: string } }> {
    const res = await this.request("/providers/openai-compatible", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    return parseJson(res);
  }

  async getAuthStatus(): Promise<MuseAuthStatus> {
    const res = await this.request("/auth/status");
    return parseJson(res);
  }

  async login(opts?: { wait?: boolean }): Promise<MuseLoginStart> {
    const res = await this.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts?.wait ? { wait: true } : {}),
    });
    return parseJson(res);
  }

  async logout(): Promise<{ ok: true }> {
    const res = await this.request("/auth/logout", { method: "POST" });
    return parseJson(res);
  }

  async createSession(
    workdir?: string,
    opts?: {
      model?: string;
      permissionMode?: "acceptEdits" | "bypassPermissions";
      worktreeName?: string;
      worktreeBranch?: string;
      baseBranch?: string;
      worktreeRepoRoot?: string;
    },
  ): Promise<MuseSession> {
    const body: {
      workdir?: string;
      model?: string;
      permissionMode?: "acceptEdits" | "bypassPermissions";
      worktreeName?: string;
      worktreeBranch?: string;
      baseBranch?: string;
      worktreeRepoRoot?: string;
    } = {};
    if (workdir) body.workdir = workdir;
    if (opts?.model) body.model = opts.model;
    if (opts?.permissionMode) body.permissionMode = opts.permissionMode;
    if (opts?.worktreeName) body.worktreeName = opts.worktreeName;
    if (opts?.worktreeBranch) body.worktreeBranch = opts.worktreeBranch;
    if (opts?.baseBranch) body.baseBranch = opts.baseBranch;
    if (opts?.worktreeRepoRoot) body.worktreeRepoRoot = opts.worktreeRepoRoot;
    const res = await this.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseJson(res);
  }

  async listSessionsGrouped(): Promise<MuseSessionsGrouped> {
    const res = await this.request("/sessions?grouped=1");
    return parseJson(res);
  }

  async selectSession(id: string): Promise<{ session: MuseSession }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(id)}/select`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async patchSession(
    id: string,
    patch: Partial<
      Pick<
        MuseSession,
        "title" | "pinned" | "model" | "permissionMode"
      >
    >,
  ): Promise<MuseSession> {
    const res = await this.request(`/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    return parseJson(res);
  }

  async deleteSession(id: string): Promise<{ ok: true }> {
    const res = await this.request(`/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return parseJson(res);
  }

  async getMessages(
    id: string,
    query?: { before?: string; limit?: number },
  ): Promise<{ messages: unknown[]; hasMore: boolean }> {
    const params = new URLSearchParams();
    if (query?.before) params.set("before", query.before);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    const res = await this.request(
      `/sessions/${encodeURIComponent(id)}/messages${qs ? `?${qs}` : ""}`,
    );
    const body = (await parseJson(res)) as {
      messages?: unknown[];
      hasMore?: boolean;
    };
    return {
      messages: Array.isArray(body.messages) ? body.messages : [],
      hasMore: Boolean(body.hasMore),
    };
  }

  async getRuntimeState(
    sessionId: string,
  ): Promise<{ loading: boolean; queuedMessages: unknown[] }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/runtime`,
    );
    return parseJson(res);
  }

  async sendMessage(
    sessionId: string,
    content: string,
    images?: Array<{ data: string; mediaType: string }>,
  ): Promise<{ accepted: true }> {
    const body: {
      content: string;
      images?: Array<{ data: string; mediaType: string }>;
    } = { content };
    if (images && images.length > 0) {
      body.images = images;
    }
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return parseJson(res);
  }

  async abortMessage(sessionId: string): Promise<{ ok: true }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/abort`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async deleteQueuedMessageById(
    sessionId: string,
    messageId: string,
  ): Promise<{ ok: boolean }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/queued-messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE" },
    );
    return parseJson(res);
  }

  async updateQueuedMessage(
    sessionId: string,
    messageId: string,
    patch: {
      text: string;
      images?: Array<{ data: string; mediaType: string }>;
    },
  ): Promise<{ ok: boolean }> {
    const body: {
      text: string;
      images?: Array<{ data: string; mediaType: string }>;
    } = { text: patch.text };
    if (patch.images && patch.images.length > 0) {
      body.images = patch.images;
    }
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/queued-messages/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return parseJson(res);
  }

  async respondPermission(
    sessionId: string,
    permissionId: string,
    decision:
      | "allow"
      | "deny"
      | {
          behavior: "allow" | "deny";
          message?: string;
          newPermissionMode?: string;
          newPermissionRule?: string;
        },
  ): Promise<{ ok: true }> {
    const body =
      typeof decision === "string"
        ? { decision, behavior: decision }
        : {
            decision: decision.behavior,
            behavior: decision.behavior,
            message: decision.message,
            newPermissionMode: decision.newPermissionMode,
            newPermissionRule: decision.newPermissionRule,
          };
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return parseJson(res);
  }

  async compact(sessionId: string): Promise<{ ok: true }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/compact`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async clear(sessionId: string): Promise<{ ok: true }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/clear`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async listRewindCheckpoints(
    sessionId: string,
  ): Promise<{ checkpoints: Array<{ id: string; content: string }> }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/rewind-checkpoints`,
    );
    return parseJson(res);
  }

  async rewind(
    sessionId: string,
    messageId: string,
  ): Promise<{ ok: true; inputContent: string }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/rewind`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId }),
      },
    );
    return parseJson(res);
  }

  async revertFileHistory(
    sessionId: string,
    messageIds: string[],
  ): Promise<{ ok: true; revertedCount: number }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/revert-file-history`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageIds }),
      },
    );
    return parseJson(res);
  }

  async getSlashCommands(
    sessionId: string,
  ): Promise<{ commands: Array<{ id: string; name: string; description: string }> }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/slash-commands`,
    );
    return parseJson(res);
  }

  async getSkills(workdir: string): Promise<{
    skills: Array<{
      name: string;
      description: string;
      userInvocable?: boolean;
    }>;
  }> {
    const res = await this.request(
      `/skills?workdir=${encodeURIComponent(workdir)}`,
    );
    return parseJson(res);
  }

  async listInstalledSkills(): Promise<{
    skills: Array<{ name: string; description: string; path: string }>;
  }> {
    const res = await this.request("/skills/installed");
    return parseJson(res);
  }

  async getInstalledSkillDetail(skillPath: string): Promise<{
    name: string;
    description: string;
    path: string;
    body: string;
  }> {
    const params = new URLSearchParams({ path: skillPath });
    const res = await this.request(`/skills/installed/detail?${params.toString()}`);
    return parseJson(res);
  }

  async uninstallInstalledSkill(skillPath: string): Promise<{ ok: true }> {
    const res = await this.request("/skills/installed", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: skillPath }),
    });
    return parseJson(res);
  }

  async getSkillMarket(query: {
    page?: number;
    q?: string;
  }): Promise<{
    skills: Array<{
      source: string;
      skillId: string;
      name: string;
      installs: number;
      isOfficial?: boolean;
    }>;
    hasMore: boolean;
  }> {
    const params = new URLSearchParams();
    if (query.q !== undefined) params.set("q", query.q);
    else params.set("page", String(query.page ?? 0));
    const res = await this.request(`/skill-market?${params.toString()}`);
    return parseJson(res);
  }

  async getMarketSkillDetail(query: {
    source: string;
    skillId: string;
  }): Promise<{
    name: string;
    description: string;
    body: string;
    installs: number;
  }> {
    const params = new URLSearchParams({
      source: query.source,
      skillId: query.skillId,
    });
    const res = await this.request(`/skill-market/detail?${params.toString()}`);
    return parseJson(res);
  }

  async installMarketSkill(body: {
    source: string;
    skillId: string;
  }): Promise<{ name: string; path: string }> {
    const res = await this.request("/skill-market/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseJson(res);
  }

  async getSessionStatus(sessionId: string): Promise<{
    sessionId: string;
    workdir: string;
    permissionMode: string;
    latestTotalTokens: number;
    museSessionId?: string;
  }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/status`,
    );
    return parseJson(res);
  }

  async getMcpServers(
    sessionId: string,
  ): Promise<{ servers: unknown[] }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/mcp`,
    );
    return parseJson(res);
  }

  async connectMcpServer(
    sessionId: string,
    name: string,
  ): Promise<{ ok: boolean }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/mcp/${encodeURIComponent(name)}/connect`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async disconnectMcpServer(
    sessionId: string,
    name: string,
  ): Promise<{ ok: boolean }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/mcp/${encodeURIComponent(name)}/disconnect`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async getBackgroundTaskOutput(
    sessionId: string,
    taskId: string,
  ): Promise<{ output: unknown }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/background-tasks/${encodeURIComponent(taskId)}/output`,
    );
    return parseJson(res);
  }

  async getBackgroundTasks(
    sessionId: string,
  ): Promise<{ tasks: unknown[] }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/background-tasks`,
    );
    return parseJson(res);
  }

  async getTasks(sessionId: string): Promise<{ tasks: unknown[] }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/tasks`,
    );
    return parseJson(res);
  }

  async stopBackgroundTask(
    sessionId: string,
    taskId: string,
  ): Promise<{ ok: boolean }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/background-tasks/${encodeURIComponent(taskId)}/stop`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async getWorkflowRuns(
    sessionId: string,
  ): Promise<{ runs: unknown[] }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/workflows`,
    );
    return parseJson(res);
  }

  async stopWorkflowRun(
    sessionId: string,
    runId: string,
  ): Promise<{ ok: true }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(runId)}/stop`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async getPopoConfig(): Promise<PopoConfigInfo> {
    const res = await this.request("/popo/config");
    return parseJson(res);
  }

  async listIssues(): Promise<{ issues: MuseIssue[] }> {
    const res = await this.request("/issues");
    return parseJson(res);
  }

  async createIssue(input: {
    title: string;
    description?: string;
    priority?: MuseIssuePriority;
    type?: MuseIssueType;
  }): Promise<{ issue: MuseIssue }> {
    const res = await this.request("/issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return parseJson(res);
  }

  async updateIssue(
    id: string,
    patch: {
      title?: string;
      description?: string;
      priority?: MuseIssuePriority;
      type?: MuseIssueType;
    },
  ): Promise<{ issue: MuseIssue }> {
    const res = await this.request(`/issues/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    return parseJson(res);
  }

  async completeIssue(
    id: string,
    note: string,
  ): Promise<{ issue: MuseIssue }> {
    const res = await this.request(
      `/issues/${encodeURIComponent(id)}/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      },
    );
    return parseJson(res);
  }

  async cancelIssue(id: string, note: string): Promise<{ issue: MuseIssue }> {
    const res = await this.request(
      `/issues/${encodeURIComponent(id)}/cancel`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      },
    );
    return parseJson(res);
  }

  async listAutomations(): Promise<{ automations: MuseAutomation[] }> {
    const res = await this.request("/automations");
    return parseJson(res);
  }

  async getAutomation(id: string): Promise<{ automation: MuseAutomation }> {
    const res = await this.request(`/automations/${encodeURIComponent(id)}`);
    return parseJson(res);
  }

  async createAutomation(
    body: MuseAutomationPatch = {},
  ): Promise<{ automation: MuseAutomation }> {
    const res = await this.request("/automations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseJson(res);
  }

  async patchAutomation(
    id: string,
    patch: MuseAutomationPatch,
  ): Promise<{ automation: MuseAutomation }> {
    const res = await this.request(`/automations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    return parseJson(res);
  }

  async enableAutomation(id: string): Promise<{ automation: MuseAutomation }> {
    const res = await this.request(
      `/automations/${encodeURIComponent(id)}/enable`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async disableAutomation(id: string): Promise<{ automation: MuseAutomation }> {
    const res = await this.request(
      `/automations/${encodeURIComponent(id)}/disable`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async deleteAutomation(id: string): Promise<{ ok: true }> {
    const res = await this.request(`/automations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return parseJson(res);
  }

  async runAutomation(id: string): Promise<{ run: MuseAutomationRun }> {
    const res = await this.request(
      `/automations/${encodeURIComponent(id)}/run`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async listAutomationRuns(
    id: string,
  ): Promise<{ runs: MuseAutomationRun[] }> {
    const res = await this.request(
      `/automations/${encodeURIComponent(id)}/runs`,
    );
    return parseJson(res);
  }

  async stopAutomationRun(
    runId: string,
  ): Promise<{ ok: true } | { run: MuseAutomationRun }> {
    const res = await this.request(
      `/automations/runs/${encodeURIComponent(runId)}/stop`,
      { method: "POST" },
    );
    return parseJson(res);
  }

  async getSession(id: string): Promise<MuseSession> {
    const res = await this.request(`/sessions/${encodeURIComponent(id)}`);
    return parseJson(res);
  }

  async openPlanningSession(
    id: string,
    body: {
      workdir: string;
      worktreeEnabled: boolean;
      baseBranch?: string;
      worktreeName?: string;
      worktreeBranch?: string;
      worktreeRepoRoot?: string;
      agentMode?: "single" | "split";
    },
  ): Promise<{ sessionId: string; workdir: string }> {
    const res = await this.request(
      `/issues/${encodeURIComponent(id)}/planning-session`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return parseJson(res);
  }

  async setIssueItems(
    id: string,
    items: Array<{
      id?: string;
      content: string;
      status?: MuseChecklistItemStatus;
    }>,
  ): Promise<{ issue: MuseIssue }> {
    const res = await this.request(
      `/issues/${encodeURIComponent(id)}/items`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      },
    );
    return parseJson(res);
  }

  async dispatchIssue(
    id: string,
    input: { itemId: string; prompt?: string },
  ): Promise<{ executionSessionId: string }> {
    const res = await this.request(
      `/issues/${encodeURIComponent(id)}/dispatch`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    return parseJson(res);
  }

  async getScenarioModels(): Promise<MuseScenarioModels> {
    const res = await this.request("/scenarios/models");
    return parseJson(res);
  }

  async putScenarioModels(payload: {
    version?: number;
    models: Partial<MuseScenarioModels["models"]>;
  }): Promise<MuseScenarioModels> {
    const res = await this.request("/scenarios/models", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return parseJson(res);
  }

  async getAssistantSession(): Promise<{
    sessionId: string;
    title: string;
    workdir: string;
    working: boolean;
  }> {
    const res = await this.request("/assistant/session");
    return parseJson(res);
  }

  async listAssistantQueue(): Promise<{
    items: Array<{
      type: "chat" | "issue" | "automation" | "permission";
      title: string;
      retry?: true;
      active?: true;
    }>;
  }> {
    const res = await this.request("/assistant/queue");
    return parseJson(res);
  }

  async listAssistantMessages(query?: {
    before?: string;
    limit?: number;
  }): Promise<{
    messages: Array<{
      id: string;
      at: number;
      role: "user" | "assistant";
      message: string;
    }>;
    hasMore: boolean;
  }> {
    const params = new URLSearchParams();
    if (query?.before) params.set("before", query.before);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    const res = await this.request(
      `/assistant/messages${qs ? `?${qs}` : ""}`,
    );
    return parseJson(res);
  }

  async sendAssistantMessage(
    message: string,
    images?: Array<{ data: string; mediaType: string }>,
  ): Promise<{
    id: string;
    at: number;
    role: "user" | "assistant";
    message: string;
    images?: Array<{ data: string; mediaType: string }>;
  }> {
    const res = await this.request("/assistant/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        ...(images && images.length > 0 ? { images } : {}),
      }),
    });
    return parseJson(res);
  }
}
