# 内置 Superpowers 插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server 内置 Superpowers 插件（默认开），Skill 工具可用；设置「插件」页可全局关闭。

**Architecture:** Superpowers 以 Wave 本地插件目录随 server 打包。`sessionRunner` 读 `~/.muse-work/settings.json`，开启且目录存在时把 `AgentOptions.plugins` 传给 SDK。设置 Dialog 立即 PATCH `/settings`，并 `invalidateAgentIdentities()`，下一轮按新开关重建 Agent。

**Tech Stack:** TypeScript、Node http、wave-agent-sdk 1.0.7、React 18、Vitest、Testing Library

**Spec:** `docs/superpowers/specs/2026-08-13-builtin-superpowers-plugin-design.md`

## Global Constraints

- 开关用户全局：`~/.muse-work/settings.json`；缺文件/缺字段/损坏 → `plugins.superpowers === true`
- 显式 `false` 才关闭
- 加载：`AgentOptions.plugins: [{ type: "local", path }]`；不改 SDK `builtin/plugins`；不启用 `sdd@builtin`
- Superpowers 内容固定 **v6.3.0**，vendor 进仓库，构建不联网
- SessionStart 用 Wave Node hook，注入 `using-superpowers` 全文；hook 失败不阻断会话
- 本轮不做：插件市场、按项目覆盖、斜杠菜单列出 skill、SDD 开关
- 包管理器：pnpm；测试：Vitest
- webview 新测试放 `packages/webview/tests/components/**` 或 `tests/muse/**` 或 `tests/apiClient.test.ts`（**不含** `tests/webview/*`）

## File Structure

```text
packages/server/src/museSettings.ts
  # 读/写 settings.json；解析内置插件目录
packages/server/tests/museSettings.test.ts
packages/server/src/routes/settings.ts
packages/server/tests/settings.routes.test.ts
packages/server/src/app.ts
  # GET/PATCH /settings
packages/server/plugins/superpowers/
  # .muse-plugin / skills / hooks / scripts / LICENSE / SOURCE.txt
packages/server/package.json
  # files: ["dist", "plugins"]
packages/desktop/scripts/prepareServer.mjs
  # deploy 后若缺 plugins 则 cpSync
packages/server/src/sessionRunner.ts
packages/server/src/createAppContext.ts
  # 把 home 传给 runner
packages/server/tests/sessionRunner.test.ts
packages/server/tests/sessionRunner.lifecycle.test.ts
packages/webview/src/muse/apiClient.ts
packages/webview/tests/apiClient.test.ts
packages/webview/src/components/PluginSettings.tsx
packages/webview/tests/components/pluginSettings.test.tsx
packages/webview/src/components/ConfigDialog.tsx
packages/webview/tests/components/configDialog.appearance.test.tsx
```

---

### Task 1: `museSettings` 读写与默认开启

**Files:**
- Create: `packages/server/src/museSettings.ts`
- Create: `packages/server/tests/museSettings.test.ts`

**Interfaces:**
- Consumes: `getMuseHomeDir` from `@muse-work/provider`
- Produces:
  - `export type MuseSettings = { version: 1; plugins: { superpowers: boolean } }`
  - `export function getSettingsPath(home?: string): string`
  - `export function loadMuseSettings(home?: string): MuseSettings`
  - `export function saveMuseSettings(settings: MuseSettings, home?: string): void`
  - `export function patchMuseSettings(patch: { plugins: { superpowers: boolean } }, home?: string): MuseSettings`
  - `export function resolveSuperpowersPluginDir(): string`
  - `export function superpowersPluginDirIfPresent(): string | undefined`

- [ ] **Step 1: 写失败测试**

创建 `packages/server/tests/museSettings.test.ts`：

