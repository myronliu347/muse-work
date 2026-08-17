# POPO 机器人接入 agent 设计规格

**日期**：2026-08-17
**状态**：待评审
**产品**：Muse Work

## 1. 背景与目标

在 Muse 中接入 POPO 开放平台机器人能力：用户在 POPO 私聊机器人、或在群组中 @ 机器人时，由 Muse 的 agent 生成回复并发回。

- 消息接收走「事件发送至开发者服务器」webhook 模式（开发者后台已配置：`http://<本机IP>:3100/popo/callback` + token + aesKey）
- 消息发送走 POPO 开放平台 REST API（`/open-apis/robots/v1/im/send-msg`，需 accessToken）
- Muse 内新增「POPO 机器人」页面，查看回调配置与全部机器人会话及会话详情

## 2. 已确认决策（与用户逐条确认）

| 项 | 决策 |
|---|---|
| 回调端口 | 默认 3100；dev 启动支持 env `POPO_CALLBACK_PORT` 覆盖 |
| 进程形态 | 同进程双监听：主 server（127.0.0.1:动态端口）之外，同一进程再起一个仅含 `/popo/callback` 的 Hono 实例（0.0.0.0:3100） |
| 不影响主功能 | popo 监听器独立 try/catch 启动：绑定失败只记日志、机器人页面显示未就绪，主 server 照常运行；主端口恰好为 3100 时提示冲突并跳过 popo |
| token/aesKey | 沿用开发者后台现有值（token=`openclawtk`，aesKey=`frx2T6DXr6kiP3108Q8JErniG3QJeR8k`），不改平台配置 |
| 凭据存储 | `~/.popo-config.json`（已写入 appId/appKey/appSecret，0600） |
| 会话模型 | 每个用户/群独立会话；**不写入现有 sessions 存储**，独立文件 `~/.muse-work/popo-chats.json` |
| 权限 | 仅 `liuyuyang03@corp.netease.com`（masterUid）可指挥 agent；其余人私聊或群 @ 一律回复「大胆，只有尊敬的大人可以指挥我做事」 |
| 群回复 | 不 @ 主人，普通文本回复 |
| 群消息上下文 | 群消息进入 agent 前，提示词注入群号等上下文，引导 agent 用本地 popo-cli 读取群历史消息补充上下文 |
| 两段式回复 | 收到 master 消息先回「收到，马上处理，请稍等一会....」；agent 完成后回复**最后一个文本块**；出错则回复错误信息 |
| 侧栏入口 | 「新会话」下方新增 item「POPO 机器人」 |
| 其他事件 | 撤回/编辑/指令推送等：本期只记录日志，不处理 |

## 3. 架构总览

```
POPO 开放平台
  │ ① webhook 推送 POST /popo/callback（验签 + AES 解密）
  ▼
muse server（同一进程）
  ├── 回调监听器 0.0.0.0:3100（独立 Hono 实例，仅 /popo/callback）
  │     ② 验签(token) + 解密(aesKey) → eventType/eventData
  │     ③ 事件分发：IM_P2P_TO_ROBOT_MSG / IM_CHAT_TO_ROBOT_AT_MSG
  │     ④ 权限：from == masterUid ? agent : 固定拒绝语
  │     ⑤ agent 生成回复（独立 wave agent，上下文按 chat 隔离）
  │     ⑥ 发送 send-msg（Open-Access-Token，过期自动刷新）
  └── 主监听器 127.0.0.1:动态端口
        新增 /popo/config、/popo/chats、/popo/chats/:chatKey 路由
              │
              ▼
webview 机器人页面（侧栏「POPO 机器人」入口）
```

## 4. 数据模型

### 4.1 `~/.popo-config.json`（凭据 + 平台同步值）

```jsonc
{
  "appId": "250573540",
  "appKey": "HYPHPdrlvZ9HQWQvUa9M",
  "appSecret": "hMHT3nIB4XLgT6GLptTrQEOCNJlRYBKOUGfQs8OD1YWNcUPAOLxbFQInP0wYMfXx",
  "token": "openclawtk",
  "aesKey": "frx2T6DXr6kiP3108Q8JErniG3QJeR8k",
  "masterUid": "liuyuyang03@corp.netease.com"
}
```

