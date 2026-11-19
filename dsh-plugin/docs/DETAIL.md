# Muse 工作台

这是 Muse 插件化的第一层：事项和派活。

## 能力

- 事项登记：标题、目标与验收、优先级、工作目录。
- 派活：第一次派活会创建一条 `muse-exec` 会话并命名成事项标题。后续派活直接进同一条会话。
- 轮次结束：事项从「进行中」进入「待审核」。
- 关闭：标记完成或取消。

## 存储在哪儿

`$DSH_HOME/muse/issues.json`。不写会话日志，也不改会话 header；DSH 的会话元数据字段是封闭的，事项与会话的绑定只能放在插件自己的记录里。

## 和 Muse 旧实现的对应

| 旧实现 | 这里 |
|---|---|
| `packages/server/src/services/issueStore.ts` | `host.js` 的 `createStore` |
| `issueDispatch.ts` / `sessionRunner` | `sessionController.create/prompt` |
| `issueTools.ts` | `tools.js` |
| 事项标签页 | 侧栏入口 + 主面板 |
| `packages/agent` | DSH 的 agent loop |

## 已知限制

- 没有规划+执行、worktree、清单、进度上报。
- 助手不是常驻协调器；没有事项结束后唤醒助手的队列。
- 没有自动化。
- 会话历史不能从 Muse 旧格式导入。