```ts
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getSettingsPath,
  loadMuseSettings,
  patchMuseSettings,
  resolveSuperpowersPluginDir,
  saveMuseSettings,
  superpowersPluginDirIfPresent,
} from "../src/museSettings.js";

describe("museSettings", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("defaults superpowers on when the file is missing", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-settings-"));
    homes.push(home);
    expect(loadMuseSettings(home)).toEqual({
      version: 1,
      plugins: { superpowers: true },
    });
    expect(fs.existsSync(getSettingsPath(home))).toBe(false);
  });

  it("defaults superpowers on when JSON is corrupt", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-settings-"));
    homes.push(home);
    const file = getSettingsPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not-json");
    expect(loadMuseSettings(home).plugins.superpowers).toBe(true);
  });

  it("honors explicit false and round-trips via patch", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-settings-"));
    homes.push(home);
    saveMuseSettings(
      { version: 1, plugins: { superpowers: false } },
      home,
    );
    expect(loadMuseSettings(home).plugins.superpowers).toBe(false);
    const next = patchMuseSettings(
      { plugins: { superpowers: true } },
      home,
    );
    expect(next.plugins.superpowers).toBe(true);
    expect(loadMuseSettings(home).plugins.superpowers).toBe(true);
  });

  it("resolves plugin dir next to src/dist", () => {
    const dir = resolveSuperpowersPluginDir();
    expect(dir.endsWith(`${path.sep}plugins${path.sep}superpowers`)).toBe(
      true,
    );
    const present = superpowersPluginDirIfPresent();
    if (fs.existsSync(path.join(dir, ".muse-plugin", "plugin.json"))) {
      expect(present).toBe(dir);
    } else {
      expect(present).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/server test tests/museSettings.test.ts`

Expected: FAIL，`museSettings.js` 无法解析。

- [ ] **Step 3: 最小实现**

创建 `packages/server/src/museSettings.ts`：

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMuseHomeDir } from "@muse-work/provider";
import { getLogger } from "./logger.js";

export type MuseSettings = {
  version: 1;
  plugins: { superpowers: boolean };
};

const DEFAULT_SETTINGS: MuseSettings = {
  version: 1,
  plugins: { superpowers: true },
};

export function getSettingsPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "settings.json");
}

function isSettings(value: unknown): value is MuseSettings {
  if (!value || typeof value !== "object") return false;
  const plugins = (value as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== "object") return false;
  const superpowers = (plugins as { superpowers?: unknown }).superpowers;
  return superpowers === undefined || typeof superpowers === "boolean";
}

export function loadMuseSettings(home = os.homedir()): MuseSettings {
  const file = getSettingsPath(home);
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!isSettings(raw)) {
      getLogger().warn("settings.json invalid, using defaults", { file });
      return { ...DEFAULT_SETTINGS, plugins: { ...DEFAULT_SETTINGS.plugins } };
    }
    return {
      version: 1,
      plugins: {
        superpowers: raw.plugins.superpowers ?? true,
      },
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      getLogger().warn("settings.json unreadable, using defaults", {
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { ...DEFAULT_SETTINGS, plugins: { ...DEFAULT_SETTINGS.plugins } };
  }
}

export function saveMuseSettings(
  settings: MuseSettings,
  home = os.homedir(),
): void {
  const file = getSettingsPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function patchMuseSettings(
  patch: { plugins: { superpowers: boolean } },
  home = os.homedir(),
): MuseSettings {
  const current = loadMuseSettings(home);
  const next: MuseSettings = {
    version: 1,
    plugins: {
      ...current.plugins,
      superpowers: patch.plugins.superpowers,
    },
  };
  saveMuseSettings(next, home);
  return next;
}

/** `packages/server/src/*.ts` 与 `dist/*.js` 的 `../plugins/superpowers`。 */
export function resolveSuperpowersPluginDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "plugins",
    "superpowers",
  );
}

export function superpowersPluginDirIfPresent(): string | undefined {
  const dir = resolveSuperpowersPluginDir();
  const manifest = path.join(dir, ".muse-plugin", "plugin.json");
  if (!fs.existsSync(manifest)) {
    getLogger().error("superpowers plugin directory missing", { dir });
    return undefined;
  }
  return dir;
}
```

此任务里 `superpowersPluginDirIfPresent` 在目录尚未 vendor 时会打 error 并返回 `undefined`；测试按「有/无 manifest」分支断言，允许 FAIL 前目录不存在。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @muse-work/server test tests/museSettings.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/museSettings.ts packages/server/tests/museSettings.test.ts
git commit -m "$(cat <<'EOF'
feat(server): persist global Muse settings with Superpowers default-on

EOF
)"
```

---

### Task 2: `GET/PATCH /settings`

**Files:**
- Create: `packages/server/src/routes/settings.ts`
- Create: `packages/server/tests/settings.routes.test.ts`
- Modify: `packages/server/src/app.ts`

