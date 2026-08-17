# POPO 机器人接入 agent 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 muse server 内接收 POPO 机器人回调（私聊/群@），按白名单权限让 agent 生成回复并经 POPO send-msg API 发回；Muse webview 新增「POPO 机器人」页面查看配置与全部会话。

**Architecture:** 同进程双监听——主 server（127.0.0.1:动态端口）之外，同一进程再起一个仅含 `/popo/callback` 的 Hono 实例（0.0.0.0:3100，默认端口，`POPO_CALLBACK_PORT` 可覆盖）。POPO 子系统完全独立于 session 存储：每用户/群一个 chat（wave agent session 上下文，持久化在 `~/.muse-work/popo-chats.json`）。回调监听器独立 try/catch/error 处理，绑定失败只降级不影响主功能。

**Tech Stack:** Hono + @hono/node-server（回调监听）、wave-agent-sdk（agent）、Node 内置 crypto（AES-CBC/SHA1）、vitest（测试）、React + @testing-library（webview）。

**Spec:** [docs/superpowers/specs/2026-08-17-popo-robot-integration-design.md](../specs/2026-08-17-popo-robot-integration-design.md)

## Global Constraints

- 回调端口默认 3100，dev 可用 `POPO_CALLBACK_PORT` 覆盖（spec §8）
- token/aesKey 沿用开发者后台现有值（token=`openclawtk`，aesKey=`frx2T6DXr6kiP3108Q8JErniG3QJeR8k`），不重新生成；敏感值只允许出现在 `/popo/config` 响应（页面唯一出口）
- 权限白名单：仅 `liuyuyang03@corp.netease.com`（`masterUid`）；非 master 一律回「大胆，只有尊敬的大人可以指挥我做事」
- 两段式回复：先 ack「收到，马上处理，请稍等一会....」，agent 完成后回**最后一个文本块**，出错回错误信息
- 群回复不 @ 主人；群消息进 agent 前剥离开头 `@机器人名 ` 前缀
- 群消息进 agent 前注入上下文提示（含群号 sessionId，引导用本地 popo-cli/popo-im skill 读群历史）；仅群会话注入
- POPO 会话不进现有 sessions 存储；独立文件 `~/.muse-work/popo-chats.json`
- 隔离性硬约束：回调监听失败（端口占用/与主端口冲突）只记日志 + 机器人页面显示未就绪，主 server 照常运行
- ESM + `.js` 导入后缀；相对导入与现有 server 一致
- 已知既有问题（非本次回归）：server 3 个 pre-existing agent-recreate 测试失败（`canIdleDestroy` 恒 false，先 `git stash` 验证再判回归）；webview 3 个 pre-existing tsc 错误（SenderCat.tsx 缺 sender-cat.png、messageUtils.ts inline 可能 undefined）
- 测试命令：`pnpm -F @muse-work/server test`、`pnpm -F @muse-work/webview test`、`pnpm -F @muse-work/server type-check`

---

### Task 1: popoConfig — 配置模块与 masterUid 回填

**Files:**
- Create: `packages/server/src/popo/popoConfig.ts`
- Test: `packages/server/tests/popoConfig.test.ts`

**Interfaces:**
- Produces: `PopoConfig`（`appId/appKey/appSecret/token/aesKey/masterUid` 全 string）、`getPopoConfigPath(home?)`、`loadPopoConfig(home?): PopoConfig`（缺失必填抛错）、`savePopoConfig(config, home?)`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/popoConfig.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getPopoConfigPath,
  loadPopoConfig,
  savePopoConfig,
} from "../src/popo/popoConfig.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "popo-config-"));
}

