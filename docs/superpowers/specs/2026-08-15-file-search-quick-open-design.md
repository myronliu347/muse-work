# 文件内容搜索 + ⌘P 快速打开

**日期**：2026-08-15  
**状态**：已确认（对话定稿）  
**范围**：`packages/webview`（File 面板侧栏 / Quick Open / ChatApp 快捷键）、`packages/desktop`（内容搜索 IPC / 文件名搜索）

## 1. 目标

1. **文件内容搜索**：File 面板右侧在「文件树 / 内容搜索」间切换；按文件分组展示命中行；支持大小写、整词、正则。  
2. **⌘P 快速打开**：仅会话页；在当前 workdir 下按文件名模糊检索；Enter 打开到 File 面板预览。

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| 内容搜索位置 | File 面板右侧栏内，与文件树互斥切换 |
| 模式切换 | 顶栏两个 icon（树 / 搜索），记住当前模式（按 workdir） |
| 搜索开关 | 一期做：大小写、整词、正则 |
| 实现 | Node 文本扫描；不用 ripgrep |
| ⌘P 范围 | 仅会话页（非新会话欢迎页等）；Mac ⌘P / Win Ctrl+P |
| 打开行为 | `tryOpenPanel("file")` + `openFile`（内容搜索带 `startLine`） |
| 过滤 | 与文件树相同的 gitignore（停在 repo root） |
| 持久化 | 仅内存（panel group / workdir） |

## 3. 布局与组件

### 3.1 File 右侧栏

```
┌─ [icon] workdir  [tree][search] ─┐
│ tree: 虚拟文件树                  │
│ search:                           │
│   [ query ........ ] [Aa][W][.*]  │
│   N results in M files            │
│   ▾ path/to/file.ts          (3)  │
│       …highlighted match line…    │
└───────────────────────────────────┘
```

| 组件 | 职责 |
|------|------|
| `FileTree` header | workdir 名 + 模式切换按钮 |
| `FileContentSearch` | 输入、三开关、结果列表、展开/折叠 |
| `QuickOpenPalette` | ⌘P 浮层：输入 + 文件列表 |

### 3.2 ⌘P

- 会话页 `ChatApp` 注册快捷键（不与 ⇧⌘P Preview 冲突）  
- Esc 关闭；↑↓ 选择；Enter 打开  
- 无 workdir：不打开浮层，或打开后空态提示  

## 4. Host API / 数据流

### 4.1 复用

- 文件名模糊：扩展/复用 `searchWorkspaceFiles`（⌘P，`maxResults` 可调至 ~50）  
- 打开：`openFile` → `desktopFileContent`

### 4.2 新增 `desktopSearchContent`

**请求**

```ts
{
  command: "desktopSearchContent";
  requestId: string;
  workdir: string;
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}
```

**响应**

```ts
{
  command: "desktopSearchContentResult";
  requestId: string;
  results: Array<{
    path: string;
    relativePath: string;
    matches: Array<{
      line: number; // 1-based
      text: string; // 单行原文（可截断）
      startCol: number; // 0-based
      endCol: number;
    }>;
  }>;
  totalMatches: number;
  truncated?: boolean;
  error?: string; // 如非法正则
}
```

**扫描规则**

- gitignore 与文件树一致（repo root 为止；非 git 仅 workdir `.gitignore`）  
- 跳过二进制；单文件 ≤ 1MB  
- 封顶：例如最多访问 5000 文件、2000 命中  
- `regex: true` 时用 `RegExp`；非法 → `error`，不抛崩  
- 整词：非正则时用边界；正则时由用户自写 `\b`  

### 4.3 Webview 状态

挂在 `panelGroupStore` 的 workdir group：

```ts
fileSidebarMode: "tree" | "search";
contentSearch: {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  results: ContentSearchFileHit[];
  expandedFiles: string[]; // relative paths
  loading: boolean;
  error?: string;
  truncated?: boolean;
  requestId?: string;
};
```

换 workdir：重置为 `tree`，清空搜索结果。

## 5. 边界情况

| 情况 | 行为 |
|------|------|
| 无 workdir | 搜索态提示；⌘P 不响应或空态 |
| 空 query | 内容搜索不请求；⌘P 列表为空 |
| 非法正则 | 显示 error，保留上次结果 |
| 大仓库 | `truncated` 提示 |
| 点命中行 | 打开文件 + `startLine`；树 ensure-expand |
| 防抖 | 输入 ~200–300ms 后再请求；忽略过期 `requestId` |

## 6. 非目标

- ripgrep / 后台索引  
- Search & Replace  
- 搜索历史磁盘持久化  
- 多 workdir 并行搜  
- ⌘P 打开非 File 面板目标（始终 File 预览）  

## 7. 测试

- Host：大小写 / 整词 / 正则；gitignore；封顶；非法正则；workdir 入参  
- Webview：模式切换；结果展开；点行 openFile；三开关触发重搜；⌘P 开/关/导航/Enter  
- 回归：文件树、@ 提及、⇧⌘P 面板快捷键  

## 8. 实现顺序（建议）

1. Host `searchContentInWorkspace` + IPC + 测试  
2. `FileContentSearch` UI + panel 状态 + 接线  
3. 模式切换按钮接入 `FileTree` header  
4. `QuickOpenPalette` + ⌘P 快捷键  
5. 回归与 demo（可选）  
