# 按 workdir 共享技能目录与 Live 配置 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一进程内按 `path.resolve(workdir)` 共享技能磁盘快照与 settings 合并结果，各 `SkillManager` / `LiveConfigManager` 订阅后在本会话容器内应用，消除同 workdir 多 Agent 的重复 chokidar 与重复全量扫描。

**Architecture:** `SharedSkillCatalog` 与 `SharedLiveConfig` 为进程级 `Map<workdirKey, Entry>`，引用计数 + singleflight 初始加载；会话侧 manager 仅持有订阅句柄与会话状态（插件技能、回合快照）。共享层不写任何 `ConfigurationService.setEnvironmentVars`。

**Tech Stack:** TypeScript, Node ≥20, chokidar（经现有 `FileWatcherService`），vitest。

**Spec:** [`2026-09-30-shared-catalog-liveconfig-design.md`](./2026-09-30-shared-catalog-liveconfig-design.md)

## Global Constraints

- 行为 A：回合快照 per `LiveConfigManager`；权限/hook/env 在 reload 后立即 apply；插件技能不进入共享快照。
- 子 agent 不额外 acquire；沿用父容器 manager。
- `watchSkills: false` → 不注册文件监听；仍执行一次磁盘发现（与现 `watch: false` 一致）。
- 共享层禁止调用会话 `ConfigurationService.setEnvironmentVars`。
- MCP、server `GET /skills` 不在本计划范围。
- 每个涉及全局注册表的测试文件 `afterEach` 调用 `resetSharedCatalogsForTests()`。

## File map

| 操作 | 路径 |
|------|------|
| Create | `packages/agent/src/shared/pathKey.ts` |
| Create | `packages/agent/src/shared/testing.ts` |
| Create | `packages/agent/src/shared/diskSkillDiscovery.ts` |
| Create | `packages/agent/src/shared/sharedSkillCatalog.ts` |
| Create | `packages/agent/src/shared/sharedLiveConfig.ts` |
| Create | `packages/agent/tests/shared/sharedSkillCatalog.test.ts` |
| Create | `packages/agent/tests/shared/sharedLiveConfig.test.ts` |
| Create | `packages/agent/tests/managers/skillManager.sharedCatalog.test.ts` |
| Modify | `packages/agent/src/managers/skillManager.ts` |
| Modify | `packages/agent/src/managers/liveConfigManager.ts` |
| Modify | `packages/agent/tests/managers/skillManager.test.ts` |
| Modify | `packages/agent/tests/managers/liveConfigManager*.test.ts`（仅 mock/断言调整） |

---

### Task 1: `pathKey` 与测试 reset 钩子

**Files:**
- Create: `packages/agent/src/shared/pathKey.ts`
- Create: `packages/agent/src/shared/testing.ts`
- Test: `packages/agent/tests/shared/pathKey.test.ts`

**Interfaces:**
- Produces: `resolveWorkdirKey(workdir: string): string`
- Produces: `resetSharedCatalogsForTests(): Promise<void>`（Task 2–3 实现体后在此聚合调用）

- [ ] **Step 1: 写失败测试**

```typescript
// packages/agent/tests/shared/pathKey.test.ts
import { describe, it, expect } from "vitest";
import path from "path";
import { resolveWorkdirKey } from "../../src/shared/pathKey.js";

describe("resolveWorkdirKey", () => {
  it("resolves relative workdir to absolute", () => {
    const key = resolveWorkdirKey("./foo");
    expect(key).toBe(path.resolve("./foo"));
  });
});
```

- [ ] **Step 2: 运行** `pnpm exec vitest run tests/shared/pathKey.test.ts -v` → FAIL

- [ ] **Step 3: 实现**

```typescript
// packages/agent/src/shared/pathKey.ts
import path from "path";

export function resolveWorkdirKey(workdir: string): string {
  return path.resolve(workdir);
}
```

```typescript
// packages/agent/src/shared/testing.ts
export async function resetSharedCatalogsForTests(): Promise<void> {
  const { resetSharedSkillCatalogForTests } = await import(
    "./sharedSkillCatalog.js"
  );
  const { resetSharedLiveConfigForTests } = await import(
    "./sharedLiveConfig.js"
  );
  await resetSharedSkillCatalogForTests();
  await resetSharedLiveConfigForTests();
}
```