**Interfaces:**
- Consumes: `loadMuseSettings`, `patchMuseSettings`, `AppContext.home`, `AppContext.runner.invalidateAgentIdentities`
- Produces:
  - `GET /settings` → `MuseSettings`（已套默认）
  - `PATCH /settings` body `{ plugins: { superpowers: boolean } }`；缺字段或非 boolean → 400；成功写盘、invalidate、返回 `MuseSettings`

- [ ] **Step 1: 写失败测试**

创建 `packages/server/tests/settings.routes.test.ts`：

```ts
import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/app.js";
import { closeTestApp, listenTestApp } from "./helpers.js";
import { getSettingsPath } from "../src/museSettings.js";

describe("settings routes", () => {
  let server: Server | undefined;
  let home: string | undefined;

  afterEach(async () => {
    if (server) {
      await closeTestApp(server, home);
      server = undefined;
      home = undefined;
    }
  });

  it("GET /settings defaults superpowers on", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const res = await fetch(`${app.baseUrl}/settings`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: 1,
      plugins: { superpowers: true },
    });
  });

  it("PATCH /settings writes false and invalidates agent identities", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    let invalidated = false;
    const original = app.ctx.runner.invalidateAgentIdentities.bind(
      app.ctx.runner,
    );
    app.ctx.runner.invalidateAgentIdentities = () => {
      invalidated = true;
      original();
    };

    const res = await fetch(`${app.baseUrl}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plugins: { superpowers: false } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: 1,
      plugins: { superpowers: false },
    });
    expect(invalidated).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(getSettingsPath(app.home), "utf8")).plugins
        .superpowers,
    ).toBe(false);

    const again = await fetch(`${app.baseUrl}/settings`);
    expect(await again.json()).toEqual({
      version: 1,
      plugins: { superpowers: false },
    });
  });

  it("PATCH /settings rejects missing or non-boolean superpowers", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;

    const missing = await fetch(`${app.baseUrl}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const bad = await fetch(`${app.baseUrl}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plugins: { superpowers: "no" } }),
    });
    expect(bad.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/server test tests/settings.routes.test.ts`

Expected: FAIL，`GET /settings` 为 404。

- [ ] **Step 3: 最小实现**

创建 `packages/server/src/routes/settings.ts`：

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "../createAppContext.js";
import { readJsonBody, sendError, sendJson } from "../http.js";
import { loadMuseSettings, patchMuseSettings } from "../museSettings.js";

export async function handleGetSettings(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  sendJson(res, 200, loadMuseSettings(ctx.home));
}

export async function handlePatchSettings(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const body = (await readJsonBody(req)) as
    | { plugins?: { superpowers?: unknown } }
    | undefined;
  const superpowers = body?.plugins?.superpowers;
  if (typeof superpowers !== "boolean") {
    sendError(res, 400, "plugins.superpowers is required and must be boolean");
    return;
  }
  const settings = patchMuseSettings(
    { plugins: { superpowers } },
    ctx.home,
  );
  ctx.runner.invalidateAgentIdentities();
  sendJson(res, 200, settings);
}
```

在 `packages/server/src/app.ts` 顶部增加 import：

```ts
import {
  handleGetSettings,
  handlePatchSettings,
} from "./routes/settings.js";
```

在 `routeRequest` 里、`/health` 分支之后插入：

```ts
  if (method === "GET" && pathname === "/settings") {
    await handleGetSettings(req, res, ctx);
    return;
  }

  if (method === "PATCH" && pathname === "/settings") {
    await handlePatchSettings(req, res, ctx);
    return;
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @muse-work/server test tests/settings.routes.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/settings.ts packages/server/src/app.ts packages/server/tests/settings.routes.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add GET/PATCH /settings for Superpowers toggle

EOF
)"
```

---

### Task 3: Vendor Superpowers v6.3.0 为 Wave 插件

**Files:**
- Create: `packages/server/plugins/superpowers/.muse-plugin/plugin.json`
- Create: `packages/server/plugins/superpowers/hooks/hooks.json`
- Create: `packages/server/plugins/superpowers/scripts/session-start.js`
- Create: `packages/server/plugins/superpowers/SOURCE.txt`
- Create: `packages/server/plugins/superpowers/LICENSE`（从上游拷贝）
- Create: `packages/server/plugins/superpowers/skills/**`（从上游拷贝）
- Create: `packages/server/tests/superpowersPlugin.test.ts`
- Modify: `packages/server/package.json`（加 `files`）
- Modify: `packages/desktop/scripts/prepareServer.mjs`

**Interfaces:**
- Consumes: 无
- Produces: 磁盘上可用的 Wave 插件；`node scripts/session-start.js` 在 `WAVE_PLUGIN_ROOT` 下打印 `{ hookSpecificOutput: { additionalContext } }`；`package.json` `files` 含 `dist` 与 `plugins`

- [ ] **Step 1: 写失败测试**

创建 `packages/server/tests/superpowersPlugin.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveSuperpowersPluginDir } from "../src/museSettings.js";

const pluginDir = resolveSuperpowersPluginDir();

describe("superpowers builtin plugin", () => {
  it("has Wave manifest, LICENSE, and using-superpowers skill", () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(pluginDir, ".muse-plugin", "plugin.json"),
        "utf8",
      ),
    ) as { name: string; version: string };
    expect(manifest.name).toBe("superpowers");
    expect(manifest.version).toBe("6.3.0");
    expect(fs.existsSync(path.join(pluginDir, "LICENSE"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(pluginDir, "skills", "using-superpowers", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("session-start hook injects using-superpowers as additionalContext", () => {
    const script = path.join(pluginDir, "scripts", "session-start.js");
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, WAVE_PLUGIN_ROOT: pluginDir },
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "You have superpowers",
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "using-superpowers",
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/server test tests/superpowersPlugin.test.ts`

Expected: FAIL，读不到 `plugin.json`。

- [ ] **Step 3: Vendor + Wave 包装**

在仓库根执行（只需这一次；构建不再 clone）：

```bash
TMP=$(mktemp -d)
git clone --depth 1 --branch v6.3.0 https://github.com/obra/superpowers.git "$TMP/superpowers"
mkdir -p packages/server/plugins/superpowers
cp -R "$TMP/superpowers/skills" packages/server/plugins/superpowers/
cp "$TMP/superpowers/LICENSE" packages/server/plugins/superpowers/LICENSE
printf '%s\n' 'obra/superpowers v6.3.0' 'https://github.com/obra/superpowers/releases/tag/v6.3.0' > packages/server/plugins/superpowers/SOURCE.txt
rm -rf "$TMP"
```

创建 `packages/server/plugins/superpowers/.muse-plugin/plugin.json`：

```json
{
  "name": "superpowers",
  "description": "Core skills library: TDD, debugging, collaboration patterns, and proven techniques",
  "version": "6.3.0",
  "author": {
    "name": "Jesse Vincent"
  }
}
```

创建 `packages/server/plugins/superpowers/hooks/hooks.json`：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${WAVE_PLUGIN_ROOT}/scripts/session-start.js\""
          }
        ]
      }
    ]
  }
}
```

创建 `packages/server/plugins/superpowers/scripts/session-start.js`：

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root =
  process.env.WAVE_PLUGIN_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let skill = "";
try {
  skill = fs.readFileSync(
    path.join(root, "skills", "using-superpowers", "SKILL.md"),
    "utf8",
  );
} catch {
  skill = "";
}

const additionalContext = skill
  ? `<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**Below is the full content of your 'superpowers:using-superpowers' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${skill}\n</EXTREMELY_IMPORTANT>`
  : "";

process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { additionalContext } }),
);
```

