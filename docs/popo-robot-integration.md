# POPO 机器人对接核心链路

总结机器人接入 POPO 开放平台的完整链路：**平台配置 → 回调接收（验签/解密）→ 消息处理 → Agent 生成回复 → API 发送**。协议细节以真实推送实测校准为准。

## 1. 对接总览

```
POPO 开放平台
  │ ① 事件订阅 webhook：POST http://<本机IP>:3100/popo/callback
  ▼
机器人服务
  ② 验签（token + query 中的 signature/timestamp/nonce）
  ③ AES 解密 body 中的 encrypt → { eventType, eventData }
  ④ 快速返回 {"code":0,"msg":"ok"}，处理异步执行
  ⑤ 权限闸门 + 控制命令分流
  ⑥ 先回 ack，再调 Agent 生成最终回复
  │ ⑦ REST API 发送：token 管理 + send-msg
  ▼
POPO 用户（私聊 / 群聊）
```

## 2. 平台侧准备

1. 在 POPO 开放平台创建机器人，获得 `appId` / `appKey` / `appSecret`。
2. 「事件订阅」配置回调地址 `http://<局域网IP>:3100/popo/callback`，并记录回调 `token` 与 `aesKey`（须与本地配置一致）。
3. 订阅两种消息事件，其余事件只记日志不处理：

| eventType | 语义 | eventData 关键字段 |
|---|---|---|
| `IM_P2P_TO_ROBOT_MSG` | 私聊推给机器人 | `from`、`notify` |
| `IM_CHAT_TO_ROBOT_AT_MSG` | 群聊 @ 机器人 | `from`、`notify`、`sessionId`（群号） |

## 3. 凭据与本地配置

`~/.popo-config.json`（权限 0600）：

```json
{
  "appId": "<App ID>",
  "appKey": "<App Key>",
  "appSecret": "<App Secret>",
  "token": "<回调验签 token>",
  "aesKey": "<回调加解密 aesKey，32 位>",
  "masterUid": "you@corp.netease.com"
}
```

- `appId/appKey/appSecret` 必填，缺失则机器人整体禁用。
- `masterUid` 是唯一授权账号（白名单）；缺省时拒收一切消息（安全默认）。

## 4. 接收消息：回调协议

### 4.1 GET 握手

`GET /popo/callback?timestamp=&nonce=&echostr=&signature=`

- 验签通过 → 原样返回 `echostr`；失败 → 401。
- 无 echostr 的 GET（探活）→ `{"code":0,"msg":"ok"}`。

### 4.2 POST 事件推送

- Query：`signature`、`timestamp`、`nonce`；Body（JSON）：`{"encrypt": "<base64 密文>"}`。
- **验签**：`SHA256( sort(token, timestamp, nonce).join("") )` 取 hex 小写，与 query 中的 `signature` 比较。注意签名参数在 **query**、不含密文（与微信 WXBizMsgCrypt 风格不同）。
- **解密**：AES-128-CBC；`key = aesKey 前 16 字节`（UTF-8）、`iv = aesKey 后 16 字节`；手动 PKCS7 去填充；明文即完整事件 JSON，无前缀、无长度头。
- 明文结构：`{ "eventType": "...", "eventData": { ... } }`。
- 解析成功后**立即**返回 `{"code":0,"msg":"ok"}`，业务处理异步执行（避免回调超时）；验签失败回 401，解密/解析失败回 500。

## 5. 消息处理核心链路

1. **会话识别**：按事件生成 `chatKey`——私聊 `p2p:<from>`、群聊 `team:<sessionId>`；每个会话独立上下文，缺关键字段的未知事件忽略。
2. **权限闸门**：`from !== masterUid` → 回固定拒绝语，结束。
3. **控制命令**（群聊先剥离开头 `@机器人名 ` 前缀再匹配）：
   - `/clear`：清空当前会话上下文，回确认语。
   - `/btw [问题]`：旁路实时询问正在处理的任务进度，不走主流程、不打断进行中的消息。
4. **两段式回复**：
   - 立即回复 ack：「收到，马上处理，请稍等一会....」；
   - 消息落库（含 from/时间），置「处理中」标记；
   - 群消息进 Agent 前注入上下文提示：「（本条消息来自群聊，群号 <sessionId>。若需要群内历史上下文，可用 popo-cli / popo-im skill 读取该群消息。）」— 私聊不注入；
   - Agent 返回后取**最后一个文本块**回复；空回复或异常时回复「处理出错：<信息>」；
   - 无论成败清除「处理中」标记。
5. 同一会话的消息**串行执行**，避免并发回调交错上下文。

## 6. 回复消息：发送 API

REST 域名 `https://open.popo.netease.com`。

### 6.1 accessToken 管理

| 接口 | Body | 用途 |
|---|---|---|
| `POST /open-apis/robots/v1/token` | `{appKey, appSecret}` | 首次/refresh 失效时换取 |
| `POST /open-apis/robots/v1/token/refresh` | `{appKey, refreshToken}` | 日常刷新（errcode 42002 时回落重新换取） |

- token 缓存内存 + 本地文件（0600）；重启复用未过期 token——重新换取会使旧 refreshToken 失效，避免每次启动都换。
- 过期判定留 60s 提前量；并发请求共享同一次刷新。

### 6.2 发文本消息

`POST /open-apis/robots/v1/im/send-msg`

- Header：`content-type: application/json`、`open-access-token: <accessToken>`。
- Body：`{ "receiver": "<对方邮箱或群 sessionId>", "message": { "content": "<文本>" }, "msgType": "text" }`。
- 响应 `{ errcode, errmsg }`，`errcode=0` 成功。
- **超长切分**：按码点（不截断 emoji）每 3000 字一条。
- **过期重试**：`errcode=42001` → 强制刷新 token 后重试一次。

## 7. Agent 侧约定

- **会话续聊**：服务端为每个 chatKey 持久化 agent 的 `waveSessionId`，创建时作为 `restoreSessionId` 恢复上下文，回答前读最终 sessionId 回写落库。
- **生命周期**：私聊常驻 agent 跨消息复用；群聊可每条消息新建 agent、用完即毁（恢复成本主要靠 session 恢复）。
- **系统提示要点**：说明群聊 `@机器人名` 前缀语义；需要群历史时引导用 popo-cli 读群消息；回复简洁、中文。
- **禁后台任务**：机器人收不到后台任务完成通知——禁 `run_in_background`、禁 cron 类工具（如 Workflow），所有命令前台执行。

## 8. 安全要点

- `~/.popo-config.json`、token 缓存文件均 0600（含 accessToken/refreshToken 双凭据）。
- 所有回调先验签再处理；原始请求调试落盘开关默认关闭（含消息内容与凭据）。
- `masterUid` 白名单是唯一授权面，缺省全拒绝。
