export type MuseFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

import type { Message } from "wave-agent-sdk/dist/types/index.js";

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

export interface MuseSettings {
  version: 1;
  plugins: { superpowers: boolean };
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
  waveSessionId?: string;
  worktreeName?: string;
  worktreeBranch?: string;
  baseBranch?: string;
  worktreeRepoRoot?: string;
  /** Runtime-only unread-done flag; may be absent from list payloads. */
  unreadDone?: boolean;
  /** True when the previous process died mid-turn. */
  interrupted?: boolean;
}

export interface MuseSessionsGrouped {
  pinned: MuseSession[];
  recent: MuseSession[];
  activeSessionId?: string;
}

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

export interface PopoChatSummary {
  chatKey: string;
  type: "p2p" | "team";
  title: string;
  lastMessage: string;
  /** agent 正在处理该会话的消息时为 true */
  processing: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PopoChatMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
  from?: string;
  to?: string;
  msgId?: string;
}

export interface PopoChatDetail {
  chatKey: string;
  type: "p2p" | "team";
  title: string;
  waveSessionId?: string;
  processing: boolean;
  messages: PopoChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** 详情接口：chat 元信息 + 完整处理过程消息（SDK Message 形状，含 reasoning/tool/text 块）。 */
export interface PopoChatDetailResponse {
  chat: PopoChatDetail;
  messages: Message[];
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

  async getSettings(): Promise<MuseSettings> {
    const res = await this.request("/settings");
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

  async updateSettings(patch: {
    plugins: { superpowers: boolean };
  }): Promise<MuseSettings> {
    const res = await this.request("/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
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
    patch: Partial<Pick<MuseSession, "title" | "pinned" | "model" | "permissionMode">>,
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

  async getMessages(id: string): Promise<{ messages: unknown[] }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(id)}/messages`,
    );
    return parseJson(res);
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

  async getSessionStatus(sessionId: string): Promise<{
    sessionId: string;
    workdir: string;
    permissionMode: string;
    latestTotalTokens: number;
    waveSessionId?: string;
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

  async listPopoChats(): Promise<{ chats: PopoChatSummary[] }> {
    const res = await this.request("/popo/chats");
    return parseJson(res);
  }

  async getPopoChat(chatKey: string): Promise<PopoChatDetailResponse> {
    const res = await this.request(`/popo/chats/${encodeURIComponent(chatKey)}`);
    return parseJson(res);
  }
}