在 `packages/server/package.json` 的 `"private": true` 后增加：

```json
  "files": [
    "dist",
    "plugins"
  ],
```

在 `packages/desktop/scripts/prepareServer.mjs` 里，`console.log("[prepareServer] ready at", out);` **之前**插入：

```js
const pluginsSrc = path.join(workspaceRoot, "packages/server/plugins");
const pluginsDest = path.join(out, "plugins");
if (fs.existsSync(pluginsSrc) && !fs.existsSync(pluginsDest)) {
  fs.cpSync(pluginsSrc, pluginsDest, { recursive: true });
  console.log("[prepareServer] copied plugins to", pluginsDest);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @muse-work/server test tests/superpowersPlugin.test.ts tests/museSettings.test.ts`

Expected: PASS。`superpowersPluginDirIfPresent()` 现在应返回目录路径。

- [ ] **Step 5: Commit**

```bash
git add packages/server/plugins/superpowers packages/server/package.json packages/desktop/scripts/prepareServer.mjs packages/server/tests/superpowersPlugin.test.ts
git commit -m "$(cat <<'EOF'
feat(server): vendor Superpowers v6.3.0 as a Wave local plugin

EOF
)"
```

---

### Task 4: `sessionRunner` 按开关注入插件

**Files:**
- Modify: `packages/server/src/sessionRunner.ts`
- Modify: `packages/server/src/createAppContext.ts`
- Modify: `packages/server/tests/sessionRunner.test.ts`
- Modify: `packages/server/tests/sessionRunner.lifecycle.test.ts`

