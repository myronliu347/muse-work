import fs from "node:fs";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";

const TOKEN_API = "https://open.popo.netease.com/open-apis/robots/v1/token";
const REFRESH_API = "https://open.popo.netease.com/open-apis/robots/v1/token/refresh";

export interface TokenPair {
  accessToken: string;
  accessExpiredAt: number;
  refreshToken: string;
  refreshExpiredAt: number;
}

export interface TokenStore {
  getAccessToken(): Promise<string>;
  forceRefresh(): Promise<string>;
}

export type TokenStoreOptions = {
  home: string;
  appKey: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type TokenResponse = {
  errcode?: number;
  status?: number;
  errmsg?: string;
  data?: Partial<TokenPair>;
};

export function createTokenStore(options: TokenStoreOptions): TokenStore {
  const { appKey, appSecret } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const file = path.join(getMuseHomeDir(options.home), "popo-token.json");

  let pair: TokenPair | null = readPair();
  let inflight: Promise<TokenPair> | null = null;

  function readPair(): TokenPair | null {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as TokenPair;
    } catch {
      return null;
    }
  }

  function persist(next: TokenPair): void {
    pair = next;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 文件含 accessToken + 30 天 refreshToken 两个 bearer 凭据，必须 0600。
    // writeFileSync 的 mode 只对新建文件生效，对已存在文件需 chmodSync 收敛。
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }

  async function post(
    url: string,
    body: Record<string, string>,
  ): Promise<TokenResponse> {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POPO token api ${res.status}`);
    return (await res.json()) as TokenResponse;
  }

  async function renew(): Promise<TokenPair> {
    const body = await post(TOKEN_API, { appKey, appSecret });
    if (body.errcode !== 0 || !body.data?.accessToken) {
      throw new Error(`POPO token 换取失败: ${body.errcode} ${body.errmsg ?? ""}`);
    }
    const next: TokenPair = {
      accessToken: body.data.accessToken,
      accessExpiredAt: body.data.accessExpiredAt ?? 0,
      refreshToken: body.data.refreshToken ?? "",
      refreshExpiredAt: body.data.refreshExpiredAt ?? 0,
    };
    persist(next);
    return next;
  }

  async function refresh(): Promise<TokenPair> {
    if (!pair?.refreshToken) return renew();
    const body = await post(REFRESH_API, {
      appKey,
      refreshToken: pair.refreshToken,
    });
    if (body.errcode === 0 && body.data?.accessToken) {
      const next: TokenPair = {
        ...pair,
        accessToken: body.data.accessToken,
        accessExpiredAt: body.data.accessExpiredAt ?? pair.accessExpiredAt,
      };
      persist(next);
      return next;
    }
    if (body.errcode === 42002 || body.status === 42002) return renew();
    throw new Error(`POPO token 刷新失败: ${body.errcode} ${body.errmsg ?? ""}`);
  }

  async function getFreshPair(): Promise<TokenPair> {
    if (pair && now() < pair.accessExpiredAt - 60_000) return pair;
    if (!inflight) {
      inflight = refresh().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  return {
    async getAccessToken() {
      return (await getFreshPair()).accessToken;
    },
    async forceRefresh() {
      pair = null;
      return (await getFreshPair()).accessToken;
    },
  };
}
