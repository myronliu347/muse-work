# DiffPane：丢弃改动（Revert）与提交入口（Commit）

**日期**：2026-08-15  
**状态**：已确认（对话定稿；含 commit 按钮补充）  
**范围**：`packages/webview` 的 `DiffPane` + `ConfirmDialog` + `ChatApp` 接线；`packages/desktop` 的 `gitDiff`（或同目录 revert 模块）+ `workdirHost`  
**不改**：消息列表 `DiffViewer`；行级 / hunk 级 discard；stash；本机直接 `git commit`（提交交给当前 Agent）；VS Code 扩展宿主（`DiffPane` 已走 desktop 消息，revert 同通道）

## 1. 目标

右侧「变更」面板：

1. **工具栏** discard 图标：丢弃当前 diff 列表中的**全部**改动  
2. **每个文件 header** discard 图标：丢弃**该文件**改动  
3. Revert 确认使用现有 **`ConfirmDialog`**（自定义模态，非 `window.confirm`）  
4. Revert 语义：已跟踪文件 `git restore` 回 HEAD；**未跟踪文件删除**  
5. **工具栏** commit 图标：无确认，向**当前 AI 会话直接发送**固定文案 `git commit`

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| Revert 语义 | 丢弃工作区（非 `git revert` 提交） |
| 未跟踪 | 一并删除（仅 diff 列出的路径，非全仓 `git clean -fd`） |
| Revert 确认 | `ConfirmDialog` |
| Revert 架构 | Desktop host 执行 git / fs；webview 只发消息 |
| Revert 图标 | `codicon-discard` |
| Revert 成功 | 软 refresh diff；不做 toast |
| Revert 失败 | body 顶部可关闭的简短错误条；保留现有 diff |
| Commit 行为 | 无对话框；调用 `onSendMessage("git commit")` |
| Commit 执行方 | 当前会话 Agent（经现有 `sendMessage`），非 desktop 本机 commit |
| Commit 图标 | `codicon-git-commit` |

## 3. UI

### 3.1 工具栏

```
变更                    [commit] [discard] [refresh]
```

**Commit**

- 在 discard **左侧**
- `title` / `aria-label`：`提交改动`
- `data-testid="diff-commit"`
- **无** ConfirmDialog；点击即发送
- 一般保持可点（与 refresh 类似）；不因「无改动」禁用（Agent 可自行处理空提交场景）

**Discard（全部）**

- 在 refresh **左侧**、commit **右侧**
- `title` / `aria-label`：`丢弃全部改动`
- `data-testid="diff-revert-all"`
- `disabled` 当：`state.kind !== "ok"` 或 `files.length === 0` 或正在 `reverting`

### 3.2 文件 header

```
[chevron] [status] [path] …… [discard] [+N -M]
```

- discard 在 stats **左侧**（右对齐动作区）
- 点击 `stopPropagation`，不触发展开/收起或打开文件
- `title` / `aria-label`：`丢弃此文件的改动`
- `data-testid="diff-revert-file"`，并用 `data-path` 或 accessible name 带上路径
- 单个文件 revert 进行中可对该按钮 `disabled`
- **文件行不放 commit 按钮**（仅顶栏）

### 3.3 Revert 确认文案

| 场景 | title | description | confirmText |
|------|-------|-------------|-------------|
| 全部 | 丢弃全部改动？ | 将恢复已跟踪文件到 HEAD，并删除未跟踪文件。此操作不可撤销。 | 丢弃 |
| 单文件 | 丢弃「{path}」的改动？ | 将恢复该已跟踪文件到 HEAD；若为未跟踪则删除该文件。此操作不可撤销。 | 丢弃 |

取消文案默认「取消」。Esc 取消；Enter 确认（与现有 `ConfirmDialog` 一致）。

## 4. Host / Git（仅 Revert）

### 4.1 消息协议

| 方向 | command | 字段 |
|------|---------|------|
| webview → host | `desktopRevertWorkspaceDiff` | `paneId?`, `workdir?`, `paths: string[]`（webview 始终传当前列表或单文件；host 若缺省则回退为全部 porcelain） |
| host → webview | `desktopWorkspaceDiffReverted` | `paneId?`, `ok: boolean`, `error?: string` |