describe("popoConfig", () => {
  it("loads config values and backfills missing optional fields", () => {
    const home = tempHome();
    savePopoConfig(
      {
        appId: "id",
        appKey: "key",
        appSecret: "secret",
        token: "tk",
        aesKey: "ak",
        masterUid: "me@corp.netease.com",
      },
      home,
    );
    const cfg = loadPopoConfig(home);
    expect(cfg).toEqual({
      appId: "id",
      appKey: "key",
      appSecret: "secret",
      token: "tk",
      aesKey: "ak",
      masterUid: "me@corp.netease.com",
    });
  });

  it("defaults missing token/aesKey/masterUid to empty strings", () => {
    const home = tempHome();
    fs.writeFileSync(
      getPopoConfigPath(home),
      JSON.stringify({ appId: "id", appKey: "key", appSecret: "secret" }),
      "utf8",
    );
    const cfg = loadPopoConfig(home);
    expect(cfg.token).toBe("");
    expect(cfg.aesKey).toBe("");
    expect(cfg.masterUid).toBe("");
  });

  it("throws when appId/appKey/appSecret missing", () => {
    const home = tempHome();
    fs.writeFileSync(getPopoConfigPath(home), JSON.stringify({}), "utf8");
    expect(() => loadPopoConfig(home)).toThrow(/POPO 配置不完整/);
  });

  it("throws when file missing", () => {
    expect(() => loadPopoConfig(tempHome())).toThrow(/读取 POPO 配置失败/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @muse-work/server test -- popoConfig`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/server/src/popo/popoConfig.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PopoConfig = {
  appId: string;
  appKey: string;
  appSecret: string;
  /** 回调验签 token（与开发者后台「事件订阅」保持一致） */
  token: string;
  /** 回调事件加解密 aesKey（与开发者后台「事件订阅」保持一致） */
  aesKey: string;
  /** 唯一可指挥机器人的主人账号 */
  masterUid: string;
};

export function getPopoConfigPath(home = os.homedir()): string {
  return path.join(home, ".popo-config.json");
}

export function savePopoConfig(config: PopoConfig, home?: string): void {
  const file = getPopoConfigPath(home);
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function loadPopoConfig(home?: string): PopoConfig {
  const file = getPopoConfigPath(home);
  let raw: Partial<PopoConfig>;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PopoConfig>;
  } catch (error) {
    throw new Error(`读取 POPO 配置失败: ${file} (${String(error)})`);
  }
  if (!raw.appId || !raw.appKey || !raw.appSecret) {
    throw new Error(`POPO 配置不完整: ${file}（缺少 appId/appKey/appSecret）`);
  }
  return {
    appId: raw.appId,
    appKey: raw.appKey,
    appSecret: raw.appSecret,
    token: raw.token ?? "",
    aesKey: raw.aesKey ?? "",
    masterUid: raw.masterUid ?? "",
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @muse-work/server test -- popoConfig`
Expected: 4 tests PASS

- [ ] **Step 5: 回填真实配置的 masterUid（一次性）**

Run:
```bash
node --input-type=module -e "
import fs from 'node:fs';
const p = process.env.HOME + '/.popo-config.json';
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
if (!c.masterUid) { c.masterUid = 'liuyuyang03@corp.netease.com'; fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 }); }
console.log('masterUid =', c.masterUid);
"
```
Expected: `masterUid = liuyuyang03@corp.netease.com`

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/popo/popoConfig.ts packages/server/tests/popoConfig.test.ts
git commit -m "feat(server): popo config module with masterUid"
```

---

### Task 2: crypt — 回调验签与 AES 解密

**Files:**
- Create: `packages/server/src/popo/crypt.ts`
- Test: `packages/server/tests/popoCrypt.test.ts`

**Interfaces:**
- Produces: `verifySignature(params: {token, timestamp, nonce, encrypt, signature}): boolean`、`decryptEvent(aesKey, encrypt): string`、`encryptEvent(aesKey, message): string`（测试对称加密）

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/popoCrypt.test.ts
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptEvent,
  encryptEvent,
  verifySignature,
} from "../src/popo/crypt.js";

function testKey(): string {
  // 43 位 base64（WeChat encodingAESKey 同规格）
  return crypto.randomBytes(32).toString("base64").slice(0, 43);
}

describe("popo crypt", () => {
  it("verifySignature matches wechat-style sha1 of sorted fields", () => {
    const token = "tk";
    const timestamp = "1700000000";
    const nonce = "n1";
    const encrypt = "ENC";
    const sorted = [token, timestamp, nonce, encrypt].sort().join("");
    const signature = crypto.createHash("sha1").update(sorted).digest("hex");
    expect(
      verifySignature({ token, timestamp, nonce, encrypt, signature }),
    ).toBe(true);
    expect(
      verifySignature({
        token,
        timestamp,
        nonce,
        encrypt,
        signature: "deadbeef",
      }),
    ).toBe(false);
  });

  it("decryptEvent round-trips encryptEvent", () => {
    const key = testKey();
    const message = '{"eventType":"IM_P2P_TO_ROBOT_MSG","eventData":{}}';
    const encrypted = encryptEvent(key, message);
    expect(decryptEvent(key, encrypted)).toBe(message);
  });

  it("rejects aesKey of wrong length", () => {
    expect(() => decryptEvent("short", "AAAA")).toThrow(/aesKey/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @muse-work/server test -- popoCrypt`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/server/src/popo/crypt.ts
import crypto from "node:crypto";

/**
 * 微信/企业微信风格的验签：msg_signature = SHA1( sort(token, timestamp, nonce, encrypt) 拼接 )
 * 注：POPO 具体算法待真实推送校准，本实现为最可能形态。
 */
export function verifySignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  encrypt: string;
  signature: string;
}): boolean {
  const arr = [params.token, params.timestamp, params.nonce, params.encrypt].sort();
  const digest = crypto.createHash("sha1").update(arr.join("")).digest("hex");
  return digest === params.signature.toLowerCase();
}

function deriveKey(aesKey: string): Buffer {
  const key = Buffer.from(`${aesKey}=`, "base64");
  if (key.length !== 32) {
    throw new Error(`aesKey 长度非法: ${key.length}（需 43 位）`);
  }
  return key;
}

/**
 * 解密回调事件：AES-256-CBC（IV=key 前 16 字节，手动 PKCS7 去填充）。
 * 明文布局（微信风格）：16 字节随机前缀 + 4 字节大端消息长度 + 消息 + receiveId。
 */
export function decryptEvent(aesKey: string, encrypt: string): string {
  const key = deriveKey(aesKey);
  const iv = key.subarray(0, 16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const raw = Buffer.concat([
    decipher.update(Buffer.from(encrypt, "base64")),
    decipher.final(),
  ]);
  const padLen = raw[raw.length - 1];
  const unpadded = raw.subarray(0, raw.length - padLen);
  const msgLen = unpadded.readUInt32BE(16);
  return unpadded.subarray(20, 20 + msgLen).toString("utf8");
}

/** 与 decryptEvent 对称的加密实现，仅用于测试向量。 */
export function encryptEvent(aesKey: string, message: string): string {
  const key = deriveKey(aesKey);
  const iv = key.subarray(0, 16);
  const random = crypto.randomBytes(16);
  const msg = Buffer.from(message, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(msg.length);
  let payload = Buffer.concat([random, len, msg]);
  const blockSize = 16;
  const padLen = blockSize - (payload.length % blockSize);
  payload = Buffer.concat([payload, Buffer.alloc(padLen, padLen)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(payload), cipher.final()]).toString(
    "base64",
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @muse-work/server test -- popoCrypt`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/popo/crypt.ts packages/server/tests/popoCrypt.test.ts
git commit -m "feat(server): popo callback verify and decrypt (wechat-style)"
```

---

### Task 3: tokenStore — accessToken 生命周期（缓存/刷新/换新/持久化）

**Files:**
- Create: `packages/server/src/popo/tokenStore.ts`
- Test: `packages/server/tests/popoTokens.test.ts`

**Interfaces:**
- Consumes: `PopoConfig`（appKey/appSecret）
- Produces: `TokenPair`、`TokenStore { getAccessToken(): Promise<string>; forceRefresh(): Promise<string> }`、`createTokenStore(options): TokenStore`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/popoTokens.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTokenStore, type TokenPair } from "../src/popo/tokenStore.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "popo-token-"));
}

function okPair(overrides: Partial<TokenPair> = {}): TokenPair {
  const now = Date.now();
  return {
    accessToken: "access-1",
    accessExpiredAt: now + 24 * 3600 * 1000,
    refreshToken: "refresh-1",
    refreshExpiredAt: now + 30 * 24 * 3600 * 1000,
    ...overrides,
  };
}

describe("popo tokenStore", () => {
  it("fetches a fresh token via /token on first call and caches it", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(String(init?.method ?? "GET") + " " + url);
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ errcode: 0, errmsg: "ok", data: okPair() }),
        { status: 200 },
      );
    }) as typeof fetch;

    const store = createTokenStore({
      home: tempHome(),
      appKey: "k",
      appSecret: "s",
      fetchImpl,
    });
    expect(await store.getAccessToken()).toBe("access-1");
    expect(await store.getAccessToken()).toBe("access-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/open-apis/robots/v1/token");
  });

  it("refreshes via /token/refresh when access token expired", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.includes("/token/refresh")) {
        return new Response(
          JSON.stringify({
            errcode: 0,
            errmsg: "ok",
            data: okPair({ accessToken: "access-2" }),
          }),
          { status: 200 },
        );
      }
      throw new Error("should not call /token");
    }) as typeof fetch;

    const store = createTokenStore({
      home: tempHome(),
      appKey: "k",
      appSecret: "s",
      fetchImpl,
      now: () => Date.now() + 25 * 3600 * 1000,
    });
    expect(await store.getAccessToken()).toBe("access-2");
    expect(calls[0]).toContain("/token/refresh");
  });

  it("renews via /token when refresh fails with 42002", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.includes("/token/refresh")) {
        return new Response(JSON.stringify({ status: 42002, message: "refresh token expire" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ errcode: 0, errmsg: "ok", data: okPair({ accessToken: "access-3" }) }),
        { status: 200 },
      );
    }) as typeof fetch;

    const store = createTokenStore({
      home: tempHome(),
      appKey: "k",
      appSecret: "s",
      fetchImpl,
      now: () => Date.now() + 25 * 3600 * 1000,
    });
    expect(await store.getAccessToken()).toBe("access-3");
    expect(calls.some((u) => u.includes("/open-apis/robots/v1/token"))).toBe(true);
  });

  it("persists tokens to disk and reloads them", async () => {
    const home = tempHome();
    const fetchImpl = (async () => {
      throw new Error("should not fetch when valid cached token exists");
    }) as typeof fetch;
    fs.mkdirSync(path.join(home, ".muse-work"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".muse-work", "popo-token.json"),
      JSON.stringify(okPair()),
      "utf8",
    );
    const store = createTokenStore({ home, appKey: "k", appSecret: "s", fetchImpl });
    expect(await store.getAccessToken()).toBe("access-1");
  });

  it("forceRefresh bypasses the cache", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      return new Response(
        JSON.stringify({ errcode: 0, errmsg: "ok", data: okPair({ accessToken: `access-${call}` }) }),
        { status: 200 },
      );
    }) as typeof fetch;
    const store = createTokenStore({
      home: tempHome(),
      appKey: "k",
      appSecret: "s",
      fetchImpl,
    });
    expect(await store.getAccessToken()).toBe("access-1");
    expect(await store.forceRefresh()).toBe("access-2");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @muse-work/server test -- popoTokens`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/server/src/popo/tokenStore.ts
import fs from "node:fs";
import path from "node:path";

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
  const file = path.join(options.home, ".muse-work", "popo-token.json");

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
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
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
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @muse-work/server test -- popoTokens`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/popo/tokenStore.ts packages/server/tests/popoTokens.test.ts
git commit -m "feat(server): popo access token store with refresh and persistence"
```

---

### Task 4: sender — send-msg 发送（切分/重试）

**Files:**
- Create: `packages/server/src/popo/sender.ts`
- Test: `packages/server/tests/popoSender.test.ts`

**Interfaces:**
- Consumes: `TokenStore`
- Produces: `MAX_TEXT_LENGTH = 3000`、`chunkText(content, max?): string[]`、`Sender { sendText(receiver, content): Promise<void> }`、`createSender(options): Sender`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/popoSender.test.ts
import { describe, expect, it } from "vitest";
import {
  chunkText,
  createSender,
  type Sender,
} from "../src/popo/sender.js";

describe("popo sender", () => {
  it("chunkText splits long content at 3000 code points", () => {
    const content = "a".repeat(7000) + "😀";
    const chunks = chunkText(content);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(3000);
    expect(chunks[2]).toBe("😀");
  });

  it("sendText posts with Open-Access-Token and returns on errcode 0", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()) as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 });
    }) as typeof fetch;

    const sender: Sender = createSender({
      tokenStore: { getAccessToken: async () => "tk-1", forceRefresh: async () => "tk-2" },
      fetchImpl,
    });
    await sender.sendText("user@corp.netease.com", "hello");
    expect(seen[0].headers["open-access-token"]).toBe("tk-1");
    expect(seen[0].body).toEqual({
      receiver: "user@corp.netease.com",
      message: { msgType: "text", content: "hello" },
    });
  });

  it("retries once with a fresh token on 42001", async () => {
    const tokens: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      tokens.push(headers.get("open-access-token") ?? "");
      const first = tokens.length === 1;
      return new Response(
        JSON.stringify(
          first
            ? { errcode: 42001, errmsg: "access token expired" }
            : { errcode: 0, errmsg: "ok" },
        ),
        { status: 200 },
      );
    }) as typeof fetch;

    const sender: Sender = createSender({
      tokenStore: { getAccessToken: async () => "stale", forceRefresh: async () => "fresh" },
      fetchImpl,
    });
    await sender.sendText("g1", "hi");
    expect(tokens).toEqual(["stale", "fresh"]);
  });

  it("throws on non-zero errcode", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ errcode: 65338, errmsg: "too long" }), { status: 200 })) as typeof fetch;
    const sender: Sender = createSender({
      tokenStore: { getAccessToken: async () => "tk", forceRefresh: async () => "tk" },
      fetchImpl,
    });
    await expect(sender.sendText("r", "x")).rejects.toThrow(/65338/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @muse-work/server test -- popoSender`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/server/src/popo/sender.ts
