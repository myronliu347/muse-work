# 浏览器面板顶栏导航条

**日期**：2026-08-15  
**状态**：已确认  
**范围**：`packages/webview` — `PreviewPane`、`ChatApp` 空态、相关样式与测试

## 1. 目标

浏览器（preview）面板顶栏改为导航工具栏，**打开面板即显示**，无需先点击链接。

布局：

`←` `→` `刷新` `[地址输入框]` `外开` `选择元素`

## 2. 行为

| 控件 | 行为 |
|------|------|
| ← / → | webview `goBack` / `goForward`；不可用时 `disabled` |
| 刷新 | `reloadIgnoringCache`；无已加载页面时禁用 |
| 地址栏 | 可编辑；回车规范化并导航；与 guest 导航同步显示 |
| 外开 | `openExternal` 当前地址；无有效 URL 时禁用 |
| 选择元素 | 现有 picker；无页面 / preload 未就绪时沿用提示 |
| 空态 | 统一挂载 `PreviewPane`（`url` 可空）；正文占位：「输入地址回车访问，或点击消息/终端中的链接」 |

## 3. 实现要点

- 去掉 `ChatApp` 独立 empty aside；始终渲染 `PreviewPane`
- `PreviewPane` 接受 `url?: string | null`；无 url 时不 `loadURL`，仅展示工具栏 + 占位
- 地址栏回车：校验/补全协议后 **本地面板立即 `loadURL`/`src`**，并经 `onNavigate` 回写 `previewUrl`
- 地址栏导航路由：公网 http(s) 直接设 `previewUrl`；仅远程会话的 **localhost** 走 port-forward
- Electron `<webview>`：扩展 `goBack` / `goForward` / `canGoBack` / `canGoForward` 类型与事件（如 `did-navigate`）更新前进后退状态

## 4. 非目标

- 书签 / 历史面板  
- 多标签浏览器  
- 消息/终端里非 localhost 链接的点击行为（仍不打开预览）

## 5. 测试

- 无 url 时工具栏可见，地址栏可输入回车触发导航回调  
- ←→ 随 canGo* 禁用  
- 选择元素 / 刷新既有用例回归  