**Interfaces:**
- Consumes: `loadMuseSettings(home)`, `superpowersPluginDirIfPresent()`
- Produces:
  - `CreateSessionRunnerOptions.home: string`（必填）
  - `createAgent` 在 `superpowers === true` 且目录存在时收到 `plugins: [{ type: "local", path }]`
  - 否则选项**没有** `plugins` 键
  - 身份指纹追加 `superpowers:on` 或 `superpowers:off`（关、或目录缺失 → `off`）

- [ ] **Step 1: 写失败测试**

在 `packages/server/tests/sessionRunner.test.ts` 末尾 `describe` 内追加（该文件已有 temp `home` + stub provider 模式）。先增加 import：

```ts
import { saveMuseSettings } from "../src/museSettings.js";
```

每个已有的 `createSessionRunner({` 都加上 `home`（变量已在测试里）。`sessionRunner.lifecycle.test.ts` 的 `setup()` 已返回 `home`，每个 `createSessionRunner({` 同样加 `home`。

然后加新用例：

```ts
  it("passes local superpowers plugin when enabled", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-sp-on-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );
    saveMuseSettings({ version: 1, plugins: { superpowers: true } }, home);

    let seenPlugins: unknown;
    const provider: AiProvider = {
      id: "openai-compatible",
      displayName: "OpenAI Compatible",
      async getAuthStatus(): Promise<AuthStatus> {
        return {
          state: "authenticated",
          providerId: "openai-compatible",
          user: "t",
        };
      },
      async beginLogin() {
        return { reused: true };
      },
      async completeLogin() {
        return { state: "authenticated", providerId: "openai-compatible" };
      },
      async logout() {},
      async listModels(): Promise<ModelInfo[]> {
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async (options) => {
        seenPlugins = options.plugins;
        return {
          sendMessage: async () => {},
          dispose: async () => {},
        };
      },
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });
    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => seenPlugins !== undefined).toBe(true);
    expect(seenPlugins).toEqual([
      {
        type: "local",
        path: expect.stringMatching(/plugins[\\/]superpowers$/),
      },
    ]);
  });

  it("omits plugins when superpowers is disabled and recreates on toggle", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-runner-sp-off-"));
    saveProvidersConfig(
      {
        ...loadProvidersConfig(home),
        activeProviderId: "openai-compatible",
        activeModelId: "gpt-4.1",
      },
      home,
    );
    saveMuseSettings({ version: 1, plugins: { superpowers: true } }, home);

    const pluginSnapshots: unknown[] = [];
    let disposeCount = 0;
    const provider: AiProvider = {
      id: "openai-compatible",
      displayName: "OpenAI Compatible",
      async getAuthStatus(): Promise<AuthStatus> {
        return {
          state: "authenticated",
          providerId: "openai-compatible",
          user: "t",
        };
      },
      async beginLogin() {
        return { reused: true };
      },
      async completeLogin() {
        return { state: "authenticated", providerId: "openai-compatible" };
      },
      async logout() {},
      async listModels(): Promise<ModelInfo[]> {
        return [{ id: "gpt-4.1", label: "GPT-4.1" }];
      },
      async resolveGateway(modelId: string) {
        return {
          baseURL: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: modelId,
        };
      },
    };

    const store = createSessionStore({ home });
    const hub = createWsHub();
    const registry = createProviderRegistry([provider], home);
    const runner = createSessionRunner({
      store,
      hub,
      registry,
      home,
      createAgent: async (options) => {
        pluginSnapshots.push(options.plugins);
        return {
          sendMessage: async () => {},
          dispose: async () => {
            disposeCount += 1;
          },
        };
      },
    });

    const session = store.create({ workdir: home, model: "gpt-4.1" });
    await runner.sendMessage(session.id, "hello");
    await expect.poll(() => pluginSnapshots.length).toBe(1);
    await expect.poll(() => store.get(session.id)?.status).toBe("idle");
    expect(pluginSnapshots[0]).toBeDefined();

    saveMuseSettings({ version: 1, plugins: { superpowers: false } }, home);
    runner.invalidateAgentIdentities();
    await runner.sendMessage(session.id, "again");
    await expect.poll(() => pluginSnapshots.length).toBe(2);
    expect(pluginSnapshots[1]).toBeUndefined();
    expect(disposeCount).toBe(1);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/server test tests/sessionRunner.test.ts`

