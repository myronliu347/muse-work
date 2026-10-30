# 2026-10-30 从 wave-agent SDK 同步

上次记录见 [2026-10-10-wave-sdk-sync.md](./2026-10-10-wave-sdk-sync.md)，水位停在 `352ca663`（2026-10-09，`MEMORY.md` 容量）。这次对照 wave-agent 到 `e4d506f9`（2026-10-30），只搬瘦身之后运行时还在用的 12 处。Exec、Artifact、遥测、远控、stdio RPC 仍然不带。瘦身范围见 [slimdown.md](./slimdown.md)。

## 同步了什么

### 1. 去掉进程级 1 QPS

来源：`34de7e0a`（2026-10-29，#2658）。

`aiService` 不再用 `acquireSlot` 把所有会话卡在每秒一次。限流交给网关 429 重试。对应测例 `aiService.rateLimit.test.ts` 删掉。

### 2. Bash 与后台任务的 stdin 改为 `/dev/null`

来源：`fb0034cb`（2026-10-26）。

Bash 和后台 shell 的 `stdio` 改为 `["ignore","pipe","pipe"]`。没人往 stdin 写时，裸 `cat`、不带路径的 `rg` 不会挂到超时。heredoc 不受影响。Bash 运行中的 `onResultUpdate` 还在，见下面「没同步」。

### 3. WebFetch

来源：`8625c297`、`68b90be7`、`907be0f1`、`aaa1fdad`（均为 2026-10-29）。

- HTML 转 Markdown 前剥掉 `script` / `style` / `noscript` / `iframe`，正文截到 1MB。转换失败时退回原始 HTML，并打日志。
- 只有 `text/html` 才转换。其它文本原样通过。二进制经 `persistToolResultBuffer` 落盘，缓存记下路径和大小。
- 超过 100,000 字符的页面按区间读：当前段原文回答，下一段摘要最多 8,000 字符，结果里给出继续用的 `offset`。
- 缓存键是请求 URL，不再用重定向后的最终地址。缓存开启 `ttlAutopurge`。
- 送给模型的网页正文包在随机的 `untrusted-content-…` 标签里，系统提示要求当作数据、不当作指令。

Muse 原有的 URL 校验、重定向策略和 `Muse-User` 没改。没有 Artifact，所以没有按产物 URL 拦截。

### 4. 技能 `allowed-tools` 的目录占位符

来源：`9bb97cb1`（2026-10-13，#2406）。

正文里的 `${MUSE_SKILL_DIR}` 原先会替换，规则里的不会，于是预授权永远匹配不上。现在正文和 `allowed-tools` 走同一套替换：`${MUSE_SKILL_DIR}`、`${WAVE_SKILL_DIR}`、`${CLAUDE_SKILL_DIR}`，以及插件根 `${MUSE_PLUGIN_ROOT}` / `${WAVE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_ROOT}`。解析不了的插件根从规则里丢掉，记到技能的 `warnings`，加载时打出来。这不是校验错误。

### 5. 交互工具在自动放行之前先问人

来源：`439b05bc`（2026-10-20）。

技能的临时规则命中 `isAllowedByRule` 时，AskUserQuestion 会被自动放行并返回 `{}`。现在的顺序是：实例拒绝、拒绝规则、交互工具问人、worktree 安全、`bypassPermissions`、`acceptEdits`、允许规则、其余。拒绝规则仍然优先。没有权限回调就拒绝。`dontAsk` 对这类工具也会问。`bypassPermissions` 里不再重复判断。Muse 没有遥测，所以没带 wave 的 `beginUserWait`。目前名单里只有 AskUserQuestion。

空选项标签来源：`454a92b1`（2026-10-28，#2624）。schema 表达不了 trim，工具自己拒绝空白 `label`。

### 6. 内置工具按 schema 校验参数

来源：`5de8373f`（2026-10-19）、`cbc17f45`（2026-10-28，#2625）。

内置工具在执行前走 `validateToolInput`。深度上限是 7，盖得住 AskUserQuestion 的 `questions[0].options[0].label`。失败返回 `{ success: false }`，不抛。用 WeakSet 按对象身份标记内置工具。MCP、自定义工具、Workflow 注册的 structured tool 不校验。

### 7. 缓存写入量的三种读法

来源：`3931f365`（2026-10-28）、`3c2c39de`（2026-10-29，#2634）。

