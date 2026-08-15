# Desktop Dock Chrome：Toggle / + 加面板 / Tab 关闭叠层 / 全屏

**日期**：2026-08-15  
**状态**：已确认（对话定稿）  
**范围**：`packages/webview`（`DesktopPanelDock`、`PanelToggleControl`、`PanelToggleMenu` / 加面板菜单、`panelTabs`、`panelGroupStore`、`ChatApp` 编排与样式）

## 1. 目标

1. 侧栏按钮**不再**打开 dropdown；点击 **toggle 整列右侧 dock**。首次无历史时默认打开 **变更**；有关闭前 tabs 记录则恢复。
2. Dock tab 栏右侧增加 **`+`**，用于添加尚未打开的面板；四个都开后 **`+` 隐藏**。
3. Tab hover / focus-within 时 **X 叠在 tab 上**（不挤开文字）。
4. `+` 菜单顺序固定：**文件 → 终端 → 浏览器 → 变更**。
5. 右侧 dock **整列**支持全屏（放大覆盖对话区），右上角图标切换；关 dock 后全屏状态不保留。

## 2. 决策

| 项 | 选择 |
|---|---|
| 实现路径 | 就地改造 `DesktopPanelDock` + `PanelToggleControl`（不新建独立 DockChrome 壳、不用 portal 拷贝面板） |
| 再次打开 | 恢复关闭前 `checked` + `active`；无记录则只开 `diff`（变更） |
| 全屏粒度 | Dock 级（所有面板共用），非单文件浮层、非 OS Fullscreen API |
| 全屏持久化 | 不持久化；关 dock 或 tabs 归零 → `dockFullscreen = false` |
| ESC 退全屏 | 不做（避免与终端/编辑抢键）；仅图标切换 |
| Tab 显示顺序 | 保持现有 `PANEL_TAB_ORDER`；仅 `+` 菜单用独立 `PANEL_ADD_ORDER` |

## 3. 交互与信息架构

### 3.1 侧栏 Toggle（无 caret / 无 dropdown）

- **关闭 → 打开**：若有 `collapsedTabs` 则恢复 tabs + active；否则 `tryOpenPanel('diff')`。
- **打开 → 关闭**：整列收起（`checked = []`，`active = null`）；写入 `collapsedTabs`；`dockFullscreen = false`；`mounted` 与面板内容缓存保留。
- 出现位置不变：无 dock 时在 `ChatHeader`；有 dock 时在 dock 右上角。

### 3.2 Dock Header 布局（左 → 右）

`[已开 tabs…]` `[+]`（未满才显示）`…spacer…` `[全屏]` `[侧栏 toggle]`

### 3.3 `+` 菜单

- 只列出尚未在 `checked` 中的面板；顺序：`file` → `terminal` → `preview` → `diff`。
- 点一项：加入 tab 并激活，菜单关闭。
- 可保留快捷键文案；键盘快捷键仍按现逻辑 **toggle 对应单面板**（与菜单「只加不关」不同，属有意保留）。
- `disabled` 面板不出现在菜单；快捷键对其仍 no-op。

### 3.4 Tab

- Hover / focus-within：关闭按钮绝对定位叠在 tab 内容上。
- 点 X：关闭该 tab；若结果 `checked.length === 0`，等同关 dock（写 `collapsedTabs`、清全屏）。

### 3.5 全屏

- 图标：`codicon-screen-full` ↔ `codicon-screen-normal`；tooltip「全屏」/「退出全屏」。
- 全屏时 dock 占满 `desktop-chat-body`（覆盖/压缩左侧对话区）；禁用或隐藏左侧拖拽调宽。
- 退出全屏后恢复原 `widths[active]`。

## 4. 状态与数据流

### 4.1 `PanelGroupState` 增量

| 字段 | 含义 |
|---|---|
| `collapsedTabs` | 关 dock 时缓存：上次 `checked` + 当时 `active` |
| `dockFullscreen` | 仅会话 UI 态；关 dock / tabs 归零时强制 `false`，不写入持久化 |

其余 `checked` / `mounted` / `active` / `widths` 等语义不变。

### 4.2 核心动作

1. **`toggleDock()`** — 侧栏按钮唯一行为（见 §3.1）。
2. **`addPanel(kind)`** — 仅当未在 `checked`：走现有 `tryOpenPanel`（首次开 dock 仍做空间校验）。
3. **`closeTab(kind)`** — 同现关闭路径；归零时同步清全屏并写 `collapsedTabs`。
4. **`setDockFullscreen(bool)`** — 仅 `checked.length > 0` 时可为 true。

### 4.3 组件职责

| 组件 | 职责 |
|---|---|
| `PanelToggleControl` | 只 toggle dock；去掉 menu 与 chevron |
| `PanelAddMenu`（由 `PanelToggleMenu` 演化或旁路） | 只列未打开项 + `PANEL_ADD_ORDER` |
| `DesktopPanelDock` | tabs / + / 全屏 / toggle；接收 `fullscreen` + `onToggleFullscreen` |
| `ChatApp` | 编排上述动作；Header 仅在无 dock 时挂 toggle |
| `panelTabs.ts` | 新增 `PANEL_ADD_ORDER`；tab 显示序不变 |

## 5. UI / CSS

- Tab：`.desktop-panel-tab { position: relative }`；close 绝对定位叠层；默认 `opacity: 0`，hover/focus-within 显示（可加轻微遮罩保证 X 可读）。
- `+`：与 tab 同高的 icon 按钮；菜单锚定其下方，复用现有 menu 样式，无「已选」checkbox 态。
- 全屏 class（如 `desktop-panel-dock--fullscreen`）：`flex: 1; width: 100%; max-width: none`；按需隐藏/压缩 `desktop-chat-main`。

## 6. 边界

- 已开 dock 再经 `+` 加 tab：不重算列宽（与现多 tab 行为一致）。
- 全屏下点 toggle 或关光 tabs：退出全屏 + 关 dock。
- 非 desktop：无改动。

## 7. 非目标

- 持久化全屏状态  
- 修改 tab 栏显示顺序常量  
- OS / 浏览器 Fullscreen API  
- ESC 全局退出全屏  
- VS Code / 非 Electron 宿主专项适配  

## 8. 测试

- Toggle：无历史 → 开 `diff`；有 `collapsedTabs` → 恢复；再 toggle → 缓存并清空 `checked`，`dockFullscreen === false`
- `+`：菜单顺序与过滤；四项全开后 `+` 不渲染
- Tab close 叠层：结构 / class 断言
- 全屏：class 切换；关 dock 后复位
- 回归：快捷键仍 toggle 单面板；关最后 tab = 关 dock
