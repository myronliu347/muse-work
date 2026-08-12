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
  status: string;
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

  async createSession(workdir: string): Promise<MuseSession> {
    const res = await this.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir }),
    });
    return parseJson(res);
  }

  async sendMessage(
    sessionId: string,
    content: string,
  ): Promise<{ accepted: true }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      },
    );
    return parseJson(res);
  }

  async respondPermission(
    sessionId: string,
    permissionId: string,
    decision: "allow" | "deny",
  ): Promise<{ ok: true }> {
    const res = await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
    return parseJson(res);
  }
}
