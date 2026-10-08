# 按 workdir 共享技能目录与 Live 配置 — 设计说明

日期：2026-09-30  
状态：已实现（2026-09-30）  
范围：`@muse-work/agent`（server 侧 Agent 会话仅作为宿主，本设计不改 server 路由）

## 问题

每个 `Agent.create()` 都会新建 `SkillManager` 与 `LiveConfigManager`，各自 `new FileWatcherService()` 并监听同一批路径（用户/项目技能目录、`settings.json`）。同一 `workdir` 上最多可有 `AGENT_MAX_LIVE`（20）个活会话，导致重复的 chokidar 监听与重复的磁盘扫描；一次文件变更会触发 N 次全量技能重扫与 N 次配置重载。

子 agent 使用父容器的 manager，不会额外挂 watcher。MCP 不在文件监听范围内（`McpManager` 仅在 `initialize` 时读 `mcp.json` 并建连接），本设计不处理 MCP。

## 目标与非目标

**目标**

- 进程内按 **规范化 `workdir`** 共享磁盘侧状态：一份监听、一份扫描/解析结果，多个 agent **订阅** 后各自处理。
- **行为与现网一致（选项 A）**：
  - 回合内仍使用该会话在 `onTurnStart` 钉住的配置快照；回合外读配置走 live 值。
  - 权限、hook、环境变量在配置重载后 **立即** 作用于该会话容器。
  - 插件技能仍 **仅属于** 挂载了对应 `plugins` 的 agent，不进入共享磁盘快照。
  - 不同 `workdir` 之间技能列表与项目级 `settings.json` 互不影响。

**非目标**

- 不合并 MCP 连接或共享 `McpManager`。
- 不把 `SkillManager` / `LiveConfigManager` 单例直接放进 DI 容器（会串会话的插件技能与回合快照）。
- 不改为轮询 mtime 替代监听。
- **不包含** server `GET /skills`（若已单独落地，与本文独立；共享层落地后该接口可改为读共享目录，属后续优化）。

## 方案（方案 1）

进程级两个注册表，键为 `path.resolve(workdir)`：

| 组件 | 职责 |
|------|------|
| `SharedSkillCatalog` | 监听技能相关目录；维护该 workdir 的 **磁盘技能快照**（builtin + personal + project）；`refreshed` 事件 |
| `SharedLiveConfig` | 监听 user/project `settings.json`（含尚不存在路径的父目录解析）；维护 **合并后的 `MuseConfiguration`**；`reloaded` 事件 |

每个 agent 容器内仍注册 **会话绑定**：

- `SkillManager`：订阅目录；对外 `getAvailableSkills()` = 磁盘快照 ∪ 本会话 `pluginSkill*` maps；`refreshed` 仍由本会话 emit（供 `SlashCommandManager`）。
- `LiveConfigManager`：订阅配置；收到变更后在 **本会话** 更新 `ConfigurationService` env、`HookManager`、`PermissionManager`（含 auto-memory 安全区）、`onReload`；`onTurnStart` / `onTurnEnd` / `getTurnSnapshot` 不变。

```text
                    ┌─────────────────────────┐
                    │  SharedSkillCatalog     │
                    │  (per workdir, refcount)│
                    └───────────┬─────────────┘
                                │ refreshed(disk snapshot)
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   SkillManager(A)       SkillManager(B)       …
   + plugin skills       + plugin skills

                    ┌─────────────────────────┐
                    │  SharedLiveConfig       │
                    │  (per workdir, refcount)│
                    └───────────┬─────────────┘
                                │ reloaded(config)
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   LiveConfigManager(A)  LiveConfigManager(B)  …
   turn snapshot          turn snapshot
   apply to container A   apply to container B
```

## 监听路径（与现网一致）

**技能（每个 workdir 一份 catalog）**

- `~/.muse-work/skills`、`~/.claude/skills`、`~/.agents/skills`
- `{workdir}/.muse-work/skills`、`{workdir}/.claude/skills`、`{workdir}/.agents/skills`

用户级路径在多个 workdir 的 catalog 中会各注册一次监听（与 today 每 agent 各听一份相比，同 workdir 的多会话合并为一份）。

**配置（每个 workdir 一份 live config）**

- `~/.muse-work/settings.json`
- `{workdir}/.muse-work/settings.local.json`、`{workdir}/.muse-work/settings.json`

解析与校验复用 `ConfigurationService.loadMergedConfiguration(workdir)` 的逻辑；**共享层不得**调用任意会话的 `setEnvironmentVars`——仅保存解析结果并广播；各 `LiveConfigManager` 在 `apply` 时写入本会话的 `ConfigurationService`。

## 订阅生命周期

**acquire（首次订阅某 workdir）**