Expected: FAIL（缺 `home` 类型和/或 `plugins` 未传入）。先把所有 `createSessionRunner` 补上 `home` 后，新用例应因未注入 `plugins` 失败。

- [ ] **Step 3: 最小实现**

`CreateSessionRunnerOptions` 增加必填 `home`：

```ts
export interface CreateSessionRunnerOptions {
  store: SessionStore;
  hub: WsHub;
  registry: ProviderRegistry;
  home: string;
  createAgent?: CreateAgent;
  idleTtlMs?: number;
}
```

`createSessionRunner` 内：

```ts
  const { store, hub, registry, home } = options;
```

在 `gatewayIdentity` 旁增加：

```ts
  function superpowersFlag(): "superpowers:on" | "superpowers:off" {
    const enabled = loadMuseSettings(home).plugins.superpowers;
    const dir = superpowersPluginDirIfPresent();
    return enabled && dir ? "superpowers:on" : "superpowers:off";
  }
```

`gatewayIdentity` 的 `return` 数组追加 `superpowersFlag()`：

```ts
  function gatewayIdentity(gateway: GatewayResolution): string {
    const credential =
      gateway.credentialFingerprint ?? gateway.apiKey ?? "";
    return [
      gateway.baseURL,
      gateway.model,
      credential,
      gateway.fastModel ?? "",
      MUSE_IDENTITY_REV,
      superpowersFlag(),
    ].join("\0");
  }
```

`createAgentWithRestore` 里 `createAgent({` 在 `restoreSessionId,` 之后加入：

```ts
      ...(superpowersFlag() === "superpowers:on"
        ? {
            plugins: [
              {
                type: "local" as const,
                path: superpowersPluginDirIfPresent() as string,
              },
            ],
          }
        : {}),
```

文件顶部 import：

```ts
import {
  loadMuseSettings,
  superpowersPluginDirIfPresent,
} from "./museSettings.js";
```

`packages/server/src/createAppContext.ts` 的 `createSessionRunner({` 增加 `home: options.home`。

`packages/server/tests/sessionRunner.test.ts`：每一个 `createSessionRunner({` 都加 `home`（该变量已是 temp dir）。

`packages/server/tests/sessionRunner.lifecycle.test.ts`：把 `const { store, hub, registry } = setup();` 改成 `const { store, hub, registry, home } = setup();`，并在每一个 `createSessionRunner({` 里加 `home`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @muse-work/server test tests/sessionRunner.test.ts tests/sessionRunner.lifecycle.test.ts tests/settings.routes.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sessionRunner.ts packages/server/src/createAppContext.ts packages/server/tests/sessionRunner.test.ts packages/server/tests/sessionRunner.lifecycle.test.ts
git commit -m "$(cat <<'EOF'
feat(server): load Superpowers plugin on Agent.create when enabled

