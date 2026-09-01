# Welcome View 氛围页 Design

**Date:** 2026-09-01  
**Status:** Approved for implementation  
**Scope:** 新会话欢迎页（`NewSessionPage` + `WelcomeView`）；侧栏 / 已绑定会话的聊天列不改成整窗毛玻璃

## Problem

当前欢迎区是 40px Logo + 两行 13px 文案，没有层次，也没有个性。目标参考是「大背景 + 毛玻璃行动卡片 + 大问候」，壁纸按 light / dark 分池，每次打开随机一张。

## Goals

1. 新会话页铺满氛围壁纸，标题与四张玻璃卡片叠在上面；输入框和趴猫保持现有 sender。
2. 深色 / 浅色各 3 张内置壁纸；进入欢迎页时从当前主题池随机抽取。
3. 卡片点击把对应提示填进输入框，不自动发送。
4. 登录 CTA 规则不变（未登录且无 direct-connect 才出现）。

## Non-Goals

- 用户自选本地壁纸（以后再说）。
- 侧栏、已绑定会话的消息列做成半透明。
- 捆绑任何第三方角色 / IP 插画。
- 改发送、工作目录、模型选择语义。

## Layout

```
┌──────────┬─────────────────────────────────────────┐
│ Sidebar  │  wallpaper (cover) + scrim              │
│  实色    │    今天想在 Muse 里做什么？              │
│          │    [理解] [写功能] [改文件] [排查]        │
│          │         composer + cat                  │
└──────────┴─────────────────────────────────────────┘
```

- 壁纸挂在 `.new-session-page`（embedded）或非 embedded `WelcomeView` 外壳上，`background-size: cover`。
- 一层很薄的 scrim，保证标题对比度。
- 内容列加宽到约 760px，容纳四张卡片。
- 去掉居中小 M Logo（侧栏已有）。

## Copy

- 标题：`今天想在 Muse 里做什么？`，「Muse」用 `var(--accent-9)`。
- 卡片：

| 标题 | 说明 | 填入输入框 |
|---|---|---|
| 理解项目 | 摸清目录、模块和怎么跑 | 帮我摸清这个项目的结构：目录怎么组织、入口在哪、怎么跑起来。 |
| 写新功能 | 从一句话开始加能力 | 我想加一个新功能： |
| 修改文件 | 指出文件，直接改 | 帮我改这些文件： |
| 排查问题 | 对着报错一起看 | 我遇到了问题，帮我一起看： |

未登录时卡片下方仍显示「登录后即可开始使用~」和「登 录」。

## Wallpaper

| Theme | 文件（`packages/webview/src/assets/welcome-wallpapers/`） |
|---|---|
| dark | `dark-lanterns.webp`、`dark-rain.webp`、`dark-moon.webp` |
| light | `light-morning.webp`、`light-paper.webp`、`light-garden.webp` |

- 进入欢迎页（组件 mount）时抽取；同一页停留不换。
- 切 light / dark 时从新池再抽一张。
- `sessionStorage` 记下上次 URL，连续两次尽量不重复。
- 有消息后离开新会话页，壁纸卸掉。

## Cards → composer

`WelcomeView` 增加可选 `onSelectPrompt(text)`。`ChatApp` 通过已有 `messageInputRef` 写入输入框（新增 `setText`，替换当前草稿并 focus）。不 `sendMessage`。

## Testing

- 欢迎标题 / 四张卡片渲染；点卡片调用 `onSelectPrompt`。
- `pickWelcomeWallpaper`：dark 只从 dark 池、light 只从 light 池；exclude 生效。
- 登录闪现回归仍成立。
- 既有「Hi~ 欢迎使用 Muse」断言改为新标题。
