# 变更面板 UI 优化设计

**日期**：2026-08-15  
**状态**：待实现（2026-08-15 对话确认）  
**范围**：`packages/webview` 的 `DiffPane`（及 `ChatApp` 传入 `onOpenFile`）；依赖 `@pierre/diffs`  
**不改**：消息列表 `DiffViewer`、desktop `gitDiff.ts` 的 hunks 协议

## 1. 目标

右侧「变更」面板三项优化：

1. 文件状态由中文标签改为 **图标**（新增 / 修改 / 删除等同理）
2. **文件路径可点击**，打开文件面板（与消息内打开文件同一路径）
3. Diff 正文用 **`@pierre/diffs` 的 `PatchDiff`** 渲染，并 **保留行内评论**

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| 范围 | 仅 `DiffPane` |
| Diff 库 | `@pierre/diffs`（已加入 webview deps） |
| 行内评论 | 必须保留（gutter utility + line annotations） |
| 路径点击 | 只打开文件；不触发展开；chevron/空白展开 |
| hunks 协议 | 后端不变；前端合成完整 patch |
| 消息 DiffViewer | 本次不动 |

曾对比：`react-diff-view`（可用但体验偏旧）、`react-diff-viewer-continued`（要全文、评论难挂）、自研继续抽组件（不符合「标准组件库」）。`@pierre/diffs` 有 `PatchDiff`、官方 annotation/gutter API，与现有 unified hunks + 评论最匹配。

## 3. 现状

- `DiffPane`：互斥 accordion；状态为文字 pill（`STATUS_LABEL`）；路径在 header `button` 内不可单独点击。
- Diff 行：自研解析 `file.hunks` + `renderWordLevelDiff`；悬停行 `+` → 评论框 → `formatDiffComment` → `onAddComment`。
- Host：`getWorkspaceDiff` 返回的 `hunks` 从第一个 `@@` 起（无 `---/+++`）；untracked 仅为 `+` 行、无 hunk header。
- 打开文件：`ChatApp.handleOpenFile` 已存在；`DiffPane` 尚未接收。

## 4. 设计

### 4.1 状态图标

去掉文字 pill，改为 `codicon`，保留 `diff-file-status-*` 色与中文 `title` / `aria-label`：

| status | icon | label |
|--------|------|-------|
| added | `codicon-diff-added` | 新增 |
| modified | `codicon-diff-modified` | 修改 |
| deleted | `codicon-diff-removed` | 删除 |
| renamed | `codicon-diff-renamed` | 重命名 |
| untracked | `codicon-diff-added` + untracked 色 | 未跟踪 |

`+/-` 统计与刷新按钮不变。

### 4.2 Header 与打开文件

布局：

```
[chevron] [status-icon] [path] …… [+N -M]
```

- 点 chevron / header 空白 → 展开/收起（互斥 accordion 不变）
- 点 path → `stopPropagation` + `onOpenFile(file.path)`
- `DiffPaneProps` 增加 `onOpenFile?: (path: string) => void`
- `ChatApp` 渲染 `DiffPane` 时传入 `handleOpenFile`
- path：可聚焦，`role="link"`，Enter/Space 激活；视觉为 accent + hover underline
- deleted / 本机已无文件：仍调用打开；错误由文件面板既有态处理

### 4.3 Patch 适配（前端）

工具函数（如 `toPierrePatch(file: WorkspaceDiffFile): string | null`）：

| 输入 | 输出 |
|------|------|
| `binary` 或空 hunks | `null` → 不挂 `PatchDiff`，沿用占位文案 |
| 含 `@@` 的 tracked hunks | `--- a/<path>\n+++ b/<path>\n` + hunks；added 用 `--- /dev/null`；deleted 用 `+++ /dev/null`；renamed 用 `oldPath`/`path` |
| untracked 仅 `+` 行 | `--- /dev/null\n+++ b/<path>\n@@ -0,0 +1,N @@\n` + 行 |

不修改 `packages/desktop/src/main/gitDiff.ts`。

### 4.4 `PatchDiff` 渲染

展开体使用 `@pierre/diffs/react` 的 `PatchDiff`：

```tsx
<PatchDiff
  patch={patch}
  options={{
    diffStyle: 'unified',
    disableFileHeader: true,
    lineDiffType: 'word',
    overflow: 'scroll',
    enableGutterUtility: true,
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
  }}
  lineAnnotations={…}
  renderGutterUtility={…}
  renderAnnotation={…}
/>
```

- 自有 accordion header 保留；Pierre 自带 file header 关闭。
- 主题：使用 Pierre 内置 `pierre-dark` / `pierre-light`；若与桌面灰阶冲突，用 `unsafeCSS` 做 scoped 微调（不另接 Shiki 自定义主题）。
- 解析/渲染失败：占位「无法渲染差异」；不附 raw 折叠。
- binary / 无差异 / renamed 无 hunk / truncated：现有占位与截断提示保留。

### 4.5 行内评论（行为不变）

| 能力 | 接线 |
|------|------|
| 悬停 `+` | `renderGutterUtility` + hover 的 `lineNumber`/`side` |
| 行下评论框 | `lineAnnotations` + `renderAnnotation`（复用现有评论框 UI/IME/快捷键） |
| 提交 | `formatDiffComment` → `onAddComment` |
| 清理 | 刷新、收起、换展开文件时清空 target/draft |

注释坐标用 Pierre 的 1-based `side` + `lineNumber`；`formatDiffComment` 的展示文案仍用行文本摘要（与现一致）。

### 4.6 组件边界

- `DiffPane.tsx`：header 交互、状态图标、accordion、评论状态机、挂载 `PatchDiff`
- 小工具：`toPierrePatch`（可与 DiffPane 同文件或 `utils/` 旁路；单测覆盖合成规则）
- `ChatApp.tsx`：仅多传 `onOpenFile={handleOpenFile}`
- CSS：`DiffPane.css` 调整 status 从 pill → icon、path link；Pierre 容器 scoped 覆盖按需

## 5. 测试

- 单元：`diffPane.test.tsx` — 状态为图标非文字；点 path 调用 `onOpenFile` 且不 toggle；点 header 仍 toggle；评论提交仍产生 `formatDiffComment` 格式
- 单元：`toPierrePatch` — tracked / added / deleted / renamed / untracked / binary / empty
- e2e demo（若依赖旧 class）：更新 selector；截图可后续刷新

## 6. 非目标

- 不改消息 `DiffViewer`
- 不改 host hunks 字段形状
- 不做 split view、accept/reject hunk、Pierre edit mode
- 不做 DiffPane ↔ FilePane 双向跳转行号（本次 path 打开不带 startLine，除非后续加）
