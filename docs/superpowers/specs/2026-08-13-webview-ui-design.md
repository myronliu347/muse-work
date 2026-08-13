# Webview UI 重构设计

**日期**：2026-08-13  
**状态**：已评审（2026-08-13 对话确认）  
**原型**：[docs/superpowers/prototypes/2026-08-13-webview-form-ds.html](../prototypes/2026-08-13-webview-form-ds.html)

## 1. 目标

- 用 `@radix-ui/themes` 统一 webview 视觉：红强调色、灰阶、实心面板、大圆角。
- 支持 **Dark / Light**；设置页可选择 **跟随系统（默认）**、**固定浅色**、**固定深色**。
- 先落地 **表单 design-system** 和 **设置页**，再按同一套 token 修正应用页 chrome（侧栏、顶栏、消息、输入框）。
- 动效用 `motion`（`motion/react`）弹簧，不引入 2017 的 `react-motion`。

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| 组件库 | `@radix-ui/themes`（对话里的 rax-ui Theme API 即此库） |
| Theme | `accentColor="red"` · `grayColor="gray"` · `panelBackground="solid"` · `radius="large"` |
| 动效库 | `motion`（原 Framer Motion），不用 `react-motion` |
| 主题偏好 | `system` \| `light` \| `dark`，默认 `system` |
| 外观切换 | **立即生效**，不走供应商「保存」 |
| 强调色用法 | 发送按钮、输入焦点、未读点、主按钮、选中的外观卡片、Tab 下划线。当前会话用灰色底，不强刷红 |
| 信息架构 | 不改：240px 侧栏、Pin / 工作空间、顶栏、800px 对话列、底部 composer |
| 迁移策略 | Radix token 与现有 `--vscode-*` 并存；表单先换组件，应用页只换 token / 圆角 / 焦点 / 发送按钮 |
| 取代 | FR-016「desktop 只跟 OS、无应用内偏好」作废；`data-theme` 仍表示 **effective**（FR-018） |

## 3. 范围

**做**

- 根节点包 `Theme`；appearance 由偏好解析。
- 表单控件：Button、TextField、Select、TextArea、Radio 卡片、Switch、Callout、Progress、Dialog。
- `ConfigDialog`：标题改为「设置」；Tab **外观** / **供应商**。
- 桌面主界面 chrome 换 token（侧栏、Header、消息气泡、composer）。
- Dialog 进场弹簧、Switch 滑块、Tab 下划线。

**不做**

- 不改会话树 / 分屏 / 发消息 / 供应商保存语义。
- 不重写 Message 内部工具时间线、Diff、Terminal、Mermaid 的交互。
- 不做页面级路由转场。
- 不把聊天主界面改成另一套布局。

## 4. 主题模型

```ts
export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

export type ThemeState = {
  preference: ThemePreference;
  effective: EffectiveTheme;
};
```

**解析**

| preference | effective |
|---|---|
| `light` | `light` |
| `dark` | `dark` |
| `system` | 桌面：`prefers-color-scheme`；VS Code / JetBrains：现有 `isDarkTheme()`（body 的 `vscode-dark` / `data-theme`） |

`system` 时订阅 `matchMedia("(prefers-color-scheme: dark)")`（及 VSCE body class / `data-theme` MutationObserver），系统一变立刻重算。

**应用到 DOM**

1. `<Theme appearance={effective} ...>` 只传 `"light"` 或 `"dark"`，不传 `inherit`。`system` 只影响 **如何算出** effective，避免和 `html` 上的 class 抢真相。
2. 同步 `document.documentElement.dataset.theme = effective`，现有 `--vscode-*` 两套 CSS（`theme-base-light.css` / `theme-base-dark.css`）继续按 FR-018 切换。
3. `isDarkTheme()` 继续读 body class 与 `data-theme`，Mermaid / xterm 不用改探测方式。

## 5. 持久化与桌面窗体

**Webview 缓存**：`localStorage["muse.themePreference"]`，缺省 `"system"`。

**Desktop 权威源**：`~/.muse-work/ui.json`（见下）。启动时 preload 把文件里的 preference 注入 `window.__MUSE_THEME_PREFERENCE__`，并在 React 前写好 `html[data-theme]`，避免第一帧闪错色。`MuseTheme` 初始化顺序：注入值 → localStorage → `"system"`。变更时：先写 localStorage，桌面再 IPC 回写 `ui.json`。

- 文件：`~/.muse-work/ui.json`

```ts
type UiPrefsFile = {
  version: 1;
  themePreference: ThemePreference;
};
```

- 启动：main 读该文件，调用 `nativeTheme.themeSource = preference`（`"system" | "light" | "dark"`），再创建窗口。
- `BrowserWindow.backgroundColor`：effective light 用 `#fcfcfc`，dark 用 `#111111`。
- 设置页改偏好：webview `postMessage({ command: "desktopSetThemePreference", preference })` → main 写 `ui.json` + 更新 `nativeTheme.themeSource` + 窗口 backgroundColor。
- `desktopThemeChange` 仍在 `nativeTheme.updated` 时推 `{ effective }`，供 xterm / Mermaid 刷新；若当前 preference 不是 `system`，webview 忽略这次 effective，避免覆盖用户固定的 light/dark。

**VS Code / JetBrains**：只写 localStorage；无 Electron IPC。`system` 跟随宿主编辑器主题。

## 6. 组件与目录

