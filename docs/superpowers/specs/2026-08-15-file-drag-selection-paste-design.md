# File 面板：2MB 上限 / 树拖拽 @ / 选区粘贴标签

**日期**：2026-08-15  
**状态**：已确认（对话定稿；实现与本文同步）  
**范围**：`packages/desktop`（预览/搜索字节上限）、`packages/webview`（FileTree 拖拽、FilePreview 复制、MessageInput 粘贴/放置）

## 1. 目标

1. 大文件预览与内容搜索的单文件上限由 **1MB → 2MB**。  
2. File 树节点可拖到聊天输入框，插入 **`@file` / 目录提及**。  
3. 在 File 预览中选中若干行后复制，粘贴到输入框变成 **Selection 标签**（如 `ChatApp.tsx (127-146)` / 现有 ContextTag）。

## 2. 决策

| 项 | 选择 |
|---|---|
| 上限 | 统一 2MiB（`filePanel` + `searchContentInWorkspace` 默认） |
| 拖拽 | HTML5 DnD；自定义 MIME；仅落到 MessageInput |
| 选区粘贴 | 预览 copy 写自定义 MIME + text/plain；输入框 paste 优先识别 MIME |
| 标签复用 | 现有 `insertSelectionTag` / `@file` ContextTag 路径 |
| 展示 | 沿用现有 ContextTag（图示 `文件名 (起-止)` 由组件渲染） |

## 3. 行为细节

### 3.1 2MB

- `MAX_BYTES = 2 * 1024 * 1024`  
- 文案：「文件超过 2MB…」  
- 测试与内容搜索 `maxFileBytes` 默认同步  

### 3.2 树 → @

- 文件/文件夹均可拖；payload：`path`、`relativePath`、`name`、`isDirectory`  
- Drop 时插入与 `@` 提及相同的 tag（`[@file:relativePath]`，目录 relativePath 带 `/` 或与现有建议一致）  
- 无效 drop（无 MIME）忽略  

### 3.3 预览选区 → Selection

- 仅有非空选区时拦截 copy，写入 MIME（含 path、name、startLine、endLine）及纯文本  
- 无选区：浏览器默认复制  
- 输入框 paste 识别 MIME → `insertSelectionTag`；否则保持现有纯文本/图片粘贴  

## 4. 非目标

- 拖拽移动/复制磁盘文件  
- 未选中行时整文件复制变标签  
- 改 agent 对 `@file` / Selection 的语义  

## 5. 测试

- Host：2MB 边界（刚好 ≤ 可读，> 标记 too-large）  
- Webview：树 drag payload；预览 copy MIME；输入框 paste/drop 插入标签  