const SEND_API = "https://open.popo.netease.com/open-apis/robots/v1/im/send-msg";

export const MAX_TEXT_LENGTH = 3000;

/** 按码点切分，避免截断 emoji 等代理对字符。 */
export function chunkText(content: string, max = MAX_TEXT_LENGTH): string[] {
  const chars = [...content];
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += max) {
    chunks.push(chars.slice(i, i + max).join(""));
  }
  return chunks;
}

export interface Sender {
  sendText(receiver: string, content: string): Promise<void>;
}

export type SenderOptions = {
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
};

type SendResponse = { errcode: number; errmsg?: string };

export function createSender(options: SenderOptions): Sender {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function postOnce(
    token: string,
    receiver: string,
    content: string,
  ): Promise<SendResponse> {
    const res = await fetchImpl(SEND_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "open-access-token": token,
      },
      body: JSON.stringify({
        receiver,
        message: { msgType: "text", content },
      }),
    });
    if (!res.ok) throw new Error(`POPO send-msg ${res.status}`);
    return (await res.json()) as SendResponse;
  }

  return {
    async sendText(receiver, content) {
      for (const chunk of chunkText(content)) {
        const token = await options.tokenStore.getAccessToken();
        const result = await postOnce(token, receiver, chunk);
        if (result.errcode === 42001) {
          const fresh = await options.tokenStore.forceRefresh();
          const retry = await postOnce(fresh, receiver, chunk);
          if (retry.errcode !== 0) {
            throw new Error(`POPO send-msg 失败: ${retry.errcode} ${retry.errmsg ?? ""}`);
          }
          continue;
        }
        if (result.errcode !== 0) {
          throw new Error(`POPO send-msg 失败: ${result.errcode} ${result.errmsg ?? ""}`);
        }
      }
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @muse-work/server test -- popoSender`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/popo/sender.ts packages/server/tests/popoSender.test.ts
git commit -m "feat(server): popo send-msg sender with chunking and 42001 retry"
```

---

### Task 5: chatStore — POPO 会话持久化（独立文件）

**Files:**
- Create: `packages/server/src/popo/chatStore.ts`
- Test: `packages/server/tests/popoChats.test.ts`

**Interfaces:**
- Produces: `PopoChatType = "p2p" | "team"`、`PopoMessage`、`PopoChat`、`ChatStore { getChat/listChats/getOrCreateChat/appendMessage/setWaveSessionId }`、`createChatStore({home, maxMessages?})`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/popoChats.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createChatStore } from "../src/popo/chatStore.js";

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "popo-chats-"));
}