1. 规范化 `workdir` 路径；`refcount++`。
2. 若该键首次出现：初始全量扫描/加载 + 启动 `FileWatcherService`（可进程内单例 watcher + 按路径 refcount，或每 catalog 一个 watcher——实现择一，但同一物理路径不得重复 `chokidar.add`）。
3. 并发 acquire：单飞（singleflight），避免双扫。

**release（`SkillManager.destroy` / `LiveConfigManager.shutdown`）**

1. 取消本会话回调；`refcount--`。
2. `refcount === 0`：停止监听、从注册表删除该 workdir 条目。

子 agent 不 acquire；沿用父容器 manager。

**配置 reload 中的技能**

现网 `LiveConfigManager` 的 `onReload` 会 `skillManager.reloadFeatureGatedSkills()`。改为对共享目录调用 `refresh()`：扫描进行中则合并为 **一次** 后续扫描；扫描完成后各订阅 `SkillManager` 合并插件技能并 emit `refreshed`。

## 会话侧行为（须保持的契约）

| 场景 | 期望 |
|------|------|
| agent-config 场景 5：回合中改 settings | 权限/hook/env 立即更新；`getTurnSnapshot()` 在回合内不变 |
| 场景 6：auto-memory 开关 | `syncAutoMemorySafeZone` 仍在 apply 时跑 |
| 场景 7：启动时不存在的 settings | `resolveWatchTarget` 行为保留 |
| 插件技能 | 仅 `registerPluginSkills` 的 agent 可见；`refreshSkills` 后仍从 `pluginSkill*` 恢复 |
| `Agent.create` 完成前 reload | `onReload` 仍 await，避免 create 返回后仍在扫盘 |
| `watchSkills: false` | 不 acquire 目录（不监听）；可读一次磁盘或懒加载——与现 `watch: false` 语义对齐 |

## 文件与模块（建议）

| 路径 | 说明 |
|------|------|
| `packages/agent/src/shared/sharedSkillCatalog.ts` | 注册表 + acquire/release + refresh |
| `packages/agent/src/shared/sharedLiveConfig.ts` | 注册表 + acquire/release + reload |
| `packages/agent/src/shared/pathKey.ts` | `resolveWorkdirKey(workdir)` |
| `packages/agent/src/managers/skillManager.ts` | 去掉自有 `FileWatcherService`；订阅 catalog |
| `packages/agent/src/managers/liveConfigManager.ts` | 去掉自有 watcher；订阅 shared config；保留 turn snapshot 与 apply |
| `packages/agent/src/utils/containerSetup.ts` | 构造方式不变，仍 per-agent 实例 |
| `packages/agent/src/shared/testing.ts` | `resetSharedCatalogsForTests()` |

可选：将 `FileWatcherService` 提升为进程级按路径 refcount 的订阅 API（`subscribe(path, cb) -> unsubscribe`），供两个 shared 模块复用。

## 测试

**共享层**

- 同 workdir 双订阅：一次监听，一次文件事件两路回调。
- 两 workdir：快照隔离。
- 并发 acquire：单次初始扫描。
- refresh 合并：连续 refresh 仅一次后续扫。
- release 至零：监听清理。
- 配置加载失败：广播 `lastValid` 或空配置。

**会话绑定**

- 现有 `liveConfigManager.hotReload.test.ts` 场景 5/6/7 保持通过（绑定层）。
- 插件技能：A 注册插件名，B 同 workdir 列表不含该插件名。
- 同 workdir 两 agent：各回合快照独立；一方回合中 reload 不篡改另一方 `getTurnSnapshot()`。
- `skillManager` watcher 相关断言改为针对 shared 层或集成测。

每个共享层测试文件 `afterEach` 调用 `resetSharedCatalogsForTests()`。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 测试间泄漏全局状态 | 显式 reset + 避免依赖测试顺序 |
| apply 顺序导致会话 env 交叉 | 共享层永不写 `ConfigurationService` |
| LRU 销毁 agent 后 refcount 错误 | destroy 路径必须 release；与 today 对称 |

## 验收

- 同 workdir 开多个 `Agent.create` 后，进程内对同一项目技能目录的 chokidar 注册次数为 1（或等价 refcount）。
- 改项目 `SKILL.md` / `settings.json`：所有该 workdir 的存活 agent 行为与改前单 agent 一致（含斜杠命令与权限）。
- `packages/agent` 与 `packages/server` 现有相关测试通过。

## 后续（本 spec 不实现）

- `GET /skills` 改为读 `SharedSkillCatalog` 快照，避免每次 HTTP 全量 `SkillManager.initialize`。
- 全局单例 Skill/LiveConfig **管理器对象**（方案 2）——明确不做。
