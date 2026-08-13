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
  permissionMode?: string;
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
      worktreeName?: string;
      worktreeBranch?: string;
      baseBranch?: string;
      worktreeRepoRoot?: string;
    },
  ): Promise<MuseSession> {
    const body: {
      workdir?: string;
      model?: string;
      worktreeName?: string;
      worktreeBranch?: string;
      baseBranch?: string;
      worktreeRepoRoot?: string;
    } = {};
    if (workdir) body.workdir = workdir;
    if (opts?.model) body.model = opts.model;
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
    patch: Partial<Pick<MuseSession, "title" | "pinned" | "model">>,
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
}
