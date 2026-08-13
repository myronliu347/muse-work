# @ 提及：目录钻入 + 全局搜索

**日期**：2026-08-13  
**状态**：待评审  
**来源**：对话确认（级联浏览 + 全局搜索列表，目录可选）

## 1. 目标

输入 `@` 提及工作区文件或目录时：

- **未继续打字**：按当前目录一层层浏览（目录在前），可进入子目录，也可直接选中目录。
- **开始打字**：切成全局模糊搜索列表；名称在左、相对路径在右（参考 Cursor/VS Code 提及列表）。
- 忽略 `.git`、`node_modules` 等（沿用 `searchWorkspaceFiles` 的 `SKIP_DIR_NAMES` 与点开头目录规则）。
- 选中后仍插入现有 `[@file:path]` 标签；目录 `relativePath` 带尾斜杠。

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| 浏览交互 | 同一弹层钻入，顶上面包屑；不采用树展开、不多列级联 |
| 浏览路径 | 弹层内部状态 `browsePath`，**不**写进输入框 |
| 模式切换 | `filterText` 为空 → 浏览；非空 → 搜索。清空输入后回到**工作区根**浏览 |
| 选中目录 | Enter / 点击名称 → 插入提及 |
| 进入目录 | → / 行尾箭头 → 进入该层，不插入 |
| 返回 | ← ；输入仍为单独 `@` 时 Backspace 也返回上一层 |
| 搜索排版 | 一行：图标 · 名称 · 右侧灰色路径 |
| 插入格式 | 不变：`[@file:src/foo.ts]` / `[@file:src/components/]` |

## 3. 范围

**做**

- `FileSuggestionDropdown`：浏览头（面包屑 + 当前层列表）与搜索行布局。
- `MessageInput`：维护 `browsePath`；空 `@` 请求当前层子项；有 filter 走全局搜索；键盘 → ← Enter。
- 桌面 `requestFileSuggestions`：增加可选 `dir`（相对工作区路径）。空 query 时只列该目录的直接子项；有 query 时忽略 `dir`，全库搜索。
- `fileSearch.ts`：抽出 `listWorkspaceDir`；搜索逻辑保持并保证目录出现在结果里。

**不做**

- 不改 `[@file:…]` 解析、消息里的 ContextTag、点击打开文件。
- 不做多列 Finder、不做树形无限展开。
- 不把浏览路径同步成 `@src/foo` 文本。
- 本轮不改 IDE/VSCE host（若无同等 `dir` 字段，空 `@` 可继续返回现有扁平列表；桌面是主路径）。

## 4. 交互

### 4.1 浏览（`filterText === ""`）

1. 打开后 `browsePath = ""`，列表为工作区根下直接子项，目录在前、文件在后，按名称排序。
2. 顶栏面包屑：`工作区 / src / components`。点击某一段回到该层。
3. 目录行右侧显示 `codicon-chevron-right`。
4. 键盘：↑↓ 高亮；Enter 选中高亮项（文件或目录）；→ 若高亮为目录则进入；← 或根以外的 Backspace 返回父目录。
5. 空目录显示「此目录为空」。

### 4.2 搜索（`filterText` 非空）

1. 丢弃当前 `browsePath`（下次空 `@` 从根开始）。
2. 列表为全局模糊匹配，最多 20 条；目录可出现。
3. 每行：`[icon] name …… relativePath`（路径右对齐、灰色、可截断）。
4. Enter / 点击插入该项。无匹配时显示「未找到匹配的文件」。

### 4.3 插入

与现有一致：去掉 `@…`，插入不可编辑的 file chip。目录使用已有的 `isDirectory` + 尾斜杠路径。

## 5. 数据流

```
MessageInput
  filterText empty → post requestFileSuggestions { filterText: "", dir: browsePath }
  filterText set   → post requestFileSuggestions { filterText, dir omitted }
workdirHost
  query empty → listWorkspaceDir(workdir, dir)
  query set   → searchWorkspaceFiles(workdir, { query, maxResults: 20 })
  skip        → 同一套 SKIP_DIR_NAMES / 点开头目录
```

`listWorkspaceDir` 不递归。不存在的 `dir` 返回 `[]`。

## 6. 测试

- `fileSearch`：`listWorkspaceDir` 只返回直接子项；跳过 `node_modules` / `.git`；可返回目录。
- `FileSuggestionDropdown`：空 filter 显示面包屑与进入箭头；有 filter 为名称+右侧路径，无箭头。
- `MessageInput` / fileMention：Enter 选中目录会插入 `[@file:…/]`；→ 进入后列表变为子项。
- 现有 file mention / directory mention 展示测试保持通过。

## 7. 错误与空态

| 情况 | 表现 |
|---|---|
| 无 workdir | 空列表，不报错 |
| 列目录失败 | 空列表（与现有 search catch 一致，可走 `fileSuggestionsError`） |
| 搜索中 | 「正在搜索文件...」 |
| 搜索无结果 | 「未找到匹配的文件」 |