describe("popo chatStore", () => {
  it("creates and persists a chat, reloadable across instances", () => {
    const home = tempHome();
    const store = createChatStore({ home });
    const chat = store.getOrCreateChat("p2p:me@corp.netease.com", "p2p", "me@corp.netease.com");
    expect(chat.waveSessionId).toBeUndefined();
    store.setWaveSessionId(chat.chatKey, "wave-1");
    store.appendMessage(chat.chatKey, { role: "user", content: "hi", at: "t1" });

    const reloaded = createChatStore({ home });
    const got = reloaded.getChat("p2p:me@corp.netease.com");
    expect(got?.waveSessionId).toBe("wave-1");
    expect(got?.messages).toEqual([{ role: "user", content: "hi", at: "t1" }]);
  });

  it("listChats returns chats sorted by updatedAt desc", () => {
    const store = createChatStore({ home: tempHome() });
    store.getOrCreateChat("team:1", "team", "群 1");
    store.appendMessage("team:1", { role: "user", content: "a", at: "t1" });
    store.getOrCreateChat("p2p:b@corp.netease.com", "p2p", "b@corp.netease.com");
    store.appendMessage("p2p:b@corp.netease.com", { role: "user", content: "b", at: "t2" });
    const chats = store.listChats();
    expect(chats.map((c) => c.chatKey)).toEqual(["p2p:b@corp.netease.com", "team:1"]);
  });

  it("caps messages at maxMessages", () => {
    const store = createChatStore({ home: tempHome(), maxMessages: 3 });
    const chat = store.getOrCreateChat("p2p:x@corp.netease.com", "p2p", "x");
    for (let i = 0; i < 5; i += 1) {
      store.appendMessage(chat.chatKey, { role: "user", content: String(i), at: `t${i}` });
    }
    expect(store.getChat(chat.chatKey)?.messages.map((m) => m.content)).toEqual(["2", "3", "4"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @muse-work/server test -- popoChats`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/server/src/popo/chatStore.ts
import fs from "node:fs";
import path from "node:path";

export type PopoChatType = "p2p" | "team";

export interface PopoMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
  from?: string;
  to?: string;
  msgId?: string;
}

export interface PopoChat {
  chatKey: string;
  type: PopoChatType;
  title: string;
  waveSessionId?: string;
  messages: PopoMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatStore {
  getChat(chatKey: string): PopoChat | undefined;
  listChats(): PopoChat[];
  getOrCreateChat(chatKey: string, type: PopoChatType, title: string): PopoChat;
  appendMessage(chatKey: string, message: PopoMessage): void;
  setWaveSessionId(chatKey: string, waveSessionId: string): void;
}

export type ChatStoreOptions = {
  home: string;
  maxMessages?: number;
};

const DEFAULT_MAX_MESSAGES = 200;

export function createChatStore(options: ChatStoreOptions): ChatStore {
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const file = path.join(options.home, ".muse-work", "popo-chats.json");
  const chats = new Map<string, PopoChat>();

  function load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        version?: number;
        chats?: Record<string, PopoChat>;
      };
      for (const [key, chat] of Object.entries(raw.chats ?? {})) {
        chats.set(key, chat);
      }
    } catch {
      // 文件不存在或损坏：从空开始
    }
  }

  function persist(): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ version: 1, chats: Object.fromEntries(chats) }, null, 2) + "\n",
      "utf8",
    );
    fs.renameSync(tmp, file);
  }

  load();

  return {
    getChat(chatKey) {
      return chats.get(chatKey);
    },
    listChats() {
      return [...chats.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },
    getOrCreateChat(chatKey, type, title) {
      const existing = chats.get(chatKey);
      if (existing) return existing;
      const now = Date.now();
      const chat: PopoChat = {
        chatKey,
        type,
        title,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      chats.set(chatKey, chat);
      persist();
      return chat;
    },
    appendMessage(chatKey, message) {
      const chat = chats.get(chatKey);
      if (!chat) return;
      chat.messages.push(message);
      if (chat.messages.length > maxMessages) {
        chat.messages = chat.messages.slice(-maxMessages);
      }
      chat.updatedAt = Date.now();
      persist();
    },
    setWaveSessionId(chatKey, waveSessionId) {
      const chat = chats.get(chatKey);
      if (!chat) return;
      chat.waveSessionId = waveSessionId;
      persist();
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @muse-work/server test -- popoChats`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/popo/chatStore.ts packages/server/tests/popoChats.test.ts
git commit -m "feat(server): popo chat store persisted outside sessions storage"
```

---

### Task 6: popoAgent — agent 包装（系统提示词 + 最终文本提取）

**Files:**
- Create: `packages/server/src/popo/popoAgent.ts`
- Test: `packages/server/tests/popoAgent.test.ts`

**Interfaces:**
- Consumes: `CreateAgent`（`../services/sessionRunner.js`）、`ProviderRegistry`（`@muse-work/provider`）、`PopoChat`（chatStore）
- Produces: `POPO_SYSTEM_PROMPT`、`PopoAgentRunner { run(content): Promise<string> }`、`PopoAgentFactory(chat: Pick<PopoChat,"chatKey"|"type"|"waveSessionId">): Promise<PopoAgentRunner>`、`createPopoAgentFactory({home, registry, createAgent?, onWaveSessionId?})`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/popoAgent.test.ts
import { describe, expect, it } from "vitest";
import { createPopoAgentFactory } from "../src/popo/popoAgent.js";
import type { SessionAgent } from "../src/services/sessionRunner.js";

function stubAgent(finalText: string): SessionAgent {
  const messages = [
    { role: "user" as const, blocks: [{ type: "text" as const, content: "u" }] },
    { role: "assistant" as const, blocks: [{ type: "text" as const, content: finalText }] },
  ];
  return {
    sendMessage: async () => undefined,
    askBtw: async () => undefined,
    abortMessage: () => undefined,
    dispose: () => undefined,
    getMessages: () => messages,
    sessionId: "wave-1",
    compact: async () => undefined,
    clearMessages: () => undefined,
    truncateHistory: () => undefined,
    setPermissionMode: () => undefined,
    getPermissionMode: () => "bypassPermissions",
    getMcpServers: () => [],
    connectMcpServer: async () => ({ ok: true }),
    disconnectMcpServer: async () => ({ ok: true }),
    getBackgroundTaskOutput: async () => ({ output: null }),
    stopBackgroundTask: async () => ({ ok: true }),
    getWorkflowRuns: async () => [],
    stopWorkflowRun: async () => ({ ok: true }),
    hasPendingMessages: () => false,
    removeQueuedMessageById: () => false,
    updateQueuedMessageById: () => false,
    isLoading: () => false,
    queuedMessages: () => [],
    latestTotalTokens: 0,
  } as SessionAgent;
}

const registryStub = {
  get: () => ({
    id: "codemaker",
    listModels: async () => [{ id: "m1", label: "M1" }],
    resolveGateway: async (model: string) => ({ baseURL: "http://gw", model }),
  }),
  getActive: () => ({ providerId: "codemaker", modelId: undefined }),
} as never;

describe("popoAgent", () => {
  it("run returns the last assistant text block", async () => {
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () => stubAgent("最终回复"),
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    expect(await runner.run("hello")).toBe("最终回复");
  });

  it("throws when no assistant text produced", async () => {
    const factory = createPopoAgentFactory({
      home: "/tmp",
      registry: registryStub,
      createAgent: async () =>
        stubAgent("") as SessionAgent & {
          getMessages: () => {
            role: "assistant";
            blocks: { type: "error"; content: string }[];
          }[];
        },
    });
    const runner = await factory({ chatKey: "p2p:x", type: "p2p" });
    await expect(runner.run("hello")).rejects.toThrow(/未生成回复|回复为空/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @muse-work/server test -- popoAgent`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/server/src/popo/popoAgent.ts
import fs from "node:fs";
import path from "node:path";
import type { ProviderRegistry } from "@muse-work/provider";
import type { CreateAgent } from "../services/sessionRunner.js";
import { createAgentLogger } from "../utils/logger.js";
import type { PopoChatType } from "./chatStore.js";

export const POPO_SYSTEM_PROMPT = `你是 Muse 机器人，运行在 POPO 即时通讯上，为你的人类主人服务。

- 消息可能来自私聊或群聊。群聊消息开头可能带 "@机器人名 "，这是群成员 @ 你，正文才是需要你处理的内容。
- 当消息来自群聊时，如果上下文不完整（例如用户提到群里的历史讨论），可以使用本地 popo-cli（popo-im skill）读取该群的历史消息来补全上下文。
- 回复保持简洁、直接，使用中文。
- 只有主人可以直接指挥你；其他人发来的请求一律礼貌拒绝。`;

export interface PopoAgentRunner {
  run(content: string): Promise<string>;
}

export interface PopoAgentFactory {
  (chat: { chatKey: string; type: PopoChatType; waveSessionId?: string }): Promise<PopoAgentRunner>;
}

export type PopoAgentFactoryOptions = {
  home: string;
  registry: ProviderRegistry;
  createAgent?: CreateAgent;
  /** waveSessionId 变化时回调（用于持久化到 chatStore） */
  onWaveSessionId?: (chatKey: string, waveSessionId: string) => void;
};

function sanitizeSessionId(chatKey: string): string {
  return chatKey.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function createPopoAgentFactory(options: PopoAgentFactoryOptions): PopoAgentFactory {
  const createAgent = options.createAgent;
  /** 机器人 agent 工作目录：~/popo-chat（用户指定，与主会话 workdir 隔离） */
  const workdir = path.join(options.home, "popo-chat");

  return async (chat) => {
    fs.mkdirSync(workdir, { recursive: true });
    const active = options.registry.getActive();
    const provider = options.registry.get(active.providerId);
    if (!provider) throw new Error(`active provider not found: ${active.providerId}`);
    const model = active.modelId ?? (await provider.listModels())[0]?.id;
    if (!model) throw new Error("no active model");
    const gateway = await provider.resolveGateway(model);

    const agent = await createAgent({
      apiKey: gateway.apiKey,
      baseURL: gateway.baseURL,
      defaultHeaders: gateway.defaultHeaders,
      fetch: gateway.fetch,
      model: gateway.model,
      fastModel: gateway.fastModel ?? gateway.model,
      workdir,
      stream: true,
      permissionMode: "bypassPermissions",
      systemPrompt: POPO_SYSTEM_PROMPT,
      logger: createAgentLogger({
        home: options.home,
        sessionId: `popo-${sanitizeSessionId(chat.chatKey)}`,
      }),
      ...(chat.waveSessionId ? { restoreSessionId: chat.waveSessionId } : {}),
      callbacks: {
        onSessionIdChange: (id: string) => {
          options.onWaveSessionId?.(chat.chatKey, id);
        },
      },
    });

    return {
      async run(content) {
        await agent.sendMessage(content);
        const msgs = agent.getMessages().filter((m) => m.role === "assistant");
        const last = msgs[msgs.length - 1];
        const text = last?.blocks
          .filter((b) => b.type === "text")
          .map((b) => (b as { content: string }).content)
          .join("");
        if (text) return text;
        const error = last?.blocks.find((b) => b.type === "error");
        if (error) {
          throw new Error((error as { content: string }).content || "agent 回复为空");
        }
        throw new Error("agent 未生成回复");
      },
    };
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @muse-work/server test -- popoAgent`
Expected: 2 tests PASS
（若 stubAgent 类型断言编译不过，用 `as never`/`as SessionAgent` 收窄，勿改实现签名。）

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/popo/popoAgent.ts packages/server/tests/popoAgent.test.ts
git commit -m "feat(server): popo agent wrapper with robot system prompt"
```

---

### Task 7: handler — 事件分发/权限/两段式回复

**Files:**
- Create: `packages/server/src/popo/handler.ts`
- Test: `packages/server/tests/popoHandler.test.ts`

**Interfaces:**
- Consumes: `PopoConfig`、`ChatStore`、`Sender`、`PopoAgentFactory`
- Produces: `ACK_MESSAGE`、`REJECT_MESSAGE`、`PopoHandler { handle(eventType, eventData): Promise<void> }`、`createPopoHandler(options)`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/popoHandler.test.ts
import { describe, expect, it } from "vitest";
import {
  ACK_MESSAGE,
  REJECT_MESSAGE,
  createPopoHandler,
} from "../src/popo/handler.js";
import { createChatStore } from "../src/popo/chatStore.js";
import type { PopoConfig } from "../src/popo/popoConfig.js";

const config: PopoConfig = {
  appId: "id",
  appKey: "key",
  appSecret: "secret",
  token: "tk",
  aesKey: "ak",
  masterUid: "master@corp.netease.com",
};

function makeSender(log: Array<{ receiver: string; content: string }>) {
  return { sendText: async (r: string, c: string) => log.push({ receiver: r, content: c }) };
}

describe("popo handler", () => {
  it("rejects non-master with fixed message", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-1" }),
      sender: makeSender(sent) as never,
      agentFactory: async () => ({ run: async () => "不应被调用" }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "intruder@corp.netease.com",
      notify: "你好",
      sessionType: 1,
    });
    expect(sent).toEqual([{ receiver: "intruder@corp.netease.com", content: REJECT_MESSAGE }]);
  });

  it("sends ack then the agent's final text for master p2p", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-2" }),
      sender: makeSender(sent) as never,
      agentFactory: async () => ({ run: async () => "最终回复" }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "master@corp.netease.com",
      notify: "帮我看看",
      sessionType: 1,
    });
    expect(sent[0]).toEqual({ receiver: "master@corp.netease.com", content: ACK_MESSAGE });
    expect(sent[1]).toEqual({ receiver: "master@corp.netease.com", content: "最终回复" });
  });

  it("strips leading @-mention and injects group context in teams", async () => {
    const fed: string[] = [];
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-3" }),
      sender: makeSender([]) as never,
      agentFactory: async () => ({ run: async (c: string) => { fed.push(c); return "ok"; } }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_CHAT_TO_ROBOT_AT_MSG", {
      from: "master@corp.netease.com",
      notify: "@Muse机器人 看看群里的讨论",
      sessionType: 3,
      sessionId: "1696900",
    });
    expect(fed[0]).toContain("群号 1696900");
    expect(fed[0]).toContain("看看群里的讨论");
    expect(fed[0]).not.toContain("@Muse机器人");
  });

  it("sends error message when agent throws", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-4" }),
      sender: makeSender(sent) as never,
      agentFactory: async () => ({ run: async () => { throw new Error("模型超时"); } }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "master@corp.netease.com",
      notify: "hi",
      sessionType: 1,
    });
    expect(sent[0]).toEqual({ receiver: "master@corp.netease.com", content: ACK_MESSAGE });
    expect(sent[1].content).toContain("处理出错：模型超时");
  });

  it("ignores unknown event types", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-5" }),
      sender: makeSender(sent) as never,
      agentFactory: async () => ({ run: async () => "x" }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_USER_RECALL_MSG", { uuid: "u" });
    expect(sent).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @muse-work/server test -- popoHandler`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/server/src/popo/handler.ts
import type { winston } from "winston";
import type { ChatStore, PopoChatType } from "./chatStore.js";
import type { PopoConfig } from "./popoConfig.js";
import type { PopoAgentFactory } from "./popoAgent.js";
import type { Sender } from "./sender.js";

export const ACK_MESSAGE = "收到，马上处理，请稍等一会....";
export const REJECT_MESSAGE = "大胆，只有尊敬的大人可以指挥我做事";

export interface PopoHandler {
  handle(eventType: string, eventData: Record<string, unknown>): Promise<void>;
}

export type PopoHandlerOptions = {
  config: PopoConfig;
  chatStore: ChatStore;
  sender: Sender;
  agentFactory: PopoAgentFactory;
  logger: winston.Logger;
};

function stripAtMention(notify: string): string {
  return notify.replace(/^@[^\s]+[\s　]*/, "").trim();
}

/** 群消息注入上下文（spec §5.4）：群号 + 引导用 popo-cli 读群历史；P2P 不注入。 */
function buildAgentContent(type: PopoChatType, notify: string, sessionId: string): string {
  const body = type === "team" ? stripAtMention(notify) : notify;
  if (type !== "team") return body;
  return [
    `（本条消息来自群聊，群号 ${sessionId}。若需要群内历史上下文，可用本地 popo-cli / popo-im skill 读取该群消息。）`,
    body,
  ].join("\n");
}

export function createPopoHandler(options: PopoHandlerOptions): PopoHandler {
  const { config, chatStore, sender, agentFactory, logger } = options;

  function toChat(
    eventType: string,
    data: Record<string, unknown>,
  ):
    | { chatKey: string; type: PopoChatType; title: string; receiver: string; from: string; notify: string }
    | undefined {
    const from = String(data.from ?? "");
    const notify = String(data.notify ?? "");
    if (eventType === "IM_P2P_TO_ROBOT_MSG") {
      if (!from) return undefined;
      return { chatKey: `p2p:${from}`, type: "p2p", title: from, receiver: from, from, notify };
    }
    if (eventType === "IM_CHAT_TO_ROBOT_AT_MSG") {
      const sessionId = String(data.sessionId ?? "");
      if (!sessionId) return undefined;
      return {
        chatKey: `team:${sessionId}`,
        type: "team",
        title: `群 ${sessionId}`,
        receiver: sessionId,
        from,
        notify,
      };
    }
    return undefined;
  }

  return {
    async handle(eventType, eventData) {
      const chat = toChat(eventType, eventData);
      if (!chat) {
        logger.info("popo event ignored", { eventType });
        return;
      }
      const { chatKey, type, title, receiver, from, notify } = chat;

      if (from !== config.masterUid) {
        logger.info("popo rejected non-master", { from });
        await sender.sendText(receiver, REJECT_MESSAGE);
        return;
      }

      await sender.sendText(receiver, ACK_MESSAGE);
      chatStore.getOrCreateChat(chatKey, type, title);
      chatStore.appendMessage(chatKey, {
        role: "user",
        content: notify,
        at: new Date().toISOString(),
        from,
      });

      try {
        const record = chatStore.getChat(chatKey);
        const content = buildAgentContent(type, notify, type === "team" ? receiver : "");
        const runner = await agentFactory(record ?? { chatKey, type, title });
        const reply = await runner.run(content);
        if (reply.trim()) {
          await sender.sendText(receiver, reply);
          chatStore.appendMessage(chatKey, {
            role: "assistant",
            content: reply,
            at: new Date().toISOString(),
            to: receiver,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("popo agent failed", { chatKey, error: message });
        await sender.sendText(receiver, `处理出错：${message}`);
      }
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @muse-work/server test -- popoHandler`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/popo/handler.ts packages/server/tests/popoHandler.test.ts
git commit -m "feat(server): popo event handler with ack/reject and two-phase reply"
```

---

### Task 8: callbackApp — 回调 Hono 实例 + 集成测试

**Files:**
- Create: `packages/server/src/popo/callbackApp.ts`
- Test: `packages/server/tests/popoCallbackApp.test.ts`

**Interfaces:**
- Consumes: `PopoConfig`、`PopoHandler`、`crypt`（verifySignature/decryptEvent/encryptEvent）
- Produces: `createCallbackApp({config, handler, logger}): Hono`

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/popoCallbackApp.test.ts
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCallbackApp } from "../src/popo/callbackApp.js";
import { encryptEvent } from "../src/popo/crypt.js";
import type { PopoConfig } from "../src/popo/popoConfig.js";

const config: PopoConfig = {
  appId: "id",
  appKey: "key",
  appSecret: "secret",
  token: "test-token",
  aesKey: crypto.randomBytes(32).toString("base64").slice(0, 43),
  masterUid: "master@corp.netease.com",
};

function sign(encrypt: string, timestamp: string, nonce: string): string {
  const sorted = [config.token, timestamp, nonce, encrypt].sort().join("");
  return crypto.createHash("sha1").update(sorted).digest("hex");
}

function makeHandler() {
  const events: Array<{ eventType: string; eventData: unknown }> = [];
  return {
    events,
    handler: {
      handle: async (eventType: string, eventData: Record<string, unknown>) => {
        events.push({ eventType, eventData });
      },
    },
  };
}

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

async function post(app: ReturnType<typeof createCallbackApp>, body: unknown): Promise<Response> {
  const req = new Request("http://0.0.0.0:3100/popo/callback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return app.fetch(req);
}

describe("popo callback app", () => {
  it("GET handshake echoes echostr with valid signature", async () => {
    const app = createCallbackApp({ config, handler: makeHandler().handler, logger });
    const echostr = "hello123";
    const timestamp = "1700000000";
    const nonce = "n1";
    const res = await app.fetch(
      `http://x/popo/callback?timestamp=${timestamp}&nonce=${nonce}&echostr=${echostr}&msg_signature=${sign(echostr, timestamp, nonce)}`,
    );
    expect(await res.text()).toBe("hello123");
  });

  it("POST decrypts a valid event and dispatches to handler", async () => {
    const { events, handler } = makeHandler();
    const app = createCallbackApp({ config, handler, logger });
    const event = { eventType: "IM_P2P_TO_ROBOT_MSG", eventData: { from: "a@b", notify: "hi" } };
    const encrypt = encryptEvent(config.aesKey, JSON.stringify(event));
    const timestamp = "1700000001";
    const nonce = "n2";
    const res = await post(app, { timestamp, nonce, encrypt, msg_signature: sign(encrypt, timestamp, nonce) });
    expect(await res.json()).toEqual({ code: 0, msg: "ok" });
    expect(events).toEqual([event]);
  });

  it("POST rejects bad signature", async () => {
    const { handler } = makeHandler();
    const app = createCallbackApp({ config, handler, logger });
    const res = await post(app, { timestamp: "1", nonce: "2", encrypt: "AAAA", msg_signature: "bad" });
    expect(res.status).toBe(401);
  });

  it("POST rejects missing fields", async () => {
    const { handler } = makeHandler();
    const app = createCallbackApp({ config, handler, logger });
    const res = await post(app, {});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @muse-work/server test -- popoCallbackApp`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/server/src/popo/callbackApp.ts
import { Hono } from "hono";
import type { winston } from "winston";
import { decryptEvent, verifySignature } from "./crypt.js";
import type { PopoHandler } from "./handler.js";
import type { PopoConfig } from "./popoConfig.js";

export type CallbackAppOptions = {
  config: PopoConfig;
  handler: PopoHandler;
  logger: winston.Logger;
};

/**
 * POPO 事件订阅回调端点。当前为最可能形态（微信风格：GET 验签回显 echostr，
 * POST 携带 {timestamp, nonce, msg_signature, encrypt}），真实推送格式待校准。
 */
export function createCallbackApp(options: CallbackAppOptions): Hono {
  const { config, handler, logger } = options;
  const app = new Hono();

  app.get("/popo/callback", (c) => {
    const q = c.req.query();
    logger.info("popo callback GET", { query: q });
    const { timestamp, nonce, echostr, msg_signature } = q;
    if (echostr && timestamp && nonce && msg_signature) {
      if (
        verifySignature({
          token: config.token,
          timestamp,
          nonce,
          encrypt: echostr,
          signature: msg_signature,
        })
      ) {
        return c.text(echostr);
      }
      return c.text("invalid signature", 401);
    }
    return c.json({ code: 0, msg: "ok" });
  });

  app.post("/popo/callback", async (c) => {
    const raw = await c.req.text();
    let payload: { timestamp?: string; nonce?: string; msg_signature?: string; encrypt?: string };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      logger.warn("popo callback invalid json", { raw: raw.slice(0, 500) });
      return c.json({ code: -1, msg: "invalid json" }, 400);
    }
    if (!payload.encrypt || !payload.timestamp || !payload.nonce || !payload.msg_signature) {
      logger.warn("popo callback missing fields", { keys: Object.keys(payload) });
      return c.json({ code: -1, msg: "missing fields" }, 400);
    }
    const ok = verifySignature({
      token: config.token,
      timestamp: payload.timestamp,
      nonce: payload.nonce,
      encrypt: payload.encrypt,
      signature: payload.msg_signature,
    });
    if (!ok) {
      logger.warn("popo callback bad signature");
      return c.json({ code: -1, msg: "bad signature" }, 401);
    }
    let plain: string;
    try {
      plain = decryptEvent(config.aesKey, payload.encrypt);
    } catch (error) {
      logger.error("popo callback decrypt failed", { error: String(error) });
      return c.json({ code: -1, msg: "decrypt failed" }, 500);
    }
    let event: { eventType?: string; eventData?: Record<string, unknown> };
    try {
      event = JSON.parse(plain) as typeof event;
    } catch {
      logger.error("popo callback event json parse failed", { plain: plain.slice(0, 500) });
      return c.json({ code: -1, msg: "bad event" }, 500);
    }
    if (!event.eventType) {
      logger.warn("popo callback missing eventType", { plain: plain.slice(0, 500) });
      return c.json({ code: 0, msg: "ok" });
    }
    // 回调快速返回：ack 在 handler 内部先发出，agent 流程后台继续。
    const flow = handler.handle(event.eventType, event.eventData ?? {});
    void flow.catch((error) =>
      logger.error("popo handler failed", { error: String(error) }),
    );
    return c.json({ code: 0, msg: "ok" });
  });

  return app;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm -F @muse-work/server test -- popoCallbackApp`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/popo/callbackApp.ts packages/server/tests/popoCallbackApp.test.ts
git commit -m "feat(server): popo callback hono app with verify/decrypt/dispatch"
```

---

### Task 9: 主 server 接线 — setup/routes/app/index（含隔离启动）

**Files:**
- Create: `packages/server/src/popo/setup.ts`
- Create: `packages/server/src/popo/routes.ts`
- Modify: `packages/server/src/services/appContext.ts`（AppContext 加 `popo?: PopoRuntime`）
- Modify: `packages/server/src/app.ts`（挂载 popoRoutes）
- Modify: `packages/server/src/index.ts`（setup 后启动回调监听）
- Test: `packages/server/tests/popoRoutes.test.ts`

**Interfaces:**
- Consumes: Task 1-8 全部
- Produces: `PopoRuntime { config, chatStore, callbackPort, ready, error?, url }`、`setupPopoRuntime(ctx, options?): PopoRuntime`、`createPopoRoutes(runtime): Hono`

- [ ] **Step 1: 写失败测试（routes）**

```ts
// packages/server/tests/popoRoutes.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPopoRoutes } from "../src/popo/routes.js";
import { createChatStore } from "../src/popo/chatStore.js";
import type { PopoConfig } from "../src/popo/popoConfig.js";
import type { PopoRuntime } from "../src/popo/setup.js";

function runtime(): PopoRuntime {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "popo-routes-"));
  const config: PopoConfig = {
    appId: "id",
    appKey: "key",
    appSecret: "secret",
    token: "tk",
    aesKey: "ak",
    masterUid: "master@corp.netease.com",
  };
  const chatStore = createChatStore({ home });
  chatStore.getOrCreateChat("p2p:master@corp.netease.com", "p2p", "master@corp.netease.com");
  chatStore.appendMessage("p2p:master@corp.netease.com", {
    role: "assistant",
    content: "回复内容",
    at: "t1",
  });
  return {
    config,
    chatStore,
    callbackPort: 3100,
    ready: true,
    url: "http://127.0.0.1:3100/popo/callback",
  };
}

describe("popo routes", () => {
  it("GET /popo/config exposes config and readiness", async () => {
    const app = createPopoRoutes(runtime());
    const res = await app.fetch(new Request("http://x/popo/config"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.url).toContain("/popo/callback");
    expect(body.token).toBe("tk");
    expect(body.aesKey).toBe("ak");
    expect(body.masterUid).toBe("master@corp.netease.com");
    expect(body.ready).toBe(true);
  });

  it("GET /popo/chats lists chats with last message", async () => {
    const app = createPopoRoutes(runtime());
    const res = await app.fetch(new Request("http://x/popo/chats"));
    const body = (await res.json()) as { chats: Array<{ chatKey: string; lastMessage: string }> };
    expect(body.chats[0].chatKey).toBe("p2p:master@corp.netease.com");
    expect(body.chats[0].lastMessage).toBe("回复内容");
  });

  it("GET /popo/chats/:chatKey returns detail or 404", async () => {
    const app = createPopoRoutes(runtime());
    const ok = await app.fetch(new Request("http://x/popo/chats/p2p%3Amaster%40corp.netease.com"));
    expect((await ok.json()) as { chat: { chatKey: string } }).toMatchObject({
      chat: { chatKey: "p2p:master@corp.netease.com" },
    });
    const missing = await app.fetch(new Request("http://x/popo/chats/team%3A999"));
    expect(missing.status).toBe(404);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @muse-work/server test -- popoRoutes`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 routes + setup**

```ts
// packages/server/src/popo/routes.ts
import { Hono } from "hono";
import type { PopoRuntime } from "./setup.js";

export function createPopoRoutes(runtime: PopoRuntime): Hono {
  const app = new Hono();

  app.get("/popo/config", (c) =>
    c.json({
      url: runtime.url,
      token: runtime.config.token,
      aesKey: runtime.config.aesKey,
      masterUid: runtime.config.masterUid,
      port: runtime.callbackPort,
      ready: runtime.ready,
      error: runtime.error ?? null,
    }),
  );

  app.get("/popo/chats", (c) =>
    c.json({
      chats: runtime.chatStore.listChats().map((chat) => ({
        chatKey: chat.chatKey,
        type: chat.type,
        title: chat.title,
        lastMessage: chat.messages[chat.messages.length - 1]?.content ?? "",
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      })),
    }),
  );

  app.get("/popo/chats/:chatKey", (c) => {
    const chat = runtime.chatStore.getChat(decodeURIComponent(c.req.param("chatKey")));
    if (!chat) return c.json({ error: "chat not found" }, 404);
    return c.json({ chat });
  });

  return app;
}
```

```ts
// packages/server/src/popo/setup.ts
import { serve } from "@hono/node-server";
import { networkInterfaces } from "node:os";
import type { AppContext } from "../services/appContext.js";
import type { CreateAgent } from "../services/sessionRunner.js";
import { getLogger } from "../utils/logger.js";
import { createCallbackApp } from "./callbackApp.js";
import { createChatStore, type ChatStore } from "./chatStore.js";
import { createPopoHandler } from "./handler.js";
import { createPopoAgentFactory } from "./popoAgent.js";
import { loadPopoConfig, type PopoConfig } from "./popoConfig.js";
import { createSender } from "./sender.js";
import { createTokenStore } from "./tokenStore.js";

export type PopoRuntime = {
  config: PopoConfig;
  chatStore: ChatStore;
  callbackPort: number;
  ready: boolean;
  error?: string;
  url: string;
};

export function getLanIPv4(): string | undefined {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal && name.startsWith("en")) {
        return net.address;
      }
    }
  }
  return undefined;
}

export type SetupPopoOptions = {
  callbackPort?: number;
  createAgent?: CreateAgent;
};

export function setupPopoRuntime(ctx: AppContext, options?: SetupPopoOptions): PopoRuntime {
  const logger = getLogger();
  const callbackPort = options?.callbackPort ?? Number(process.env.POPO_CALLBACK_PORT ?? 3100);
  const ip = getLanIPv4() ?? "127.0.0.1";
  const url = `http://${ip}:${callbackPort}/popo/callback`;

  let config: PopoConfig;
  try {
    config = loadPopoConfig(ctx.home);
  } catch (error) {
    logger.error("popo disabled: config unavailable", { error: String(error) });
    return {
      config: null as unknown as PopoConfig,
      chatStore: null as unknown as ChatStore,
      callbackPort,
      ready: false,
      error: String(error),
      url,
    };
  }

  const chatStore = createChatStore({ home: ctx.home });
  const runtime: PopoRuntime = { config, chatStore, callbackPort, ready: false, url };

  const tokenStore = createTokenStore({
    home: ctx.home,
    appKey: config.appKey,
    appSecret: config.appSecret,
  });
  const sender = createSender({ tokenStore });
  const agentFactory = createPopoAgentFactory({
    home: ctx.home,
    registry: ctx.registry,
    createAgent: options?.createAgent,
    onWaveSessionId: (chatKey, waveSessionId) => {
      chatStore.setWaveSessionId(chatKey, waveSessionId);
    },
  });
  const handler = createPopoHandler({ config, chatStore, sender, agentFactory, logger });
  const app = createCallbackApp({ config, handler, logger });

  // 隔离性硬约束：回调监听失败只降级，不影响主 server。
  try {
    const server = serve(
      { fetch: app.fetch, hostname: "0.0.0.0", port: callbackPort },
      () => {
        runtime.ready = true;
        logger.info("popo callback listening", { port: callbackPort, url });
      },
    );
    server.on("error", (error) => {
      runtime.ready = false;
      runtime.error = String(error);
      logger.error("popo callback bind failed (popo degraded, muse unaffected)", {
        error: String(error),
      });
    });
  } catch (error) {
    runtime.ready = false;
    runtime.error = String(error);
    logger.error("popo callback start failed (popo degraded, muse unaffected)", {
      error: String(error),
    });
  }

  return runtime;
}
```

```ts
// packages/server/src/services/appContext.ts — AppContext 接口增加字段
export interface AppContext {
  home: string;
  registry: ProviderRegistry;
  store: SessionStore;
  hub: WsHub;
  runner: SessionRunner;
  /** POPO 机器人运行时（未启用时为 undefined） */
  popo?: import("../popo/setup.js").PopoRuntime;
}
```

```ts
// packages/server/src/app.ts — 挂载 popo 路由（在 sessionsRoutes 之后）
import { createPopoRoutes } from "./popo/routes.js";

// createHonoApp 内，app.route("/", sessionsRoutes); 之后追加：
if (ctx.popo) {
  app.route("/", createPopoRoutes(ctx.popo));
}
```

```ts
// packages/server/src/index.ts — 在 createAppContext 之后、createApp 之前：
import { setupPopoRuntime } from "./popo/setup.js";

const ctx = createAppContext();
const popo = setupPopoRuntime(ctx);
ctx.popo = popo;
```

- [ ] **Step 4: 运行确认通过（routes 测试 + 全量 server 测试无回归）**

Run: `pnpm -F @muse-work/server test -- popoRoutes`
Expected: 3 tests PASS

Run: `pnpm -F @muse-work/server test`
Expected: 除已知 3 个 pre-existing agent-recreate 失败外全部 PASS（先 `git stash` 确认基线一致）

Run: `pnpm -F @muse-work/server type-check`
Expected: PASS

- [ ] **Step 5: 手动冒烟（可选，验证隔离性）**

Run: `POPO_CALLBACK_PORT=39999 pnpm -F @muse-work/server dev`（临时移走 ~/.popo-config.json 或置空）
Expected: server 正常 ready 输出，日志含 `popo disabled`；主功能不受影响

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/popo/setup.ts packages/server/src/popo/routes.ts packages/server/src/services/appContext.ts packages/server/src/app.ts packages/server/src/index.ts packages/server/tests/popoRoutes.test.ts
git commit -m "feat(server): wire popo callback listener and routes into main server"
```

---

### Task 10: webview — API 方法与机器人页面组件

**Files:**
- Modify: `packages/webview/src/muse/apiClient.ts`（新增 3 个方法 + 类型）
- Create: `packages/webview/src/components/popo/PopoRobotView.tsx`
- Test: `packages/webview/src/components/popo/PopoRobotView.test.tsx`

**Interfaces:**
- Consumes: `MuseApiClient`（现有类）
- Produces: `PopoConfigInfo`、`PopoChatSummary`、`PopoChatDetail`、`getPopoConfig/listPopoChats/getPopoChat` 方法、`PopoRobotView({api})`

- [ ] **Step 1: 写失败测试**

```tsx
// packages/webview/src/components/popo/PopoRobotView.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PopoRobotView } from "./PopoRobotView";
import type { MuseApiClient } from "../../muse/apiClient";

function stubApi() {
  const api = {
    getPopoConfig: vi.fn().mockResolvedValue({
      url: "http://10.0.0.1:3100/popo/callback",
      token: "tk",
      aesKey: "ak",
      masterUid: "me@corp.netease.com",
      port: 3100,
      ready: true,
      error: null,
    }),
    listPopoChats: vi.fn().mockResolvedValue({
      chats: [
        { chatKey: "p2p:me@corp.netease.com", type: "p2p", title: "me@corp.netease.com", lastMessage: "你好", updatedAt: 1 },
        { chatKey: "team:1696900", type: "team", title: "群 1696900", lastMessage: "群里问了个问题", updatedAt: 2 },
      ],
    }),
    getPopoChat: vi.fn().mockResolvedValue({
      chat: {
        chatKey: "team:1696900",
        type: "team",
        title: "群 1696900",
        messages: [
          { role: "user", content: "群里问了个问题", at: "t1" },
          { role: "assistant", content: "答案在这", at: "t2" },
        ],
      },
    }),
  } as unknown as MuseApiClient;
  return api;
}

describe("PopoRobotView", () => {
  it("renders the config card with URL/token/aesKey/master", async () => {
    render(<PopoRobotView api={stubApi()} />);
    expect(await screen.findByText("http://10.0.0.1:3100/popo/callback")).toBeInTheDocument();
    expect(screen.getByText("tk")).toBeInTheDocument();
    expect(screen.getByText("ak")).toBeInTheDocument();
    expect(screen.getByText("me@corp.netease.com")).toBeInTheDocument();
  });

  it("shows chat list and opens chat detail on click", async () => {
    const user = userEvent.setup();
    render(<PopoRobotView api={stubApi()} />);
    await screen.findByText("群 1696900");
    await user.click(screen.getByText("群 1696900"));
    await waitFor(() => {
      expect(screen.getByText("答案在这")).toBeInTheDocument();
    });
  });

  it("shows the degraded notice when callback not ready", async () => {
    const api = stubApi();
    (api.getPopoConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: "http://10.0.0.1:3100/popo/callback",
      token: "tk",
      aesKey: "ak",
      masterUid: "me@corp.netease.com",
      port: 3100,
      ready: false,
      error: "listen EADDRINUSE: 3100",
    });
    render(<PopoRobotView api={api} />);
    expect(await screen.findByText(/回调未就绪/)).toBeInTheDocument();
    expect(screen.getByText(/EADDRINUSE/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @muse-work/webview test -- PopoRobotView`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现 API 方法（apiClient.ts 追加）**

```ts
// packages/webview/src/muse/apiClient.ts — 文件末尾追加类型 + 类末尾追加方法

export interface PopoConfigInfo {
  url: string;
  token: string;
  aesKey: string;
  masterUid: string;
  port: number;
  ready: boolean;
  error: string | null;
}

export interface PopoChatSummary {
  chatKey: string;
  type: "p2p" | "team";
  title: string;
  lastMessage: string;
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
  messages: PopoChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// MuseApiClient 类内追加：
  async getPopoConfig(): Promise<PopoConfigInfo> {
    const res = await this.request("/popo/config");
    return parseJson(res);
  }

  async listPopoChats(): Promise<{ chats: PopoChatSummary[] }> {
    const res = await this.request("/popo/chats");
    return parseJson(res);
  }

  async getPopoChat(chatKey: string): Promise<{ chat: PopoChatDetail }> {
    const res = await this.request(`/popo/chats/${encodeURIComponent(chatKey)}`);
    return parseJson(res);
  }
```

- [ ] **Step 4: 实现组件**

```tsx
// packages/webview/src/components/popo/PopoRobotView.tsx
import { useCallback, useEffect, useState } from "react";
import type {
  MuseApiClient,
  PopoChatDetail,
  PopoChatSummary,
  PopoConfigInfo,
} from "../../muse/apiClient";

export const PopoRobotView: React.FC<{ api: MuseApiClient }> = ({ api }) => {
  const [config, setConfig] = useState<PopoConfigInfo | null>(null);
  const [chats, setChats] = useState<PopoChatSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<PopoChatDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const [cfg, chatList] = await Promise.all([
        api.getPopoConfig(),
        api.listPopoChats(),
      ]);
      setConfig(cfg);
      setChats(chatList.chats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const openChat = useCallback(
    async (chatKey: string) => {
      setSelectedKey(chatKey);
      try {
        const res = await api.getPopoChat(chatKey);
        setDetail(res.chat);
      } catch (err) {
        setDetail(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api],
  );

  return (
    <div className="popo-robot-view" data-testid="popo-robot-view">
      <h2 className="popo-robot-view-title">POPO 机器人</h2>

      <section className="popo-config-card" data-testid="popo-config-card">
        <h3>回调配置</h3>
        {config === null ? (
          <p>加载中…</p>
        ) : (
          <dl className="popo-config-grid">
            <dt>请求地址 URL</dt>
            <dd>{config.url}</dd>
            <dt>token</dt>
            <dd>{config.token}</dd>
            <dt>aesKey</dt>
            <dd>{config.aesKey}</dd>
            <dt>主人账号</dt>
            <dd>{config.masterUid}</dd>
            <dt>回调端口</dt>
            <dd>{config.port}</dd>
            <dt>监听状态</dt>
            <dd>
              {config.ready ? (
                <span className="popo-ready">就绪</span>
              ) : (
                <span className="popo-degraded" data-testid="popo-not-ready">
                  回调未就绪：{config.error ?? "未知原因"}
                </span>
              )}
            </dd>
          </dl>
        )}
      </section>

      {error && <p className="popo-error">{error}</p>}

      <div className="popo-chats-layout">
        <section className="popo-chat-list" data-testid="popo-chat-list">
          <h3>会话</h3>
          {chats.length === 0 ? (
            <p className="popo-empty">暂无会话</p>
          ) : (
            <ul>
              {chats.map((chat) => (
                <li key={chat.chatKey}>
                  <button
                    type="button"
                    className={
                      selectedKey === chat.chatKey ? "popo-chat-item active" : "popo-chat-item"
                    }
                    onClick={() => void openChat(chat.chatKey)}
                    data-testid={`popo-chat-${chat.chatKey}`}
                  >
                    <span className="popo-chat-title">
                      {chat.type === "team" ? "群" : ""} {chat.title}
                    </span>
                    <span className="popo-chat-last">{chat.lastMessage}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="popo-chat-detail" data-testid="popo-chat-detail">
          {detail === null ? (
            <p className="popo-empty">选择一个会话查看详情</p>
          ) : (
            <>
              <h3>{detail.title}</h3>
              <div className="popo-messages">
                {detail.messages.map((msg, i) => (
                  <div key={i} className={`popo-message popo-${msg.role}`}>
                    <span className="popo-message-role">
                      {msg.role === "user" ? "用户" : "机器人"}
                    </span>
                    <p className="popo-message-content">{msg.content}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm -F @muse-work/webview test -- PopoRobotView`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/webview/src/muse/apiClient.ts packages/webview/src/components/popo/PopoRobotView.tsx packages/webview/src/components/popo/PopoRobotView.test.tsx
git commit -m "feat(webview): popo robot view with config card and chat list/detail"
```

---

### Task 11: webview — 侧栏入口与接线

**Files:**
- Modify: `packages/webview/src/components/desktop/DesktopSidebar.tsx`（新对话下方加入口）
- Modify: `packages/webview/src/components/ChatApp.tsx`（robotViewOpen 状态 + 渲染切换）
- Modify: webview 样式文件（`.desktop-sidebar-popo-robot` 与 `.popo-*` 样式；找到现有 desktop-sidebar 样式所在 CSS 文件追加）
- Test: `packages/webview/src/components/desktop/DesktopSidebar.test.tsx`（追加用例）

**Interfaces:**
- Consumes: `PopoRobotView`、`MuseApiClient` 实例（ChatApp 已有 `api`）
- Produces: `DesktopSidebar` 新 prop `onTogglePopoRobot: () => void`

- [ ] **Step 1: 写失败测试（侧栏入口）**

```tsx
// packages/webview/src/components/desktop/DesktopSidebar.test.tsx — 追加用例
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesktopSidebar } from "./DesktopSidebar";

function renderSidebar(overrides: Record<string, unknown> = {}) {
  return render(
    <DesktopSidebar
      onNewSession={vi.fn()}
      onNewSessionInPane={vi.fn()}
      onNewSessionInWorkdir={vi.fn()}
      isStreaming={false}
      disabled={false}
      onOpenSettings={vi.fn()}
      sessionTree={[]}
      pinnedSessions={[]}
      recentSessions={[]}
      currentSessionId={undefined}
      visibleSessionIds={[]}
      onSelectSession={vi.fn()}
      onOpenPane={vi.fn()}
      onDeleteSession={vi.fn()}
      onTogglePin={vi.fn()}
      onRenameSession={vi.fn()}
      onOpenInEditor={vi.fn()}
      onOpenInTerminal={vi.fn()}
      onRevealInFinder={vi.fn()}
      onTogglePopoRobot={vi.fn()}
      {...overrides}
    />,
  );
}

describe("DesktopSidebar popo entry", () => {
  it("renders the POPO 机器人 entry below 新对话", () => {
    renderSidebar();
    const newChat = screen.getByTestId("desktop-new-session");
    const popoBtn = screen.getByTestId("desktop-popo-robot");
    expect(newChat.compareDocumentPosition(popoBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("calls onTogglePopoRobot on click", async () => {
    const user = userEvent.setup();
    const onTogglePopoRobot = vi.fn();
    renderSidebar({ onTogglePopoRobot });
    await user.click(screen.getByTestId("desktop-popo-robot"));
    expect(onTogglePopoRobot).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm -F @muse-work/webview test -- DesktopSidebar`
Expected: FAIL（desktop-popo-robot 不存在）

- [ ] **Step 3: 实现侧栏入口**

```tsx
// packages/webview/src/components/desktop/DesktopSidebar.tsx
// 1) DesktopSidebarProps 加：
//   onTogglePopoRobot: () => void;
// 2) 函数参数解构加：onTogglePopoRobot
// 3) 「新对话」按钮（desktop-sidebar-new-chat）之后、<SessionTree> 之前插入：
<button
  type="button"
  className="desktop-sidebar-popo-robot"
  onClick={onTogglePopoRobot}
  data-testid="desktop-popo-robot"
>
  <span>POPO 机器人</span>
</button>
```

- [ ] **Step 4: ChatApp 接线**

```tsx
// packages/webview/src/components/ChatApp.tsx
// 1) 引入：import { PopoRobotView } from "./popo/PopoRobotView";
// 2) 组件内加状态：
const [robotViewOpen, setRobotViewOpen] = useState(false);
// 3) DesktopSidebar 传入：
<DesktopSidebar
  ...
  onTogglePopoRobot={() => setRobotViewOpen((v) => !v)}
/>
// 4) 主聊天 body 渲染处切换（搜索现有渲染聊天消息区的 JSX 容器）：
//    {robotViewOpen ? (
//      <PopoRobotView api={api} />
//    ) : (
//      /* 现有聊天 body 原样保留 */
//    )}
//    注：若现有布局将 body 拆成多个并列元素，用条件包裹最外层容器即可；
//    robotViewOpen 开启时无需渲染会话消息区。
```

- [ ] **Step 5: 样式追加**

找到 `desktop-sidebar-new-chat` 所在 CSS 文件（搜索 `.desktop-sidebar-new-chat`），在附近追加：

```css
.desktop-sidebar-popo-robot {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  margin: 4px 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}
.desktop-sidebar-popo-robot:hover {
  background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
}
.popo-robot-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
  padding: 16px;
}
.popo-config-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 12px;
}
.popo-chats-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  flex: 1;
  min-height: 0;
}
.popo-chat-list ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.popo-chat-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
}
.popo-chat-item.active {
  background: var(--vscode-list-activeSelectionBackground);
}
.popo-chat-title { font-weight: 600; display: block; }
.popo-chat-last {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
}
.popo-message { margin-bottom: 8px; }
.popo-message-role { font-size: 12px; opacity: 0.6; }
.popo-message-content { margin: 2px 0 0; white-space: pre-wrap; }
.popo-ready { color: #4caf50; }
.popo-degraded { color: #e53935; }
.popo-error { color: #e53935; }
.popo-empty { opacity: 0.6; }
```

- [ ] **Step 6: 运行确认通过**

Run: `pnpm -F @muse-work/webview test -- DesktopSidebar`
Expected: 2 个新用例 PASS，原有用例不回归

Run: `pnpm -F @muse-work/webview test`
Expected: 全部 PASS（排除 3 个既有 tsc 错误，可用 `pnpm -F @muse-work/webview exec vitest run --reporter=dot` 观察）

- [ ] **Step 7: Commit**

```bash
git add packages/webview/src/components/desktop/DesktopSidebar.tsx packages/webview/src/components/ChatApp.tsx packages/webview/src/components/desktop/DesktopSidebar.test.tsx <样式文件>
git commit -m "feat(webview): add POPO robot entry in sidebar and wire robot view"
```

---

## 收尾验证

实现完成后（全部 11 个任务）运行：

1. `pnpm -F @muse-work/server test` — 除已知 3 个 pre-existing 失败外全绿
2. `pnpm -F @muse-work/server type-check` — PASS
3. `pnpm -F @muse-work/webview test` — 全绿（或仅既有 3 个 tsc 问题）
4. 手动冒烟：`pnpm -F @muse-work/server dev`，curl `http://127.0.0.1:<port>/popo/config` 应返回配置与 `ready` 状态；无 `~/.popo-config.json` 时返回 `ready:false` 且主功能正常
5. 平台配置推送后抓真实回调，校准 `crypt.ts`（spec §10 风险项 1/2）



