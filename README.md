# Muse Work

Muse Work 是一个 pnpm monorepo，包含以下 workspace 包：

| 包 | 职责 |
|---|---|
| `@muse-work/provider` | 共享 Provider 接口与类型定义 |
| `@muse-work/server` | WebSocket 服务端与 CLI（`muse-server`） |
| `@muse-work/webview` | Webview UI（后续 Task 9 补齐） |
| `@muse-work/desktop` | Electron 桌面客户端（后续 Task 10 补齐） |

## 开发

```bash
pnpm install
pnpm build          # 构建所有包
pnpm test           # 运行所有包测试
pnpm type-check     # 类型检查
pnpm dev:server     # 启动 server 开发模式
pnpm dev:desktop    # 启动 desktop 开发模式（后续任务补齐）
```

## 要求

- Node.js >= 20
- pnpm 9.15.0
