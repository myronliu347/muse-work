# @muse-work/agent

Muse Agent 运行时。从 `wave-agent-sdk` fork，在本 monorepo 内作为 `@muse-work/agent` 维护。

```ts
import { Agent } from "@muse-work/agent";
import type { Message } from "@muse-work/agent/types";
import { AGENT_TOOL_NAME } from "@muse-work/agent/constants";
```

## 路径

| 用途 | 路径 |
|---|---|
| 用户 / 项目配置目录 | `~/.muse-work`、`<workdir>/.muse-work`（可用 `MUSE_HOME_DIR` 改目录名） |
| 插件清单 | `.muse-plugin/`，其次回退 `.wave-plugin/`、`.claude-plugin/` |

## 环境变量

新键一律是 `MUSE_*`。读取时若没有 `MUSE_*`，会再读同名 `WAVE_*`，所以旧的 `settings.json` / shell / 插件模板还能用。新写入（例如设置页）只落 `MUSE_*`。

常用键：

| 变量 | 作用 |
|---|---|
| `MUSE_API_KEY` / `MUSE_BASE_URL` | 网关凭证与地址 |
| `MUSE_SERVER_URL` | SSO 服务端地址（settings `env` 会镜像到 `process.env`） |
| `MUSE_MODEL` / `MUSE_FAST_MODEL` / `MUSE_VISION_MODEL` | 主模型 / 快模型 / 视觉子 Agent |
| `MUSE_MAX_INPUT_TOKENS` / `MUSE_MAX_OUTPUT_TOKENS` | 输入 / 输出 token 上限 |
| `MUSE_DISABLE_AUTO_MEMORY` / `MUSE_AUTO_MEMORY_FREQUENCY` | 自动记忆开关与轮次 |
| `MUSE_PLUGIN_ROOT` / `MUSE_SKILL_DIR` / `MUSE_PROJECT_DIR` | 插件、技能、项目目录（hooks / MCP 会同时注入 `WAVE_*` 别名） |

完整列表见内置 settings skill。占位符 `${MUSE_PLUGIN_ROOT}`、`${WAVE_PLUGIN_ROOT}`、`${CLAUDE_PLUGIN_ROOT}` 都会替换。

## Scripts

```bash
pnpm -F @muse-work/agent build
pnpm -F @muse-work/agent test:unit
pnpm -F @muse-work/agent type-check
```
