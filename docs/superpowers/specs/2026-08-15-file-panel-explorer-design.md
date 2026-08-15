# 文件面板：workdir 文件树 + 预览增强

**日期**：2026-08-15  
**状态**：已确认（对话定稿）  
**范围**：`packages/webview`（FilePane 及子组件 / panelGroupStore）、`packages/desktop`（filePanel / fileSearch / workdirHost）

## 1. 目标

在现有 File 面板上完成：

1. **右侧 workdir 文件树**（虚拟列表）+ `vscode-icons-js` 图标  
2. **顶部路径栏**（同套文件图标；相对 workdir，否则绝对路径）  
3. **预览增强**  
   - 代码：Shiki `github-light` / `github-dark`（跟 app 主题）  
   - Markdown：Preview / Source 可切换，默认 Preview  
   - 图片：直接展示  
   - 二进制或 **> 1MB**：不渲染，提示 +「在 Finder 中显示」

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| 布局 | 左预览 + 右文件树；顶栏跨全宽 |
| 方案 | 增强现有 `FilePane`（不新建独立 Explorer 面板） |
| 树展开 | 打开文件时 ensure-expand 到该路径；按 workdir 记忆展开/选中/宽度 |
| 过滤 | 尊重 `.gitignore`；始终跳过 `node_modules`、`.git`；解析失败回退硬编码 skip |
| 路径栏 | 单行 + 图标；相对 workdir，否则全路径；中间省略 |
| 不支持打开 | `shell.showItemInFolder`（reveal，不是默认应用打开） |
| 树宽 | 可拖拽；`min ≈ 180px`，`max ≈ 420px`，默认 `≈ 240px` |
| 大小上限 | 1MB（文本与图片均适用） |
| 持久化 | 仅内存，挂在 panel group / workdir 作用域 |

## 3. 现状

- `FilePane`：只读预览；hljs 高亮；markdown 始终 preview；无文件树。  
- Host：`openFile` → `readLocalFileForPanel` → `desktopFileContent`；上限 2MB；二进制用 `error` 字符串。  
- `listWorkspaceDir` 已存在（@ 提及），硬编码 skip，无 gitignore。  
- 无 `showItemInFolder` 通路。

## 4. 布局与组件

```
┌─ toolbar: [icon] path ··· [md: Preview|Source] ──────────────────────────┐
├──────────────────────────────┬─ drag ─┬──────────────────────────────────┤
│  左侧：FilePreview            │         │  右侧：FileTree（虚拟列表）        │
│  code / md / image /          │         │  vscode-icons-js                 │
│  unsupported + Finder 按钮    │         │  懒加载 · 选中高亮                 │
└──────────────────────────────┴─────────┴──────────────────────────────────┘
```

| 组件 | 职责 |
|------|------|
| `FilePane` | 壳：总宽拖拽、顶栏、左右分栏、接线 |
| `FilePathBar` | 图标 + 路径展示 |
| `FilePreview` | 按类型分发渲染 |
| `FileTree` | 虚拟列表、展开/选中、懒加载、自身宽度拖拽 |
| `FileIcon` | 封装 `vscode-icons-js`（树与路径栏共用） |

未打开文件：左侧 placeholder（可从消息或右侧树打开），右侧仍显示树。

## 5. Host API / 数据流

### 5.1 复用

- `openFile` → `desktopFileContent`：树点击与消息路径共用。  
- 扩展 `listWorkspaceDir` / 专用 `desktopListDir`（推荐独立命令，语义清晰）。

### 5.2 新增 / 调整

**`desktopListDir`**

- 入参：相对 `dir`（相对当前 workdir）  
- 出参：`{ name, path, relativePath, isDirectory }[]`（仅一层）  
- 过滤：从 workdir 起解析 `.gitignore`；始终跳过 `node_modules`、`.git`；失败则硬编码 skip

**`revealInFinder`**

- `shell.showItemInFolder(absPath)`  
- unsupported 主按钮使用

**`readLocalFileForPanel`**

- `MAX_BYTES = 1MB`  
- 二进制或 `size > 1MB`：不回 `content` / `imageBase64`，回  
  `unsupported: "binary" | "too-large"`（可带 `sizeBytes`）  
- 图片 ≤1MB：仍 `imageBase64`

### 5.3 Webview 状态

挂在 `panelGroupStore` 的 workdir group（与面板作用域一致）：

```ts
fileTree: {
  expanded: string[];     // 相对路径目录
  selected?: string;      // 当前选中文件 path
  width: number;          // 钳在 min/max
  childrenCache?: Record<string, DirEntry[]>;
}
```

打开 `fileView.path` 且位于 workdir 下时：合并展开祖先目录并设 `selected`。用户手动折叠后，仅在「打开路径变化」时再次 ensure-expand。

### 5.4 预览渲染

| 类型 | 行为 |
|------|------|
| 代码 | Shiki `github-light` / `github-dark`；保留行号与 `startLine`/`endLine` |
| Markdown | 默认 Preview（marked + DOMPurify）；Source 用 Shiki |
| 图片 | `<img>` |
| unsupported | 文案 +「在 Finder 中显示」 |

从 `FilePane` 移除 highlight.js 依赖（若仓库别处仍用则保留包）。

语言：常用子集即可；未知扩展纯文本。

## 6. 边界情况

| 情况 | 行为 |
|------|------|
| 无 workdir | 不渲染树；预览仍可走消息 openFile（若 host 允许） |
| 大目录 | 虚拟列表 + 单层懒加载 |
| gitignore 失败 | 硬编码 skip |
| 路径不在 workdir | 路径栏绝对路径；树不强制选中；仍可 reveal |
| 换 workdir | 切换该 workdir 的 tree 缓存；无则仅根 |
| 读失败 / 文件已删 | 左侧 error |
| 图片 >1MB | unsupported + Finder |
| 行号跳转 | 仅 code / markdown source；preview 模式不跳 |

## 7. 非目标

- 文件增删改、拖拽移动、重命名、多选  
- 文件监视 / 自动刷新  
- SSH/远程文件树  
- 可点击面包屑  
- Shiki 全语言包  
- 磁盘持久化树状态  

## 8. 测试

- Host：`>1MB` / 二进制 → `unsupported`；gitignore 过滤；`revealInFinder`  
- Webview：展开/选中、ensure-expand、相对/绝对路径、md 切换、主题切换 shiki theme、树宽拖拽钳制  
- 回归：消息 `openFile` 仍填预览；更新 `filePane` 单测与相关 demo  

## 9. 实现顺序（建议）

1. Host：1MB + `unsupported` + `revealInFinder` + `desktopListDir`（gitignore）  
2. Webview：`FileIcon` + `FileTree`（虚拟列表、宽度拖拽、状态）  
3. `FilePathBar` + `FilePreview`（Shiki / md 切换 / unsupported UI）  
4. `FilePane` 组装与 ChatApp 接线  
5. 测试与 demo 更新  