EOF
)"
```

---

### Task 5: 设置 Dialog「插件」tab

**Files:**
- Modify: `packages/webview/src/muse/apiClient.ts`
- Modify: `packages/webview/tests/apiClient.test.ts`
- Create: `packages/webview/src/components/PluginSettings.tsx`
- Create: `packages/webview/tests/components/pluginSettings.test.tsx`
- Modify: `packages/webview/src/components/ConfigDialog.tsx`
- Modify: `packages/webview/tests/components/configDialog.appearance.test.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /settings`
- Produces:
  - `MuseApiClient.getSettings(): Promise<MuseSettings>`
  - `MuseApiClient.updateSettings(patch: { plugins: { superpowers: boolean } }): Promise<MuseSettings>`
  - `export type MuseSettings = { version: 1; plugins: { superpowers: boolean } }`
  - ConfigDialog tab 顺序：外观 → 插件 → 供应商
  - `data-testid="superpowers-toggle"`；GET true 时 checked；点击 PATCH `{ plugins: { superpowers: false } }`；失败回滚并显示错误
  - 不计入供应商 dirty

- [ ] **Step 1: 写失败测试**

在 `packages/webview/tests/apiClient.test.ts` 追加：

```ts
  it("getSettings GETs /settings and updateSettings PATCHes it", async () => {
    const fetches: Array<{ method: string; url: string; body?: string }> = [];
    const client = new MuseApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetch: async (url, init) => {
        fetches.push({
          method: init?.method ?? "GET",
          url,
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return new Response(
          JSON.stringify({ version: 1, plugins: { superpowers: false } }),
          { status: 200 },
        );
      },
    });
    await client.getSettings();
    expect(fetches[0]).toEqual({
      method: "GET",
      url: "http://127.0.0.1:9/settings",
      body: undefined,
    });
    await client.updateSettings({ plugins: { superpowers: false } });
    expect(fetches[1]?.method).toBe("PATCH");
    expect(fetches[1]?.url).toBe("http://127.0.0.1:9/settings");
    expect(JSON.parse(fetches[1]?.body ?? "{}")).toEqual({
      plugins: { superpowers: false },
    });
  });
```

创建 `packages/webview/tests/components/pluginSettings.test.tsx`：

```tsx
/** @vitest-environment jsdom */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PluginSettings } from "../../src/components/PluginSettings";
import { MuseTheme } from "../../src/ui/theme";
import type { MuseApiClient } from "../../src/muse/apiClient";

function mockClient(opts: {
  get?: { version: 1; plugins: { superpowers: boolean } };
  updateError?: string;
}): MuseApiClient {
  return {
    getSettings: vi.fn(async () => {
      return opts.get ?? { version: 1, plugins: { superpowers: true } };
    }),
    updateSettings: vi.fn(async (patch: { plugins: { superpowers: boolean } }) => {
      if (opts.updateError) throw new Error(opts.updateError);
      return { version: 1 as const, plugins: patch.plugins };
    }),
  } as unknown as MuseApiClient;
}

describe("PluginSettings", () => {
  beforeEach(() => {
    cleanup();
  });

  it("checks the Superpowers toggle by default", async () => {
    render(
      <MuseTheme>
        <PluginSettings api={mockClient({})} />
      </MuseTheme>,
    );
    const toggle = await screen.findByTestId("superpowers-toggle");
    expect(toggle).toBeChecked();
  });

  it("PATCHes superpowers false when clicked", async () => {
    const api = mockClient({});
    render(
      <MuseTheme>
        <PluginSettings api={api} />
      </MuseTheme>,
    );
    const toggle = await screen.findByTestId("superpowers-toggle");
    fireEvent.click(toggle);
    await vi.waitFor(() => {
      expect(api.updateSettings).toHaveBeenCalledWith({
        plugins: { superpowers: false },
      });
    });
  });

  it("rolls back and shows an error when PATCH fails", async () => {
    const api = mockClient({ updateError: "network down" });
    render(
      <MuseTheme>
        <PluginSettings api={api} />
      </MuseTheme>,
    );
    const toggle = await screen.findByTestId("superpowers-toggle");
    fireEvent.click(toggle);
    await vi.waitFor(() => {
      expect(screen.getByText(/network down/i)).toBeTruthy();
    });
    expect(toggle).toBeChecked();
  });
});
```

在 `packages/webview/tests/components/configDialog.appearance.test.tsx` 的 `vi.mock` 块后增加：

```ts
vi.mock("../../src/components/PluginSettings", () => ({
  PluginSettings: () => <div data-testid="plugin-settings">plugin settings</div>,
}));
```

该文件需 `import React from "react"`（已有）。把「shows appearance first…」用例改成也断言「插件」tab：

```ts
  it("shows appearance first and provider after selecting its tab", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "外观" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "插件" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "插件" }));
    expect(screen.getByTestId("plugin-settings")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "供应商" }));

    expect(screen.getByTestId("muse-provider-settings")).toBeTruthy();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/webview test tests/apiClient.test.ts tests/components/pluginSettings.test.tsx tests/components/configDialog.appearance.test.tsx`

Expected: FAIL（无 `getSettings` / 无「插件」tab / 无 `PluginSettings`）。

- [ ] **Step 3: 最小实现**

在 `packages/webview/src/muse/apiClient.ts` 的 `MuseOpenAiCompatibleConfigPatch` 后增加：

```ts
export interface MuseSettings {
  version: 1;
  plugins: { superpowers: boolean };
}
```

在 `MuseApiClient` 类里 `getHealth` 附近增加：

```ts
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
```

创建 `packages/webview/src/components/PluginSettings.tsx`：

```tsx
import React, { useEffect, useMemo, useState } from "react";
import { Text } from "@radix-ui/themes";
import {
  MuseApiClient,
  type MuseSettings,
} from "../muse/apiClient";
import { resolveMuseServerUrl } from "../muse/hostBridge";
import { Field } from "../ui/Field";

