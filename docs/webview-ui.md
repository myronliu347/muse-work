---
version: alpha
name: Muse-webview
description: 桌面端对话界面。页面是近白或近黑的底，卡片用细边框从底上抬起来，不靠投影。强调色默认靛蓝，只用于焦点和主操作。正文是 12px 系统字体。输入框、任务列表、排队消息共用一张圆角表面，中间用一条直角贴齐的分隔线切开。

colors:
  canvas: "#fcfcfc"
  canvas-dark: "#0c0c0c"
  canvas-fallback: "#fcfcfc"
  canvas-fallback-dark: "#0c0c0c"
  surface-card: "#ffffff"
  surface-card-dark: "#1a1a1a"
  surface-sidebar: "#f1f1f4"
  surface-rail: "#ebebeb"
  surface-bubble: "#f0f0f0"
  surface-bubble-dark: "#222222"
  surface-hover: "#e8e8e8"
  surface-hover-dark: "#2a2a2a"
  ink: "#202020"
  ink-dark: "#eeeeee"
  body: "#5e5e5e"
  body-dark: "#bbbbbb"
  muted: "#6c6c6c"
  muted-dark: "#9a9a9a"
  hairline: "#e4e4e4"
  hairline-dark: "#2b2b2b"
  accent: "#3e63dd"
  on-accent: "#ffffff"
  semantic-success: "var(--green-11)"
  semantic-progress: "var(--accent-11)"

typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0.0025em
  body-medium:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.0025em
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0
  code:
    fontFamily: "Menlo, Monaco, 'Courier New', monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: -0.007em
  icon:
    fontFamily: "codicon"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: 0

rounded:
  none: 0px
  xs: "var(--radius-1)"
  sm: "var(--radius-2)"
  md: "var(--radius-3)"
  lg: "var(--radius-4)"
  xl: "var(--radius-5)"
  composer: 16px
  pill: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  base: 16px
  md: 24px
  lg: 32px
  xl: 40px
  xxl: 48px
  section: 64px

components:
  page:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  sidebar:
    backgroundColor: "{colors.surface-sidebar}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  composer:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.composer}"
    padding: 12px 12px 10px
  composer-lead:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.body-medium}"
    rounded: "{rounded.none}"
    padding: 8px 12px 12px
  user-message:
    backgroundColor: "{colors.surface-bubble}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  code-block:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: 12px
  inline-code:
    backgroundColor: "{colors.surface-bubble}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.xs}"
    padding: 0.1em 0.35em
  dialog:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 16px
---

## Overview

Muse 的界面是一块安静的工作台，不是营销页。底色用 `{colors.canvas}`，卡片用 `{colors.surface-card}` 加 1px `{colors.hairline}` 边框抬起来。默认强调色是靛蓝 `{colors.accent}`，只用在焦点环和主操作上。

字号以 `{typography.body}` 为准，12px。标题才用 `{typography.title}`。用户可以在设置里改强调色、灰阶、圆角和缩放，所以上面的色值是默认灰阶、缩放 100% 的快照。写样式时用 CSS 变量，不要把这些 hex 再抄进组件。

**Key Characteristics:**

- 浅色底近白，深色底近黑。卡片靠边框分开，不靠大块灰底。
- 浅色卡片是白的 `{colors.surface-card}`。深色卡片是 `{colors.surface-card-dark}`，比画布亮一档。
- 用户消息气泡用 `--surface-user-bubble`（浅色 `--accent-3`，深色 `--gray-4`），不要跟卡片同色。
- 输入框圆角写死 `{rounded.composer}`。其余圆角走 `{rounded.*}`，会随设置变化。
- 对话列最宽 800px，水平居中。
- 滚动条平时不画轨道，只有滚动时才露出滑块。

## Colors

色值是 A 阶梯默认主题的快照：灰阶 Gray，强调色 Indigo，缩放 100%。深色列在同名 token 的 `-dark` 上。A 阶梯在 `tokens.css` 末尾按主题覆盖，仍从 `--gray-*` 派生，所以用户改灰阶继续生效。

### Surface