（Task 2/3 完成后在对应模块导出 `resetSharedSkillCatalogForTests` / `resetSharedLiveConfigForTests`。）

- [ ] **Step 4: 再跑 pathKey 测试** → PASS

- [ ] **Step 5: Commit** `feat(agent): add workdir key helper for shared catalogs`

---

### Task 2: 抽取磁盘技能发现（无 watcher）

**Files:**
- Create: `packages/agent/src/shared/diskSkillDiscovery.ts`
- Modify: `packages/agent/src/managers/skillManager.ts`（`discoverSkills` 改为调用抽取函数，行为不变）
- Test: `packages/agent/tests/shared/diskSkillDiscovery.test.ts`

**Interfaces:**
- Produces:

```typescript
export type DiskSkillSnapshot = {
  metadata: Map<string, SkillMetadata>;
  content: Map<string, Skill>;
  errors: SkillError[];
};

export async function discoverDiskSkills(workdir: string): Promise<DiskSkillSnapshot>;
```

- Consumes: 现有 `discoverSkillCollection` / `scanSkillPath` 逻辑从 `skillManager.ts` **移动**到 `diskSkillDiscovery.ts`（不要复制两套）。

- [ ] **Step 1:** 在 temp 目录写入 `{workdir}/.muse-work/skills/demo-skill/SKILL.md`，写测试断言 `discoverDiskSkills` 含 `demo-skill`、`type: project`。

- [ ] **Step 2:** 跑测试 → FAIL

- [ ] **Step 3:** 从 `SkillManager` 抽出扫描实现到 `diskSkillDiscovery.ts`；`SkillManager.performRefresh` 内 `discovery = await this.discoverSkills()` 改为 `discoverDiskSkills(this.workdir)` + 合并 plugin maps（逻辑与 today 相同）。

- [ ] **Step 4:** `pnpm exec vitest run tests/shared/diskSkillDiscovery.test.ts tests/managers/skillManager.test.ts -v` → PASS（skillManager 全量若太慢可只跑相关 describe）

- [ ] **Step 5: Commit** `refactor(agent): extract disk skill discovery for shared catalog`

---

### Task 3: `SharedSkillCatalog`（acquire / release / refresh）

**Files:**
- Create: `packages/agent/src/shared/sharedSkillCatalog.ts`
- Test: `packages/agent/tests/shared/sharedSkillCatalog.test.ts`

**Interfaces:**

```typescript
export type SkillCatalogListener = (snapshot: DiskSkillSnapshot) => void;

export type SkillCatalogHandle = {
  getSnapshot(): DiskSkillSnapshot;
  unsubscribe(): void;
};

export async function acquireSkillCatalog(
  workdir: string,
  options: { watch: boolean },
  listener: SkillCatalogListener,
): Promise<SkillCatalogHandle>;

export function requestSkillCatalogRefresh(workdir: string): Promise<void>;

export async function resetSharedSkillCatalogForTests(): Promise<void>;
```

**行为:**
- `Map<workdirKey, Entry>`：`refCount`、`snapshot`、`fileWatcher?`、`refreshChain`（串行 refresh，与 today `SkillManager.refreshChain` 相同语义）。
- 首次 `acquire`：`discoverDiskSkills` + 若 `watch` 则对 6 条路径 `watchFile`（与 today `setupWatcher` 路径一致）；`listener` 立即收到当前 snapshot。
- 再次 `acquire` 同 key：`refCount++`，返回新 handle，**不**二次扫描；`listener` 用当前 snapshot 同步调用一次。
- `unsubscribe`：`refCount--`；为 0 时 `fileWatcher.cleanup()` 并 `delete` entry。
- 文件事件：过滤规则与 today `setupWatcher` callback 相同 → `requestSkillCatalogRefresh`。
- `requestSkillCatalogRefresh`：合并并发为一次后续 `discoverDiskSkills` + 通知所有 listeners。
- `resetSharedSkillCatalogForTests`：对所有 entry `cleanup` 并清空 Map。

- [ ] **Step 1:** 测试「双 acquire 同 workdir」：`vi.mock` `FileWatcherService` 构造次数为 1；双 listener 在 mock 触发 change 后均被调用。

- [ ] **Step 2:** 测试「release 到 0」调用 `cleanup`。

- [ ] **Step 3:** 测试「并发双 acquire」：`discoverDiskSkills` spy 仅 1 次（singleflight）。

- [ ] **Step 4:** 实现 `sharedSkillCatalog.ts`

