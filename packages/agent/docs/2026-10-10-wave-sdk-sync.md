# 2026-10-10 从 wave-agent SDK 同步

`@muse-work/agent` 在 2026-09-30（`d62cccb`）从 wave-agent SDK 约 `85661483`（v1.3.0，含当天早上的流式降级）fork。之后 SDK 到 2026-10-09 又有一批 `packages/agent-sdk` 提交。这次只搬运行时还在用的三处，不把已经砍掉的 Exec / Artifact 带回来。瘦身范围见 [slimdown.md](./slimdown.md)。

## 同步了什么

### 1. `MEMORY.md` 容量治理

来源：`352ca663`（2026-10-09，#2365）。随后两条 Windows 路径断言（`7385f084`、`f72f6aed`）跟着测例一起带上。

加载索引不再只说「超了多少」。警告会点名已加载多少行、总共多少行、从哪一行丢弃，并回显被丢内容的前 80 个字符。字符上限真的切进第 1 行时才用 “line 1” 措辞。

写入挂在 `ToolManager.execute` 上（`utils/memoryCapNotices.ts`）：

- 索引按行数和字符数取更紧的一维。达到上限的 80% 提醒压到 140 行 / 17,500 字符；超过 100% 在工具结果里报错，但这次写入保留。
- 超长索引行点名行号，最多 5 行。
- 正文文件按 4096 字节 / 200 行拦截，并检查 frontmatter `description` 是否缺失或超过 300 字符。
- 记忆目录之外的写入不读文件。

`ensureAutoMemoryDirectory` 只建目录。索引已存在就返回；有正文、没有索引时，按各文件的 `description` 回填一份索引（一行一条，封顶 140 行 / 17,500 字符）。不再预写 `# Project Memory` 模板。

### 2. Edit / Write 的先读后写守卫

来源：`4d2f2797`（2026-09-30）。Muse 已去掉 Plan mode，补丁里的 plan 模式跳过没有带。

- Edit 不再要求文件先被 Read 过。读过但磁盘已变时，只要 `old_string` 还能唯一匹配（`replace_all` 下能匹配到）就照常应用，并在结果前说明文件里还有模型没见过的改动；匹配不上才报 unexpectedly modified。
- Write 不再拒绝未读覆盖。读过且内容哈希对不上时仍然拒绝：整文件覆盖没有「能干净应用」的判据。

完整工具描述里「请先 Read」的原句还在，模型仍会被建议先读，工具不再因此硬失败。

### 3. 系统提示词简洁模式（`leanPrompt`）

来源：`213b0ddb`（2026-09-30，当时默认关闭）。完整版提示词对齐 Claude Code 2.1.285 的重写（`2ca8e7c8`）没有搬，关掉简洁模式时静态提示词与 fork 时逐字相同。

开启时：

- 静态系统提示词收成身份句、安全说明（`SECURITY_NOTE`）和 `# Harness`。
- 每个内置工具改用自己的 `leanPrompt`；没声明的工具回落完整描述。
- 工具名、参数 schema、工具集和权限判定不变。动态块（语言、环境、auto-memory）不动。

**默认开启**，对齐 wave 后来的 `b9d27702`（`LEAN_PROMPT_DEFAULT_ENABLED = true`）。`settings.json` 不写 `leanPrompt` 就用简短提示词。要回到完整版，写 `"leanPrompt": false`。用户级和项目级都认，后加载的覆盖先加载的，显式 `false` 会保留。配置读失败时也落回默认开启，避免一次坏配置把这一轮打掉。

## 相对 wave 的改口

| 点 | 处理 |
|---|---|
| Edit / Write 的 `leanPrompt` | wave 原文仍写「不先读就会失败」。和这次放开的守卫矛盾，这两句改成了和运行时一致的说法。完整描述未改。 |
| AskUserQuestion 的 `leanPrompt` | 去掉了 ExitPlanMode / plan mode 那句。Muse 没有这两个工具。 |
| `searchHint` | 没带。它是 Exec 延迟加载（`ed786c18`）给沙箱工具搜索打分用的一行短语，Muse 没有读者。 |
| 配置加载 | 落在 `loadMuseConfigFromFile` / `loadMergedMuseConfig` 的白名单上，键名仍是 `leanPrompt`。 |

## 没同步

这些都依赖已经删除的能力，或会改消息协议：

| 提交 | 原因 |
|---|---|
| 内置与 MCP 延迟进 Exec、`tools.ToolSearch`、Exec 默认开启 | Exec 已整包删除 |
| 任务提醒在延迟工具经 Exec 调用后失效、工具引导行因工具进池消失 | 没有沙箱工具池 |
| PreToolUse / PostToolUse 下沉到执行漏斗，以及 `isMeta` / `MessageSource` 删除 | 漏 hook 的路径是 Exec 沙箱；附带改动会改消息协议 |
| Artifact 默认开启（仅已登录） | Artifact 已删除 |
| 完整系统提示词重写（删掉 `# Output efficiency` 等） | 只收简洁模式这一档 |

## 开关

```json
{ "leanPrompt": false }
```

写在 `~/.muse-work/settings.json` 或 `<workdir>/.muse-work/settings.json`。不写则开启。