不包一层巨型 DS。Radix 组件直接用；只加布局胶水。

| 文件 | 职责 |
|---|---|
| `packages/webview/src/ui/theme.tsx` | `MuseTheme`：读偏好、订阅系统、包 `Theme`、写 `data-theme`、桌面 IPC |
| `packages/webview/src/ui/themeStorage.ts` | localStorage 读写；`resolveEffectiveTheme(preference, isSystemDark)` |
| `packages/webview/src/ui/Field.tsx` | label + control + hint + error 垂直布局 |
| `packages/webview/src/index.tsx` | 根上包 `MuseTheme` |
| `packages/webview/src/components/ConfigDialog.tsx` | 「设置」+ 外观 / 供应商 tabs |
| `packages/webview/src/components/AppearanceSettings.tsx` | 三张外观卡片，改偏好立即生效 |
| `packages/webview/src/components/MuseProviderSettings.tsx` | 原生 input/select 换成 Radix 表单控件，保存逻辑不动 |
| `packages/webview/src/styles/DesktopApp.css` 等 chrome CSS | `--vscode-*` 逐步改为 Radix CSS 变量（`--gray-*` / `--accent-*` / `--radius-*`） |

根用法：

```tsx
<Theme
  accentColor="red"
  grayColor="gray"
  panelBackground="solid"
  radius="large"
  appearance={effective}
>
  {children}
</Theme>
```

构建：`esbuild` 已打 IIFE bundle。`@radix-ui/themes/styles.css` 从 `index.tsx` import，随 JS 一起打进 `chat.js`（或单独 css entry，与现有 `globals.css` 相同路径即可）。

## 7. 设置页

```
设置
  [外观] [供应商]
  …tab 内容…
  [关闭] [保存]
```

- **外观**：三张卡片（跟随系统 / 浅色 / 深色）。点击即 `setPreference`。文案：「未设置时跟随操作系统。切换立即生效，无需点保存。」保存按钮对此外观无操作（仍只提交供应商 draft）。
- **供应商**：现有 Provider / API URL / API Key / Model 列表 / CodeMaker 额度。脏检查与「有未保存的修改，确定关闭？」不变。
- Dialog 用 Radix `Dialog`；进场 `motion`：`opacity 0→1`，`scale 0.96→1`，spring（stiffness ≈ 380，damping ≈ 28）。点遮罩 / Esc / 关闭：若供应商 dirty 则 confirm，逻辑保持现状。

## 8. 应用页 chrome

对照已确认原型，只换皮肤：

| 区域 | 变化 |
|---|---|
| 侧栏 240px | 背景 `--color-background` / `--gray-2`；hover `--gray-4`；当前会话 `--gray-4`；未读点 `--accent-9`；运行中 spinner 保持中性灰 |
| 顶栏 36px | 底边 `--gray-6`；图标按钮 hover `--gray-4` |
| 用户气泡 | `--gray-3`，圆角 `--radius-3` |
| 助手文本 | 默认前景；工具行 `--gray-11` + 时间线点 `--gray-8` |
| 代码块 | `--gray-3` 底 + `--gray-6` 边 |
| Composer | 边框 `--gray-6`；`:focus-within` `--accent-9`；发送 28×28 `--accent-9`，圆角 `--radius-2` |

新对话场景：工作目录 chip 留在 composer 顶部，不改选择逻辑。

## 9. 动效范围

只这三处用 `motion`：

1. **Dialog**：进场 scale + fade（见 §7）。
2. **Switch**：Radix Switch 自带动画即可；若观感不够再包 `motion` 滑块，不重复造控件。
3. **设置 Tab 下划线**：`layoutId` 滑到当前 tab。

其余 hover 用 CSS。尊重 `prefers-reduced-motion: reduce`：Dialog 改为 0ms opacity，不做 scale。

## 10. 错误处理

- `ui.json` 缺文件 / JSON 损坏：视为 `themePreference: "system"`，不抛到 UI。
- localStorage 不可用（隐私模式）：内存态，本次会话有效，刷新回 system。
- 桌面 IPC 失败：webview 仍立刻改 appearance；窗口底色可能暂时不一致，下次启动以 `ui.json` 为准。

## 11. 测试

- `themeStorage.ts`：`system`+dark media → dark；`light` 忽略 media；缺省 system。
- `AppearanceSettings`：点「深色」后 `html[data-theme="dark"]`，Radix appearance 为 dark；再点「跟随系统」恢复 inherit。
- `ConfigDialog`：外观 / 供应商 tab 切换；供应商 dirty 关闭仍 confirm；改主题不使供应商 dirty。
- 现有 `configDialog.test.tsx`、`museProviderSettings.test.tsx`、`desktopApp.test.tsx` 的 FR-018 `data-theme` 断言改为同时覆盖 preference；`desktopThemeChange` 在 preference=`system` 时仍更新 effective。

## 12. 落地顺序

1. 依赖 + `MuseTheme` + 解析/存储 + 桌面 `nativeTheme` / `ui.json`。
2. Field + 把 `ConfigDialog` / `MuseProviderSettings` 换成 Radix 表单；加外观 tab。
3. Dialog / Tab / Switch 动效。
4. 应用页 chrome CSS 换 token（侧栏、Header、Message、MessageInput）。
5. 删掉仅被表单使用的旧 `.configuration-field` 输入皮肤；`--vscode-*` 留给尚未迁移的 Diff / Terminal。