- 文件权限 0600
- `masterUid` 由本次实现补写；缺省时拒绝所有私聊/群 @（安全默认）
- 敏感值（appSecret/aesKey）不出现在任何页面接口响应中

### 4.2 `~/.muse-work/popo-chats.json`（POPO 会话存储，与 sessions 存储隔离）

```jsonc
{
  "version": 1,
  "chats": {
    "p2p:liuyuyang03@corp.netease.com": {
      "chatKey": "p2p:liuyuyang03@corp.netease.com",
      "type": "p2p",
      "title": "liuyuyang03@corp.netease.com",
      "waveSessionId": "popo-xxxx",          // agent 上下文标识，持久化保证续聊
      "messages": [
        { "role": "user", "content": "你好", "from": "liuyuyang03@corp.netease.com", "at": "2026-08-17 10:00:00", "uuid": "..." },
        { "role": "assistant", "content": "你好！", "to": "liuyuyang03@corp.netease.com", "at": "...", "msgId": "..." }
      ],
      "createdAt": 1786...,
      "updatedAt": 1786...
    },
    "team:1696900": { "type": "team", "title": "群号 1696900", ... }
  }
}
```

- chatKey 命名：`p2p:<from 邮箱>`、`team:<群 sessionId>`
- messages 仅保留最近 N 条（如 200），防止文件无限膨胀
- agent 上下文不依赖 muse session store：POPO 子系统直接实例化 wave-agent-sdk 的 Agent，用 `waveSessionId` 管理上下文（与 sessionRunner 解耦）

### 4.3 `~/.muse-work/popo-token.json`（accessToken 缓存，重启不丢）

```jsonc
{
  "accessToken": "...",
  "accessExpiredAt": 1786...,
  "refreshToken": "...",
  "refreshExpiredAt": 1786...
}
```

- 启动时读取；accessToken 未过期直接复用（避免重新调 token 接口导致旧 refreshToken 失效）
- 持久化避免每次启动都换 token（换 token 会使上一个 refreshToken 失效）

## 5. 回调处理流程（packages/server/src/popo/）

### 5.1 验签与解密 `crypt.ts`

- 按微信企业微信风格实现（WXBizMsgCrypt 同款）：`msg_signature = SHA1(sort(token, timestamp, nonce, encrypt))`；encrypt 用 aesKey 做 AES-256-CBC + PKCS7 解密
- 未知点：POPO 的验签/解密协议细节（字段名、加密套件）以真实推送为准——上线前先用真实推送校准，必要时调整算法
- GET 握手请求：先回显/记录，按真实格式实现

### 5.2 事件分发 `handler.ts`

1. 解密得到 `eventType` / `eventData`
2. 仅处理 `IM_P2P_TO_ROBOT_MSG`（chatKey=`p2p:from`）与 `IM_CHAT_TO_ROBOT_AT_MSG`（chatKey=`team:sessionId`）；其余事件记日志
3. 权限检查：`from === masterUid` → agent 流程；否则 `sendText(receiver, 拒绝语)` 并记录
4. agent 流程（两段式回复）：
   - **先 ack**：立即 `sendText(receiver, "收到，马上处理，请稍等一会....")`（不等 agent，同时回调本身快速返回）
   - 从 chatStore 取 chat（无则创建，生成 waveSessionId）
   - 组装 agent 输入：
     - P2P：内容为 `notify`
     - 群：内容为 `notify`（去掉开头 `@机器人名 ` 前缀），并注入上下文提示（见 5.4）
   - 调 agent 生成回复（Promise 方式等完整回复，不依赖 WS 流）
   - **完成后回复最后一个文本块**：取 agent 最终输出的最后一个文本块（非中间工具输出）作为回复内容，`sendText(receiver, 该文本)`
   - **错误兜底**：agent 异常时 `sendText(receiver, 错误信息)`，并在日志记录
   - agent 工作目录固定为 `~/popo-chat`（与主会话 workdir 隔离；用户指定）
5. 失败兜底：整体异常时向 master 发送简短错误提示