写入量按互斥形状取一个，不累加：扁平的 `cache_creation_input_tokens`，否则 Anthropic 的 `cache_creation.ephemeral_5m_input_tokens`，否则 GPT 的 `prompt_tokens_details.cache_write_tokens`。扁平字段在场时优先。openai 依赖仍是 `^5.12.2`，多出来的字段声明在 `ExtendedPromptTokensDetails` 上。

### 8. `settings.json` 顶层 `fastModel`

来源：`d8d09c96`（2026-10-15）。

`fastModel` 进了配置白名单、合并（后加载的覆盖先加载的）和返回值。解析顺序与 `model` 相同：override、构造参数、settings 里的 `fastModel`、`MUSE_FAST_MODEL`。写了字段就盖过环境变量。

### 9. 嵌套 Error 序列化

来源：`5b7d9e7e`（2026-10-12）。

`serializeError` 把 `cause` 展开（最多 8 层），避免 `JSON.stringify(error)` 变成 `{}`。用在 openai 客户端的网络重试日志和「读错误响应失败」日志。`errorReplacer` 有导出，没有接到全局 logger。

### 10. 临时目录不可写时降级

来源：`202f34b2`（2026-10-29，#2648）。

专用变量是 `MUSE_TMPDIR`，经 `envGet` 仍能读到 `WAVE_TMPDIR`。不改子进程的 `TMPDIR`。探测在 Bash 包 `pwd -P` 之前同步做完：成功结果缓存到进程结束，失败不缓存。目录不可写就不包工作目录跟踪，并在输出前加上诊断；非零退出再附磁盘压力说明。工具结果目录、MCP 图片、后台任务日志、子代理日志都在调用时 `resolveTempDir()`，不再在模块加载时钉死。和 wave 一样，没有改 aiService 的 400 调试临时文件，也没有改技能 Bash 的临时文件。

### 11. 精简档：任务完成即标记

来源：`20a16099`（2026-10-29）。

TaskUpdate 的 `leanPrompt` 补了一句：做完就标 `completed`，不要攒到最后一批更新。

### 12. 删掉内置 Bash 子代理

来源：`1318da68`（2026-10-29）。

删了 `subagents/bash.md` 和没人引用的 `BASH_SUBAGENT_TYPE`。Explore、Plan 仍使用 Bash 工具。后面那轮子代理对齐（模型、上下文、禁用工具、vision 门控）没有跟过来。

## 相对 wave 的改口

| 点 | 处理 |
|---|---|
| WebFetch User-Agent | 仍是 `Muse-User` |
| 临时目录环境变量 | 规范名是 `MUSE_TMPDIR`；`WAVE_TMPDIR` 继续能读到 |
| openai 依赖 | 不升级。`cache_write_tokens` 写在本地扩展类型上 |
| 交互工具问人 | 没有遥测等待计时 |
| 技能占位符 | 同时认 `MUSE_`、`WAVE_`、`CLAUDE_` 三种前缀 |

## 没同步

这些在 `352ca663` 之后、`e4d506f9` 之前，看过但这一轮没搬：

| 提交 | 原因 |
|---|---|
| `c89d23de` Bash 运行期不再推送输出 | 会改工具结果的推送方式。`onResultUpdate` 还在 |
| `b0e4e130` 流式回调改成纯增量 | 改消息协议，还连着远控合并窗口 |
| `369c9a2a` 压缩摘要走增量通道 | 同上，并且对着 VS Code 插件 |
| `389d3895` 「立即发送」保留其余排队消息 | 改回合打断语义 |
| `a55aaa48`、`a8cd5c62` 内置子代理对齐与 vision 门控 | 和产品侧子代理行为绑在一起，单独开一轮 |
| `843cc1b5` 记忆路径规则的 worktree 映射 | 依赖 wave 的 worktree 规则根 |
| `d40ca71d` hook 对齐与代码安全三层 | 安全面大，不跟这次运行时修补混在一起 |
| `11c918b3` 起的 Workflow 对齐 Claude Code 2.1.293 | Workflow 仍等产品评估 |
| `1707fde8` 转录按页取历史 | Muse 服务端已有 `packages/server/src/utils/transcriptPage.ts` |
| `56ccf6bc` settings 技能百科 | 文档向的内置技能，不是运行时修复 |

遥测、远控、Artifact、知识库、IDE 补全、OS sandbox、Exec、stdio RPC、wave-guide 仍按瘦身结论留在 wave。