- [ ] **Step 5:** `pnpm exec vitest run tests/shared/sharedSkillCatalog.test.ts -v` → PASS

- [ ] **Step 6: Commit** `feat(agent): shared skill catalog per workdir`

---

### Task 4: `SharedLiveConfig`（acquire / release / reload）

**Files:**
- Create: `packages/agent/src/shared/sharedLiveConfig.ts`
- Test: `packages/agent/tests/shared/sharedLiveConfig.test.ts`

**Interfaces:**

```typescript
export type LiveConfigPayload = {
  configuration: MuseConfiguration | null;
  lastValid: MuseConfiguration | null;
  loadSuccess: boolean;
  warnings?: string[];
};

export type LiveConfigListener = (payload: LiveConfigPayload) => void | Promise<void>;

export type LiveConfigHandle = {
  getPayload(): LiveConfigPayload;
  unsubscribe(): void;
};

export async function acquireLiveConfig(
  workdir: string,
  listener: LiveConfigListener,
): Promise<LiveConfigHandle>;

export function requestLiveConfigReload(workdir: string): Promise<void>;

export async function resetSharedLiveConfigForTests(): Promise<void>;
```

**行为:**
- 从 `LiveConfigManager` **移动**（不删会话逻辑）：`resolveWatchTarget`、`getConfigurationPaths` 等价路径列表、`reloadInProgress` 防重入。
- `reload` 实现：调用 `loadMergedMuseConfig(workdir)` + `validateConfigurationObject`（自 `configurationService` 导出或复用现有 validate）；**不** `setEnvironmentVars`；失败时用 `lastValid`；成功则更新 `lastValid`（规则与 today `lastValidConfiguration` 相同）。
- 首次 acquire：watch + 初始 reload + `listener(payload)`。
- 再次 acquire：仅 `refCount++`，同步 `listener` 当前 payload。
- `requestLiveConfigReload`：供文件变更与显式 `reload()` 使用。
- `resetSharedLiveConfigForTests`：清空 Map + cleanup watchers。

- [ ] **Step 1:** 测试场景 7：settings 文件不存在时 `watchFile` 仍被调用（父目录存在），路径为 `resolveWatchTarget` 结果（可从 `liveConfigManager.hotReload.test.ts` 迁一条到 shared 层）。

- [ ] **Step 2:** 测试 reload 失败保留 `lastValid`。

- [ ] **Step 3:** 实现模块。

- [ ] **Step 4:** `pnpm exec vitest run tests/shared/sharedLiveConfig.test.ts -v` → PASS

- [ ] **Step 5: Commit** `feat(agent): shared live config per workdir`

---

### Task 5: `SkillManager` 订阅 `SharedSkillCatalog`

**Files:**
- Modify: `packages/agent/src/managers/skillManager.ts`
- Modify: `packages/agent/tests/managers/skillManager.test.ts`
- Create: `packages/agent/tests/managers/skillManager.sharedCatalog.test.ts`

**Interfaces:**
- Consumes: `acquireSkillCatalog`, `requestSkillCatalogRefresh`, `SkillCatalogHandle`

**改动要点:**
- 删除 `fileWatcher` 字段与 `setupWatcher`；`initialize` 中若 `watchEnabled` 则 `acquireSkillCatalog(..., { watch: true }, cb)`，否则 `{ watch: false }`。
- `performRefresh` 改为：从 handle `getSnapshot()` 拷贝 metadata/content 到 scratch maps，再合并 `pluginSkill*`（today 逻辑）。
- 监听器回调内 `await this.refreshSkills()`（或内联 swap，避免重入）。
- `destroy`：`handle?.unsubscribe()`。
- `reloadFeatureGatedSkills` → `requestSkillCatalogRefresh(this.workdir)`。
- `deleteSkill` 删盘后仍 `requestSkillCatalogRefresh` 或本地 `refreshSkills`（与 today 收敛一致）。

- [ ] **Step 1:** `skillManager.sharedCatalog.test.ts`：同 workdir 两个 `SkillManager`，A `registerPluginSkills`，B `getAvailableSkills` 不含插件名。

- [ ] **Step 2:** 调整原 `skillManager.test.ts` 里 `FileWatcherService` 断言：改为 mock `acquireSkillCatalog` 或断言 shared 层被调用。

- [ ] **Step 3:** 实现 manager 改动。