### 5.3 发送通道 `tokenStore.ts` + `sender.ts`

- `tokenStore.getAccessToken()`：内存缓存 → 未过期直接用；过期 → `POST /open-apis/robots/v1/token/refresh`（body `{appKey, refreshToken}`）；refresh 失败（42002/网络错）→ `POST /open-apis/robots/v1/token`（body `{appKey, appSecret}`）重新换，成功后持久化
- `sender.sendText(receiver, content)`：`POST /open-apis/robots/v1/im/send-msg`，Header `Open-Access-Token`；body `{ receiver, message: { msgType: "text", content } }`
- 返回 `errcode: 42001`（token 过期）→ 强制刷新后重试一次
- 文本超 3000 字：按 3000 字切分多条发送

### 5.4 群消息上下文提示（`prompt.ts`）

群消息进入 agent 前，在用户消息/系统提示中注入群上下文信息，引导 agent 用本地 popo-cli（popo-im skill）读取群历史：

```
用户 @ 了机器人，群号为 <sessionId>（群聊）。若需要了解群内上下文，
可以使用 popo-cli / popo-im skill 读取该群的历史消息。
本次用户消息：<notify（去 @ 前缀）>
```

- 只对 `team:*` 会话注入；P2P 不注入
- 注入内容含：群号 sessionId、消息来自群聊的事实、可用 popo-cli 读历史的引导
- 群号等敏感信息不进入 chatStore 之外的其他文件

## 6. 主 server 路由（packages/server/src/popo/routes.ts，挂到主 Hono app）

| 路由 | 说明 |
|---|---|
| `GET /popo/config` | 回调配置（URL/token/aesKey/masterUid/端口/监听状态），供机器人页面展示 |
| `GET /popo/chats` | 会话列表（chatStore 全部，按 updatedAt 倒序，含最后一条消息摘要） |
| `GET /popo/chats/:chatKey` | 单会话详情（消息流） |

## 7. webview 机器人页面

- 侧栏「新会话」下方新增 item「POPO 机器人」，点击切换至机器人视图（不与现有会话列表混排）
- 页面内容：
  1. **配置卡片**：请求地址 URL、token、aesKey、masterUid、回调监听状态（就绪/未就绪原因）
  2. **会话列表**：chatKey/类型/标题/最后消息/时间，点击进详情
  3. **会话详情**：消息流（user/assistant 气泡），只读
- 数据全部来自 6 节路由

## 8. 启动与端口

- 主 server 启动（`index.ts`）时：加载 popo 配置 → 尝试启动回调监听器 `0.0.0.0:POPO_CALLBACK_PORT(默认3100)`
- 失败（端口占用 / 与主端口冲突）→ log error + 标记 `popoReady=false`，**不影响主 server 启动与运行**
- dev 运行：`POPO_CALLBACK_PORT=xxxx pnpm -F @muse-work/server dev`
- 机器人页面 `/popo/config` 返回 `ready` 状态，便于排查

## 9. 测试计划

- **server 单元**：crypt 验签/解密（微信风格向量）、tokenStore 刷新/换新/持久化、chatStore 读写与截断、handler 权限分支（master/非 master）、sender 超长文本切分与 42001 重试、两段式回复（先 ack 再最终文本块）、群消息 prompt 注入（群号上下文）
- **server 集成**：callbackApp 路由（GET 握手、POST 伪造/合法推送 → stub agent/sender 断言 ack 与最终回复），参照 `tests/sessions.ws.test.ts` 的 createApp + stub 模式
- **webview**：机器人页面组件渲染（配置卡片、会话列表、详情、监听未就绪态）

## 10. 风险与待确认项

1. **验签/解密协议细节未知**：按微信风格先实现，真实推送后校准（阻塞项，需配置好回调后触发一次真实事件）
2. **URL 验证握手格式未知**：以真实推送/平台行为为准
3. **群消息 notify 含 @ 前缀**：需剥离开头 `@机器人名 ` 再喂给 agent
4. **回调超时容忍度**：回调先快速 ack（先发「收到，马上处理」再异步跑 agent），若平台要求同步返回再评估