- **Canvas** (`{colors.canvas}` — #fcfcfc)：浅色页面，走 `--surface-canvas`（A 阶梯默认取 `--gray-1`）。首帧还没有 Radix 变量时用 `{colors.canvas-fallback}`。
- **Canvas Dark** (`{colors.canvas-dark}` — #0c0c0c)：深色页面。`--surface-canvas`，A 阶梯取 `--gray-1` 70% + 黑。
- **Surface Card** (`{colors.surface-card}` — #ffffff)：浅色卡片、对话框、菜单、输入框。`--color-card`，浅色等于 `--color-panel`。
- **Surface Card Dark** (`{colors.surface-card-dark}` — #1a1a1a)：深色卡片。`--surface-card`，A 阶梯取 `--gray-3` 75% + 黑。
- **Surface Sidebar** (`{colors.surface-sidebar}` — #f1f1f4)：图标栏和标题栏用 `--surface-rail`（`{colors.surface-rail}`），会话列表用 `--surface-session-list`，内容区用 `--surface-canvas`。三层从外到内逐级提亮：rail → 会话列表 → 画布；面板仍走 `--surface-panel`。
- **Surface Bubble** (`{colors.surface-bubble}` — #f0f0f0)：这是行内代码和分段控件槽的默认值，走 `--surface-inline-code`；用户消息走 `--surface-user-bubble`（浅色 `--accent-3`，深色 `--gray-4`）。
- **Surface Code**：代码块用 `--surface-code`（浅色 `--gray-3` 70% + `--gray-2`；深色 `--gray-2` 88% + 黑），不要和页面同白或同黑。
- **Surface Hover** (`{colors.surface-hover}` — #e8e8e8)：悬停。A 阶梯浅色用 3.5% 黑，深色用 4.5% 白；白底卡片上的悬停仍用 `{colors.surface-bubble}`。

### Hairlines

- **Hairline** (`{colors.hairline}` — #d9d9d9)：卡片描边，1px `--gray-6`。
- **Hairline Dark** (`{colors.hairline-dark}` — #3a3a3a)：深色描边。
- 列表里的分隔线用 `--hairline`：普通屏 1px，2x 屏 0.5px。

### Text

- **Ink** (`{colors.ink}` — #202020)：正文。`--gray-12`。深色是 `{colors.ink-dark}`。
- **Body** (`{colors.body}` — #5e5e5e)：说明、路径、时间。`--text-secondary`（浅色 `--gray-11` 94% + 黑，深色 88% + 白）。
- **Muted** (`{colors.muted}` — #6c6c6c)：更弱的信息。文字用 `--text-tertiary`（浅色 `--gray-11` 95% + `--gray-1`；深色 84% + `--gray-1`），不要再用 `--gray-9` 写 12px 正文；`--gray-9` 只留 disabled 和图标。
- **On Accent** (`{colors.on-accent}` — #ffffff)：强调色上的字。

### Accent

- **Indigo** (`{colors.accent}` — #3e63dd)：默认 `--accent-9`。焦点环和主操作。用户改强调色后这个 hex 会变；组件写 accent 角色（`--action-primary-*` / `--selection-indicator` / `--focus-*`），不要直接写 primitive。

`--color-card` 定义在 `.radix-themes` 上，不要写到 `:root`。Radix 的浅色灰阶挂在 `:root`，深色灰阶挂在 `.dark`。变量如果在 `:root` 上解析，会固定成浅色的 `#f0f0f0`，深色主题盖不住。

### Semantic tokens

组件不直接写 `--gray-*` / `--accent-*`。基础角色集中定义在 `packages/webview/src/styles/tokens.css`，并且**定义在 `.radix-themes` 上**——这样深色灰阶和用户选的灰阶都能生效。`.radix-themes` 的作用域原因见本节末尾。

| 组 | Token | 默认映射 | 用途 |
|---|---|---|---|
| Text | `--text-primary` | `--gray-12` | 正文、标题 |
| | `--text-secondary` | `--gray-11` | 说明、路径、时间 |
| | `--text-tertiary` | `--gray-11` 95% + `--gray-1` | 低优先标签；12px 仍 ≥4.5 |
| | `--text-placeholder` | `--text-tertiary` | 输入占位 |
| | `--text-disabled` | `--gray-9` | 仅 disabled |
| | `--text-on-accent` | `--accent-contrast` | 强调色上的字 |
| | `--text-link` | `--accent-11` | 链接 |
| Surface | `--surface-canvas` | `--color-background` | 页面、聊天列 |
| | `--surface-rail` / `--surface-header` | 浅色 `--gray-3` 98% + 黑；深色 `--gray-2` 95% + 黑 | 图标栏、标题栏 |
| | `--surface-session-list` | 浅色 `--gray-3` 90% + 白；深色 `--gray-3` 50% + `--gray-2` | 会话列表 |
| | `--surface-panel` | 浅色 `--gray-3`；深色 `--gray-2` 75% + 黑 | 面板、对话框 |
| | `--surface-card` | `--color-card` | 卡片、输入框、对话框 |
| | `--surface-sunken` / `--surface-subtle` / `--surface-muted` | `--gray-1` / `--gray-3` / `--gray-4` | 内凹底 / 低强调填充 / 悬停底 |
| | `--surface-hover` / `--surface-visible` | 3.5–4.5% 黑/白 / 2–2.5% | 悬停、非焦点分屏 |
| | `--surface-raised` / `--surface-active` | `--gray-4` / `--gray-5` | 浮层操作条 / active tab、图标栏、选中行 |
| | `--surface-control` / `--surface-strong` / `--surface-strong-hover` | `--gray-6` / `--gray-8` / `--gray-9` | 开关轨道 / 强填充按钮与徽章 / 其悬停 |
| | `--surface-knob` | `#ffffff` | 开关滑块，两个主题都保持白 |
| | `--surface-code` | `--gray-3` 75% + `--gray-2` | 代码块 |
| | `--surface-inline-code` | `--gray-3` | 行内代码 |
| | `--surface-user-bubble` | `--accent-3`（浅）/ `--gray-4`（深） | 用户消息 |
| | `--surface-user-bubble-hover` | `--accent-4`（浅）/ `--gray-5`（深） | 用户消息悬停 |
| Shadow | `--shadow-color-soft` / `--shadow-color` / `--shadow-color-strong` | 黑 18% / 30% / 42% | 浮层阴影颜色；offset/blur 留在组件 |
| | `--shadow-glow-soft` / `--shadow-glow` / `--shadow-glow-strong` | `--gray-1` 28% / 40% / 45% | 卡片/输入框的 canvas glow |
| | `--ring-color` | `--gray-2` | 2px 选中环 |
| Overlay | `--overlay-scrim` / `--overlay-scrim-strong` | 黑 40% / 85% | 模态遮罩 / 图片与图表全屏层 |
| | `--overlay-backdrop` | `--gray-1` 40% | quick-open 等轻背板 |
| | `--overlay-control-soft` / `--overlay-control` | 白 10% / 20% | 图片上的悬浮控件 |
| Border | `--border-faint` / `--border-subtle` / `--border-strong` / `--border-emphasis` | `--gray-3` / `--gray-6` / `--gray-7` / `--gray-12` | 极弱分隔 / 卡片描边 / 强描边 / 高对比选中 |
| | `--border-focus` / `--border-selected` | `--accent-9` | 焦点、选中 |

- 所有结构性 1px 分割线（会话列表、dock、设置区、下拉头）统一用 `--border-subtle`；`--border-faint` 只给 tooltip 箭头，`--border-strong` 只给控件/卡片，不要拿来做分割线。
| Accent | `--action-primary-bg` / `--action-primary-bg-hover` / `--action-primary-fg` | `accent-9` / `accent-10` / `accent-contrast` | 主操作 |
| | `--selection-indicator` | `accent-9` | 选中/当前项 |
| | `--focus-ring` / `--focus-glow` | `accent-9` / `accent-a4` | 焦点描边 / 焦点 glow |
| | `--accent-text` / `--accent-border` | `accent-11` / `accent-8` | 强调文字 / 强调描边 |
| | `--accent-decorative` | `accent-9` | drag handle、unread dot、brand 图形 |
| | `--accent-soft` / `--accent-soft-hover` / `--accent-softest` | `accent-3` / `accent-4` / `accent-2` | 浅色强调底 |
| | `--accent-wash` / `--accent-wash-strong` | `accent-a2` / `a3` | alpha 强调底 |
| | `--accent-track` | `accent-5` | 轨道 / 滑轨 |
| Status | `--status-{neutral,progress,success,warning,danger,info}-{text,surface,border,solid}` | 对应 Radix 色阶；彩色 text 用 12 档 | 状态徽章、运行点、错误 |
| | `--status-danger-fill` / `fill-hover` / `on-fill` | `red-11` / `red-12` / 白·`#111` | 破坏性实心按钮 |

规则：

- 正文、说明、时间、占位都用 `--text-secondary` / `--text-tertiary`，不要回退到 `--gray-9`。12px 的 AA 门槛是 4.5:1。
- 卡片先靠 `--border-subtle` 抬起来；`--surface-*` 只负责区域之间的明度差，不叠加投影。
- 代码块用 `--surface-code`，行内代码用 `--surface-inline-code`；两者不要再共用页面的白/黑。
- 状态只用 `--status-*`，不要在组件里手写 `--red-11` / `color-mix(amber-9 …)`。
- accent 只用角色层：`--action-primary-*` / `--selection-indicator` / `--focus-*` / `--status-progress-*`；drag、unread、brand 才用 `--accent-decorative`。primitive（`--accent-9`、`--accent-a2`）只允许出现在 `tokens.css`。彩色状态文字用 12 档：11 档在浅色 tinted surface 上只有 4.2:1。
- 破坏性实心按钮用 `--status-danger-fill` + `--status-danger-on-fill`，不要用 `--status-danger-solid` 配白字：白字 on red-9 只有 3.9:1。
- 阴影只 token 化颜色（`--shadow-color-*`），offset / blur 留在组件；模态遮罩和图片悬浮控件用 `--overlay-*`。

`tests/muse/noRawColorTokens.test.ts` 会守住这条契约：CSS 里再写 raw gray / status / accent primitive / shadow / overlay / hex，或 TSX 里再写 raw gray / accent primitive / hex，测试直接失败。白名单只有 `tokens.css`、`globals.css`、`AppearanceSettings.css`、`TerminalPane.css`、`TerminalPane.tsx`、`PreviewPane.tsx`。

这一层是基础 token：组件迁移还在进行中，未迁移的样式仍会直接读 Radix step。新写或改动样式时用语义 token；`--gray-*` / `--accent-*` 只保留在 `tokens.css`、终端/预览适配器和第三方主题里。

已迁移：所有页面的文字、表面、边框、状态色、阴影、遮罩和 accent 角色。剩余白名单是 tokens 定义、globals 首帧、Appearance 预览和终端/预览适配器；`noRawColorTokens` 测试防止回退。accent 已拆成 primary / selection / focus / progress；`--accent-text/-border/-soft/-wash/-track` 仍是宽角色，装饰才用 `--accent-decorative`。

## Typography

### Font Family

界面用系统无衬线，和 `{typography.body}` 的 fontFamily 一致。代码用 `{typography.code}`。图标只用 codicon，颜色 `--gray-11`，不要再引一套图标字体。

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.body}` | 12px | 400 | 16px | 0.0025em | 界面正文和控件。`--font-size-1` |
| `{typography.body-medium}` | 12px | 500 | 16px | 0.0025em | 卡片标题，如「任务列表」 |
| `{typography.title}` | 14px | 400 | 20px | 0 | 对话框标题。`--font-size-2` |
| `{typography.code}` | 12px | 400 | 16px | -0.007em | 代码块、命令 |
| `{typography.icon}` | 16px | 400 | 1 | 0 | codicon。`--font-size-3` |

字号会乘以用户的缩放（90%–110%）。表里的 px 是缩放 100%。

### Principles

- 控件和正文同一档，不要再写 14px 的按钮字。Radix 默认 size 2 已在 `globals.css` 里拉回 `{typography.body}`。
- 代码表面用 `{typography.code}`，不要用界面字体。

## Layout

### Spacing System

- **Base unit:** 4px，再乘以缩放。
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.base}` 16px · `{spacing.md}` 24px · `{spacing.lg}` 32px · `{spacing.xl}` 40px · `{spacing.xxl}` 48px · `{spacing.section}` 64px。
- 对应 `--space-1` 到 `--space-9`。组件里写变量，不写裸 px。

### Grid & Container

- 对话列最大 800px，水平居中。
- 窗口左上圆角跟随最左侧面板：会话列表展开时在会话列表左上角，收起时在内容列左上角；定位用 `min(52px, --desktop-sidebar-width)`。
- 任务列表、排队消息、后台任务和输入框跟这一列对齐。
- 右侧消息刻度占 28px，输入区用同样的左右留白。

### Composer

任务列表、排队消息、后台任务出现在输入框上方时，收进 `{components.composer}` 这一张表面。上面的块用 `{components.composer-lead}`：自己不画边框、不铺另一层底。块与块之间、块与输入区之间各一条 `{colors.hairline}`，线贴到左右边框，接缝是直角。外轮廓仍是 `{rounded.composer}`。不要拆成两张圆角卡片。

### Scrollbars

轨道透明。元素滚动时挂上 `data-scrolling`，滑块出现，停下约 0.7 秒后消失。实现在 `globals.css` 和 `src/ui/scrollingScrollbar.ts`。

新的滚动区域只写 `overflow: auto`。不要再写 `::-webkit-scrollbar` 把滑块设成常驻颜色。

窄到放不下滚动条的地方（标签栏、消息刻度）用 `scrollbar-width: none`，再加上 `::-webkit-scrollbar { display: none; }`。

对话列表和助理记录保留 `scrollbar-gutter: stable`，避免滚动条出现时整列横跳。别的区域不要为了防抖动再留一条常驻槽。

## Elevation & Depth

深度靠边框和一档明度差，不靠投影。输入框单独存在时可以有很轻的阴影；一旦和任务列表合成一张表面，阴影去掉，只留边框。

| Level | Treatment | Use |
|---|---|---|
| Flat | `{colors.canvas}` | 页面、对话列 |
| Sidebar | `{colors.surface-sidebar}` | 浅色侧栏 |
| Card | `{colors.surface-card}` + 1px `{colors.hairline}` | 输入框、对话框、菜单 |
| Bubble | `--surface-user-bubble` / `--surface-inline-code` | 用户消息、行内代码 |
| Focus | 2px `{colors.accent}`，offset 2px | `:focus-visible` |

## Shapes

### Border Radius Scale

默认圆角档是 large，`--radius-factor` 为 1.5。用户改圆角后这些值会变。下表是档位，不是固定 px。

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | 合成表面内部的分隔 |
| `{rounded.xs}` | `--radius-1` | 行内代码 |
| `{rounded.sm}` | `--radius-2` | 小按钮、菜单项 |
| `{rounded.md}` | `--radius-3` | 用户消息、代码块 |
| `{rounded.lg}` | `--radius-4` | 独立小卡片 |
| `{rounded.xl}` | `--radius-5` | 较大的独立卡片 |
| `{rounded.composer}` | 16px | 输入框外轮廓。不跟圆角设置走 |
| `{rounded.pill}` | 9999px | 状态点、滚动条滑块 |

## Components

### Page

**`page`** — 背景 `{colors.canvas}`，字 `{colors.ink}`，字号 `{typography.body}`。浅色和深色都要看一眼。

### Sidebar

**`sidebar`** — 会话列表用 `{colors.surface-sidebar}`，图标栏和标题栏用 `{colors.surface-rail}`，内容区用画布色。会话列表右侧和右侧 dock 左边统一用 1px `--border-subtle`；浅色不要用 `--border-strong`，否则两条线颜色会不一致。默认宽 280px，可拖 180–400。

- 会话列表背景从 titlebar 下面开始（`background-clip: content-box`），不要把顶部 38px 也刷成列表色；header 横贯整宽。

- 图标栏 active、Tab active（Bot tab、面板 tab、文件 tab）、选中会话行统一用 `surface-active` 底；inactive 透明，hover 才用 `surface-muted`。
- Bot tab 只有一个可见 tab 时不画 active 底（`bot-tabs--single`），没有对比对象时不要出现一块灰。
- active 不再用 accent 浅底、白色 canvas 底或下划线，避免同一层级出现多种选中语言。

### Composer

**`composer`** — 背景 `{colors.surface-card}`，字 `{colors.ink}`，圆角 `{rounded.composer}`，1px `{colors.hairline}`。内边距 12px 12px 10px。这是输入框自己的表面。

**`composer-lead`** — 任务列表、排队消息、后台任务。背景和圆角都交给外层的 `composer`，自己透明、无边框。底边一条 `{colors.hairline}`，贴到左右边框，接缝是直角。下面才是输入区。

### Messages

**`user-message`** — 背景 `--surface-user-bubble`（浅色 `--accent-3`，深色 `--gray-4`），圆角 `{rounded.md}`，内边距 8px 12px。宽度自适应内容，上限 `min(680px, 85%)`，右对齐；吸顶用户条同样处理；系统注入行仍占满整列。浅色下必须能看见这层淡蓝。不要改成 `{colors.surface-card}`，否则和页面融在一起，悬停的 `{colors.surface-hover}` 会像突然多出来一块底。

顶上钉住的用户消息用同一层底，并保留 1px 边框。

### Code

**`inline-code`** — 背景 `--surface-inline-code`，字号 `{typography.code}`，圆角 `{rounded.xs}`。不要改成 `{colors.surface-card}`，否则嵌在句子里看不见。

**`code-block`** — 背景 `--surface-code`，1px `--border-subtle`，圆角 `{rounded.md}`，内边距 12px，字体 `{typography.code}`。

### Dialogs & Menus

**`dialog`** — 背景 `{colors.surface-card}`，1px `{colors.hairline}`，字号 `{typography.body}`。菜单同样。

## Do's and Don'ts

### Do

- 大块表面用 `--color-card`，并且把这个变量定义在 `.radix-themes` 上。
- 用户消息、行内代码、分段控件的槽继续用 `--gray-3`。
- 间距写 `--space-*`，圆角写 `--radius-*`。输入框外轮廓除外，写死 16px。
- 新的滚动区域只写 `overflow: auto`。
- 两种主题都看一眼再收工。

### Don't

- 不要把 `--color-card` 或别的主题色定义在 `:root` 上再引用 `--gray-*`。浅色灰阶会在那里被算死。
- 不要给浅色页面大面积铺 `--gray-3`。那是脏灰，不是卡片。
- 不要把任务列表和输入框做成两张卡片再拼边。接缝会露出底色，或者多出一条粗边。
- 不要再写一套常驻的 `::-webkit-scrollbar` 滑块颜色。
- 不要为了浅色把已经会变的变量再抄一遍同样的背景。
- 不要另引图标字体。用 codicon。

## Responsive Behavior

### Breakpoints

界面按桌面窗口缩放，不按营销页的断点重排。对话列到 800px 封顶，更窄时列宽跟着窗口走，左右留白保持。

| Name | Width | Key Changes |
|---|---|---|
| Narrow | 对话列 < 800px | 列宽收缩，输入框和任务列表仍与列对齐 |
| Desktop | 对话列 ≥ 800px | 列宽停在 800px，水平居中 |

### Touch Targets

桌面指针为主。焦点用 2px `{colors.accent}` 环，只在 `:focus-visible` 上出现。

### Collapsing Strategy

- 任务列表超过四行就在卡片内滚动，高度是 `4 * --line-height-1 + 3 * --space-2`，不要写死 px，否则会切出半行字。
- 窄标签栏不显示滚动条，用滚轮和程序滚动。

## Iteration Guide

1. 一次只改一个组件，先改 token，再改组件条目。
2. 颜色、间距、圆角用 `{token.refs}` 或对应的 CSS 变量，不要在组件里写新的 hex。
3. 变体写成 `components:` 里的另一条，例如 `composer` 和 `composer-lead`。
4. 输入框外轮廓用 `{rounded.composer}`。别的圆角用 `{rounded.*}`。
5. 动效尊重 `prefers-reduced-motion`。闪烁和滚动条淡出在这个媒体查询里关掉。
6. 改完用浅色和深色各看一次。浅色里不该出现大块灰底，深色里卡片不该变成白的。

## Known Gaps

- 色值是默认灰阶和靛蓝的快照。用户更换灰阶或强调色后，hex 会变，以 CSS 变量为准。
- 侧栏深色、设置页、文件树还没有逐组件收进 `components:`。
- 滚动条滑块的透明度跟 `--gray-12` 走，没有单独的色板条目。
