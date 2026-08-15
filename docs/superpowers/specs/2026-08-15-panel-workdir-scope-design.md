# 右侧面板按 workdir 作用域设计

**日期**：2026-08-15  
**状态**：待实现（2026-08-15 对话确认）  
**范围**：`packages/webview`（panelGroupStore / ChatApp / TerminalPane）、`packages/desktop`（删除 session 时的 PTY kill 路径）

## 1. 目标

- 右侧面板整块状态（宽度、打开的面板、active、preview/file、终端）按 **workdir** 共享，不再按 `sessionId`。
- 同一 workdir 下切换 session：**不刷新**右侧面板，终端不重建。
- 切换到其他 workdir 再切回：UI 与 PTY（含 scrollback）从进程内缓存恢复。
- 无 SSH；多分屏不作为一等公民（现有 pane 代码可保留，但不单独设计分屏共享策略）。

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| 作用域 | 整块 `PanelGroupState` 按 workdir |
| 缓存策略 | 按 workdir 保留（换目录再回来可恢复） |
| `groupKey` | `effectiveWorkdir`（规范化绝对路径）；无 workdir 不写缓存 |
| 终端 `termId` | `term-wd-${encodeURIComponent(normalizedWorkdir)}` |
| 删 session | **不** kill 该目录终端 |
| 持久化 | 不做（仍 zustand 内存 + host PTY） |
| 分屏 | 不特判；将来若需要再议 |

## 3. 现状

- `panelGroupStore.groups` 按 session / `new:${paneId}` / `__draft__` 分桶。
- `ChatApp` 在 draft→真实 session 时 `migrateGroup`。
- `TerminalPane`：`termId = term-${sessionId}`；切 session 会 reset UI 并 create 新 PTY（旧 PTY 保留）。
- `hostBridge.handleDeleteSession`：`desktopTerminalKill(term-${sessionId})`。
- `DesktopApp` prune：保留 pane 的 sessionId / `new:paneId` 与 tree 中的 sessionId。

同 workdir 切会话会换 key → 面板布局闪断、终端换壳，不符合「目录级工作台」预期。

## 4. 设计

### 4.1 `groupKey` 规则

| 条件 | `groupKey` |
|------|------------|
| Desktop 且有 `effectiveWorkdir` | 规范化后的绝对路径（与 `state.workdir` / `host.workdir` 一致） |
| 无 workdir（draft / 未选目录） | `undefined`：只读空状态，`patchGroup` 不写 |
| 非 Desktop | `undefined`（与现网一致） |

删除：

- `__draft__` / `new:${paneId}` 作为 panel group key
- `migrateGroup(draft → sessionId)` 与 `sentFromNewSessionRef` 相关迁移

`PanelGroupState` 字段不变：`checked` / `mounted` / `active` / `widths` / `previewUrl` / `fileView` / `forward` / `forwardError`。整块随 workdir 共享（forward 无 SSH 时基本闲置）。

`isDraftGroupKey` 可改为「无 workdir / 空 key」语义，或删除并由调用方直接判断。

### 4.2 终端生命周期

**`termId`**

- 有 workdir：`term-wd-${encodeURIComponent(normalizedWorkdir)}`
- 无 workdir / draft：不创建 PTY

**切换**

| 变化 | 行为 |
|------|------|
| 同 workdir，只换 session | `termId` 不变 → 不 reset、不 create、不 kill |
| 换 workdir | 切到新 `termId`；旧 PTY 保留；host `create` 对已存在 id reattach + 回放 buffer |
| 同 key 下 cwd 实际变更 | kill + 重建（保留现有语义） |
| 用户「重启终端」 | kill 当前 workdir PTY 再 create |

**删除 session**

- 去掉 `handleDeleteSession` 中的 `desktopTerminalKill(term-${sessionId})`
- 终端跟 workdir 走，删聊天不杀 shell

**剪枝**

- `prunePanelGroupCache` 保留：session tree 中所有 `session.workdir` ∪ 当前 `workdirState.workdir`
- 被 prune 掉的 workdir：顺带 `desktopTerminalKill(term-wd-…)`，避免无限堆积
- 应用退出：host 现有 `killAll` 不变

### 4.3 ChatApp / DesktopApp 接线

**ChatApp**

```ts
const groupKey =
  isDesktop && effectiveWorkdir ? effectiveWorkdir : undefined;
```

- `updatePanelGroup`：无 `groupKey` 不写
- 面板禁用：仍按「有无 workdir」；不再用 `__draft__` / `new:` 判断 group
- `TerminalPane`：用 workdir 派生 `termId`；可去掉对 `sessionId` 定 id 的依赖

**DesktopApp prune**

注意：`desktopSessionTree` 的 **group.workdir 只是 `"pin"` / `"recent"`**，不是路径。真实绝对路径在 **`DesktopSessionEntry.workdir`**（创建 session 时写入的全路径）。

```ts
const keep = new Set<string>();
if (workdirState?.workdir) keep.add(workdirState.workdir);
for (const g of sessionTree) {
  for (const s of g.sessions) {
    if (s.workdir) keep.add(s.workdir); // absolute path only
  }
  // 不要用 g.workdir（"pin" | "recent"）
}
// prune 前后 diff → kill 被移除 workdir 对应的 term-wd-…
prunePanelGroupCache(keep);
```

### 4.4 非目标

- 不做分屏特判（两 pane 同 workdir 是否共享）
- 不新增 / 不修复 SSH forward
- 不把面板状态持久化到磁盘
- 不改 chatReducer / session 业务状态

## 5. 测试

| 现有语义 | 新语义 |
|----------|--------|
| 切 session 换 panel group | 同 workdir 切 session → panel **不变**；换 workdir → 换 group |
| draft 发消息 migrate 到 session | 有 workdir 即写入该 bucket；切 session 不丢 |
| 删 session 忘掉 panel | 删 session **不**清 panel；workdir 从 tree 消失再 prune |
| terminal：切 session 换 `term-sN` | 同 workdir 零 create/kill/reset；换 workdir 换 `term-wd-…` |

主要触及：

- `packages/webview/tests/webview/chatAppPanels.test.tsx`（`session-level panel groups` → workdir-level）
- `packages/webview/tests/webview/terminalPane.test.tsx`

## 6. 实现顺序（建议）

1. `panelGroupStore` / `ChatApp`：`groupKey` 改 workdir；删 migrate；改 prune
2. `TerminalPane` + `hostBridge` delete 路径：workdir `termId`；更新测试
3. prune 时 kill 被移除 workdir 的 PTY（若放在 webview，需能拿到被删 key 列表）

## 7. 风险

- **旧 session 级 PTY 泄漏**：升级后内存中可能残留 `term-${sessionId}`；进程重启即清，可接受；可选一次性 `killAll` 不在范围。
- **workdir 字符串不一致**（尾斜杠 / 大小写）：key 与 `termId` 必须用同一套规范化；与现有 `effectiveWorkdir` 对齐即可。
- **弄错 tree 字段**：`group.workdir` 是 `"pin"`/`"recent"`；必须用 `session.workdir`（绝对路径）做 prune keep 集合，否则会漏保留或误用假 key。