export function PluginSettings(props: { api?: MuseApiClient }) {
  const client = useMemo(
    () =>
      props.api ??
      new MuseApiClient({
        baseUrl: resolveMuseServerUrl(),
      }),
    [props.api],
  );
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void client.getSettings().then(
      (settings: MuseSettings) => {
        if (cancelled) return;
        setEnabled(settings.plugins.superpowers);
        setError(null);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  const onToggle = async (next: boolean) => {
    const prev = enabled;
    setEnabled(next);
    setError(null);
    setPending(true);
    try {
      const settings = await client.updateSettings({
        plugins: { superpowers: next },
      });
      setEnabled(settings.plugins.superpowers);
    } catch (err) {
      setEnabled(prev);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div data-testid="plugin-settings">
      <Field
        label="Superpowers"
        hint="内置技能库（TDD、调试、协作流程）。关闭后新的对话轮次不再加载这些 skill。"
        error={error}
      >
        <div className="config-project-row">
          <span className="config-project-title">启用插件</span>
          <label className="switch">
            <input
              type="checkbox"
              data-testid="superpowers-toggle"
              checked={enabled}
              disabled={pending}
              onChange={(event) => {
                void onToggle(event.target.checked);
              }}
            />
            <span className="slider round" />
          </label>
        </div>
      </Field>
    </div>
  );
}
```

`ConfigDialog.tsx`：

1. import `PluginSettings`。
2. `activeTab` 类型改为 `"appearance" | "plugins" | "provider"`。
3. 在「外观」和「供应商」tab 按钮之间插入「插件」tab（`aria-controls="config-plugins-panel"`，文案 `插件`），结构与另外两个 tab 相同。
4. 在 appearance panel 与 provider panel 之间插入：

```tsx
            <div
              id="config-plugins-panel"
              role="tabpanel"
              hidden={activeTab !== "plugins"}
            >
              <PluginSettings />
            </div>
```

5. 更新文件头注释：settings overlay hosts appearance, plugins, and provider。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @muse-work/webview test tests/apiClient.test.ts tests/components/pluginSettings.test.tsx tests/components/configDialog.appearance.test.tsx`

Expected: PASS

再跑：

Run: `pnpm -F @muse-work/server test && pnpm -F @muse-work/webview test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/muse/apiClient.ts packages/webview/tests/apiClient.test.ts packages/webview/src/components/PluginSettings.tsx packages/webview/tests/components/pluginSettings.test.tsx packages/webview/src/components/ConfigDialog.tsx packages/webview/tests/components/configDialog.appearance.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): add Superpowers toggle in settings

EOF
)"
```

---

## Spec coverage

| Spec 节 | Task |
|---|---|
| Vendor skills + LICENSE + Wave 清单 + SessionStart | 3 |
| `museSettings` 默认开 / 损坏回退 | 1 |
| `GET/PATCH /settings` + invalidate | 2 |
| Agent.create `plugins` + 指纹 + 目录缺失当关 | 4 |
| ConfigDialog「插件」tab、立即 PATCH、失败回滚 | 5 |
| `files` + prepareServer 兜底拷贝 | 3 |
| 不做市场 / SDD / 斜杠菜单 | 无任务（刻意） |
