# 会话标题栏显示当前分支设计

**日期**：2026-08-15  
**状态**：待实现（2026-08-15 对话确认）  
**范围**：`packages/webview`（`ChatHeader` / `ChatApp` / `DesktopGitContext` 接线与轮询）；复用现有 `desktopListGitBranches`  
**不改**：host `listGitBranches` 协议、标题栏内分支切换 UI、`.git/HEAD` 文件监听

## 1. 目标

1. 已有会话的当前分支（及 worktree 名）显示从输入区挪到**会话标题栏**。
2. 当前分支在外部变更时（如终端 `git checkout` / `git switch`）标题栏**自动更新**。

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| 刷新方式 | 轮询 `desktopListGitBranches`（约 3s） |
| 标题栏内容 | 分支 + worktree 名（与现有 `DesktopGitContext` 一致） |
| Draft | 选择器仍在输入区；标题栏不放徽章 |
| 已有会话 | 徽章只在标题栏；输入区不再显示 |
| 徽章交互 | 只读 |

曾对比：监听 `.git/HEAD`（更实时但实现更重）、仅在终端/diff 等事件上补查（外部纯 CLI 切换可能漏）。轮询改动小、复用现有 IPC，满足「外部切分支也更新」。

## 3. 现状

- 已有会话：`ChatApp` 把 `DesktopGitContext` 放在 `MessageInput` 的 `workdirSelector`（输入区左侧）。
- 分支文案优先 `session.worktreeBranch`，否则 `paneGitBranches.current`；worktree 名来自 `session.worktreeName`。
- `desktopListGitBranches` 仅在 `effectiveWorkdir` 变化时查询一次；外部切分支后 UI 不更新。
- `ChatHeader` 仅有会话标题 + 按钮（Desktop 下多为面板开关）。

## 4. 设计

### 4.1 UI 放置

**已有会话（Desktop）**

- `DesktopGitContext` 渲染在 `ChatHeader`：标题右侧、按钮区左侧。
- 布局：`[会话标题] … [分支徽章] [面板开关等]`。
- 输入区左侧不再渲染该徽章。

**新建会话（draft）**

- workdir 选择器 + 分支/worktree 控件仍在输入区。
- 标题栏不放徽章（避免与可编辑选择器重复）。

**非 Desktop / 非 git / 无 branch 且无 worktreeName**

- 标题栏不显示徽章。

### 4.2 数据源

| 字段 | 来源 |
|------|------|
| 分支 | 实时 `paneGitBranches.current`；首次查询未返回前可回退 `session.worktreeBranch` |
| worktree 名 | `session.worktreeName`（元数据，不随 checkout 变） |

不再用创建时冻结的 `session.worktreeBranch` **覆盖**实时 HEAD，否则外部切分支不会反映。

### 4.3 轮询

- 条件：Desktop 且存在 `effectiveWorkdir`。
- 间隔：约 **3s**；复用现有命令 `desktopListGitBranches`（含 `paneId`），回写 `paneGitBranches`。
- **workdir 变化**：先清空再查（现有行为，避免脏数据）。
- **定时 / 可见性补查**：不清空，静默覆盖，避免徽章闪烁。
- `document.visibilityState === "hidden"` 时暂停；变为 `visible` 时立刻补查一次。
- Host 协议与 `listGitBranches` 实现不变。

### 4.4 组件接线

- `ChatHeaderProps` 增加可选 `gitContext?: { branch?: string; worktreeName?: string }`；有值时渲染 `DesktopGitContext`。
- `ChatApp`：非 draft 时把徽章 props 传给 `ChatHeader`；draft 的 `workdirSelector` 仅保留选择器控件。
- 样式：复用 `desktop-git-context`；必要时微调 `ChatHeader.css` 间距与截断，避免挤掉标题。

### 4.5 非目标

- 不改 host 分支列表协议
- 标题栏不做分支切换
- 不引入 `.git/HEAD`（或 gitdir）文件监听
- 不改 session 持久化字段语义（`worktreeBranch` / `worktreeName` 仍作创建与元数据）

## 5. 测试

| 场景 | 期望 |
|------|------|
| 已有会话 + 有分支 | 徽章在 `chat-header` 内；输入区无 `desktop-git-context` |
| draft + 有 workdir | 输入区仍有分支选择器；标题栏无徽章 |
| 二次 `desktopGitBranches` 且 `current` 变化 | 标题栏分支文案更新 |
| 现有 desktop git / session 测试 | 按新 DOM 位置调整断言 |

主要触及：`ChatHeader` 相关单测、`desktopApp.test.tsx` / `DesktopGitContext` 相关断言、必要时 e2e demo。

## 6. 实现顺序（建议）

1. `ChatHeader` + types + 样式：接收并渲染 `gitContext`
2. `ChatApp`：徽章从输入区挪到 Header；分支优先实时 HEAD
3. 轮询 + visibility 暂停/补查
4. 更新测试

## 7. 风险

- **轮询延迟**：最多约一个间隔才反映外部切分支；可接受。
- **多 pane**：各 pane 按自身 `effectiveWorkdir` + `paneId` 轮询，与现有隔离一致；注意勿在定时路径清空 `paneGitBranches`。
- **detached HEAD**：`listGitBranches` 已将 `HEAD` 视为无当前分支名（`current: null`）；徽章可能只剩 worktree 名或隐藏，与现网一致。
