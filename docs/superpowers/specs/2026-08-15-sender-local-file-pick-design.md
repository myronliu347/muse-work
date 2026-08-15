# Sender：选择 / 粘贴本地文件 → `@file`

**日期**：2026-08-15  
**状态**：已确认（对话定稿）  
**范围**：`packages/desktop`（`workdirHost` 文件对话框）、`packages/webview`（`MessageInput` 按钮与粘贴分流、hostBridge 透传、path→FileItem 工具）

## 1. 目标

1. Sender 工具栏可点选本地文件（可多选），插入 **`@file` ContextTag**（与现有 `@` 提及 / File 树拖入相同语义）。  
2. 粘贴本地**非图片**文件同样插入 `@file`；**图片一律走附件**（含带路径的图片文件与无路径截图/位图）。  
3. `@` 下拉仍只搜当前 workdir；点选 / 粘贴可任意本地路径（workdir 外用绝对路径）。

## 2. 决策

| 项 | 选择 |
|---|---|
| 插入形态 | `@file` 标签，不上传文件二进制（图片除外，仍走 AttachedImages） |
| 点选实现 | Electron `showOpenDialog`（`openFile` + `multiSelections`），非 `<input type="file">` |
| 路径范围 | 点选/粘贴任意本地路径；`@` 建议列表不变 |
| 图片策略 | 一律附件；非图片文件 → `@file` |
| 多选 | 支持；不选目录 |
| 宿主 | Desktop 先做；非 desktop 不渲染按钮，粘贴无可靠路径则不走 `@file` |

## 3. 数据流

### 3.1 工具栏点选

```
按钮「添加文件」
  → webview postMessage: desktopSelectFiles
  → Electron showOpenDialog({ properties: ["openFile", "multiSelections"] })
  → 取消 / 空：静默
  → 确认：desktopSelectFilesResult { paths: string[] }
  → MessageInput 逐个 insertFileMentionAtCursor
```

默认对话框起始目录：当前 workdir（有则）；否则交 OS 默认。

### 3.2 粘贴优先级（MessageInput）

1. File 预览 Selection MIME → Selection 标签（现有）  
2. 剪贴板本地文件路径（Electron `File.path` / `text/uri-list` 的 `file://`）  
   - 图片扩展名（png/jpg/jpeg/gif/webp/svg）→ AttachedImages  
   - 其它 → `@file`（多文件按序插入，标签间空格）  
3. 无路径的 `image/*` → AttachedImages  
4. 纯文本（现有）

### 3.3 路径规则

复用 `toRelativePath` 语义：

- 路径在 workdir 下 → `[@file:相对路径]`，`data-path` 为相对路径  
- workdir 外或无 workdir → `[@file:绝对路径]`  
- ContextTag 展示名用 basename；打开/预览仍用绝对 `path`  
- 粘贴解析到目录：跳过该条，不插入

点选与粘贴共用：`absolutePath + workdir → FileItem`（`name`、`path`、`relativePath`、`isDirectory: false`），再走现有 `insertFileMentionAtCursor`。

## 4. UI

- 仅 desktop：在 `input-toolbar-left` 右侧、spacer 之前放按钮（workdir/git 旁）  
- Tooltip：「添加文件」；与输入框同 `disabled` 态  
- 图标：`codicon-new-file` 或 `codicon-add`（与现有 toolbar 尺寸对齐）

## 5. 组件落点

| 层 | 改动 |
|---|---|
| `workdirHost` | 处理 `desktopSelectFiles`，回推 `desktopSelectFilesResult` |
| `hostBridge` | 透传 request / result（与其它 desktop* 命令一致） |
| `MessageInput` | 按钮、监听 result、paste 分流、复用 insert |
| util（小） | path → FileItem；剪贴板本地路径解析 |
| tests | host 对话框参数与取消/确认；webview 插入路径与 paste 分流 |

## 6. 错误 / 边界

- 取消对话框或 `paths` 为空：静默  
- 粘贴解析不到有效本地路径：不拦截，落入后续图片/纯文本分支  
- 输入框 `disabled`：按钮 disabled；粘贴不插入标签  
- 非 desktop：无按钮；无 `File.path` / 无可用 `file://` 时不走 `@file`

## 7. 非目标

- 目录选择  
- OS Finder/资源管理器拖入输入框（File 树 DnD 已有）  
- 扩大 `@` 下拉搜索到 workdir 外  
- 改 agent 对 `@file` 的语义  
- VS Code / 非 Electron 宿主的原生文件对话框（可后续加）

## 8. 测试

- Host：`showOpenDialog` 使用 `openFile` + `multiSelections`；取消不推送；确认推送 paths  
- Webview：paths → 正确 `[@file:…]`（workdir 内相对 / 外绝对）  
- Paste：非图片文件 → `@file`；图片文件 → 附件；Selection MIME 仍优先  
- 回归：`@` 下拉、File 树 DnD、截图粘贴、发送