- [ ] **Step 4:** `pnpm exec vitest run tests/managers/skillManager.test.ts tests/managers/skillManager.sharedCatalog.test.ts -v` → PASS

- [ ] **Step 5: Commit** `refactor(agent): SkillManager subscribes to shared catalog`

---

### Task 6: `LiveConfigManager` 订阅 `SharedLiveConfig`

**Files:**
- Modify: `packages/agent/src/managers/liveConfigManager.ts`
- Modify: `packages/agent/tests/managers/liveConfigManager.test.ts`
- Modify: `packages/agent/tests/managers/liveConfigManager.hotReload.test.ts`
- Modify: `packages/agent/tests/managers/liveConfigManager.validation.test.ts`

**改动要点:**
- 删除自有 `FileWatcherService` 与 `initializeWatching` 内 watch 循环。
- `initialize` → `acquireLiveConfig(workdir, async (payload) => await this.applyPayload(payload))`；`applyPayload` = today `reloadConfiguration` 里**会话侧**部分：`hookManager`、`permissionManager`、`syncAutoMemorySafeZone`、`configurationService.setEnvironmentVars`（从 payload.configuration）、`await onReload`。
- `getCurrentConfiguration` 读共享 payload 或本地缓存的「已 apply」视图（推荐：apply 时写 `this.currentConfiguration`）。
- `reload()` → `requestLiveConfigReload(workdir)` 并 await 本次 reload promise（保持 `Agent.create` await 语义：shared 层 reload 需暴露 per-key `whenIdle()` 或在 handle 上返回 `reload()` promise）。
- `shutdown` → `handle.unsubscribe()`。
- **保留** `onTurnStart` / `onTurnEnd` / `getTurnSnapshot` 不变。

- [ ] **Step 1:** 新增测试：两个 `LiveConfigManager` 同 workdir，A `onTurnStart`，shared 触发 reload，A `getTurnSnapshot()` 不变，B 无回合则 `getTurnSnapshot()` 为 null。

- [ ] **Step 2:** 跑 `liveConfigManager.hotReload.test.ts` 场景 5/6/7，修 mock（mock `acquireLiveConfig` 或 shared 模块）。

- [ ] **Step 3:** 实现。

- [ ] **Step 4:** `pnpm exec vitest run tests/managers/liveConfigManager -v` → PASS

- [ ] **Step 5: Commit** `refactor(agent): LiveConfigManager subscribes to shared live config`

---

### Task 7: 集成与全量回归

**Files:**
- Modify: `packages/agent/docs/2026-09-30-shared-catalog-liveconfig-design.md`（状态 → 已实现）
- 视需要: `packages/agent/tests/integration/` 一条双 `Agent.create` 同 workdir 的 watcher 计数测（可选，用 mock chokidar）

- [ ] **Step 1:** `pnpm exec vitest run --reporter=dot` in `packages/agent`

- [ ] **Step 2:** `pnpm exec vitest run --passWithNoTests` in `packages/server`

- [ ] **Step 3:** 修失败项直至全绿

- [ ] **Step 4: Commit** `test(agent): regression for shared skill/live config catalogs`

---

## Plan self-review（对照 spec）

| Spec 要求 | Task |
|-----------|------|
| 按 workdir 共享快照 | 3, 4 |
| 会话插件技能隔离 | 5 测试 |
| 回合快照 / 立即 apply | 6 测试 + hotReload |
| watchSkills false | 3 options.watch + 5 |
| onReload await | 4 reload promise + 6 |
| deleteSkill / refresh 串行 | 3 refreshChain + 5 |
| 测试 reset | 1, 各 shared 测试 afterEach |
| 不碰 MCP / GET /skills | Global Constraints |

无 TBD；类型名 `DiskSkillSnapshot`、`acquireSkillCatalog`、`acquireLiveConfig` 全文一致。

## Execution handoff

计划已保存至 [`packages/agent/docs/2026-09-30-shared-catalog-liveconfig-plan.md`](./2026-09-30-shared-catalog-liveconfig-plan.md)。

两种执行方式：

1. **Subagent-Driven（推荐）** — 每个 Task 单独子 agent，做完 review 再下一个  
2. **Inline Execution** — 本会话按 Task 顺序实现，每 2–3 个 Task 汇报检查点  

你选哪一种？选定后我再开始写代码（不会跳过 Task 里的测试步骤）。