`workdir` 解析与 `desktopGetWorkspaceDiff` 相同：消息内 `workdir` 优先，否则 `state.workdir`。

### 4.2 `revertWorkspaceDiff(cwd, paths?: string[])`

放在 `packages/desktop/src/main/gitDiff.ts`（或紧邻模块，由 `gitDiff` 导出）：

1. 校验 `rev-parse --is-inside-work-tree`；失败 → `{ ok: false, error: "非 git 仓库" }`  
2. 解析 `repoRoot`（`--show-toplevel`）  
3. 读取 porcelain（与 `getWorkspaceDiff` 同参），得到 status 条目  
4. 目标集合：  
   - 传入 `paths` → 与 porcelain 求交（**求交；若交集为空则 ok 且 no-op**）  
   - 未传 → 全部 porcelain 条目  
5. 分流执行：  
   - **tracked**（modified / deleted / added / renamed）：  
     `git restore --source=HEAD --staged --worktree -- <paths>`  
     无 HEAD 时：`git restore --staged --worktree -- <paths>`（对齐现有 diff base）  
     renamed：参数同时包含 `path` 与 `oldPath`（若有）  
   - **untracked**：在确认绝对路径 `path.resolve(repoRoot, rel)` 仍以 `repoRoot + sep` 为前缀后，`fs.rm(abs, { recursive: true, force: true })`  
6. 任一步失败 → `{ ok: false, error: <短消息> }`；已成功的部分不强制回滚（文档化即可）  
7. 成功 → `{ ok: true }`

**不做**：全仓 `git clean -fd`；submodule 专项；嵌套 git；desktop 侧 `git commit`。

### 4.3 安全

- 相对路径规范化后必须落在 `repoRoot` 下，否则拒绝该 path  
- 仅删除 / restore 目标集合中的路径

## 5. DiffPane 数据流

### 5.1 Commit

1. 点击 commit → `onSendMessage?.("git commit")`  
2. `ChatApp` 传入现有 `handleSendMessage`（真正 `postMessage({ command: "sendMessage", text })`，**不是** `appendText`）  
3. streaming / 排队行为与输入框发送一致，DiffPane 不再分支  
4. 文案固定：`git commit`（调用前 trim；常量即可）

### 5.2 Revert

1. 点击 discard → `pendingRevert = { scope: "all" } | { scope: "file", path }` → 渲染 `ConfirmDialog`  
2. 取消 → `pendingRevert = null`  
3. 确认 → `reverting = true`，关闭 dialog，`postMessage(desktopRevertWorkspaceDiff)`；**传当前列表 paths**（全部）或 `[path]`（单文件），避免确认后新文件被误伤  
4. 监听 `desktopWorkspaceDiffReverted`（按 `paneId` 过滤）：  
   - `ok` → `refresh()`（软刷新），`reverting = false`  
   - `!ok` → 设置 `revertError`，`reverting = false`  
5. 刷新触发时沿用现逻辑 `clearComment()`

Host 侧对 renamed 用 porcelain 补 `oldPath`。

## 6. 测试

| 层 | 覆盖 |
|----|------|
| desktop `revertWorkspaceDiff` | temp repo：restore modified；删除 untracked；单 path 不影响其他；路径穿越拒绝；非 repo error；空交集 no-op ok |
| `workdirHost` | 收到 revert 命令后回包（可测真实或 mock） |
| `DiffPane` | commit / discard / 文件 discard 按钮渲染；commit 点击调用 `onSendMessage("git commit")` 且无 dialog；revert 确认发正确 message；取消不发；成功触发 refresh；失败展示错误条；无文件时 all-discard disabled |

## 7. 非目标

- 部分 hunk / 行级 discard  
- 本机 `git commit` / `git stash` / `git revert` 提交  
- Commit 确认框或可编辑 message（MVP 固定文案）  
- 成功 toast  
- 消息内 DiffViewer 的 revert / commit  
- submodule 特殊 UI  
- 文件行上的 commit 按钮
