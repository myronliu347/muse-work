# POPO 机器人对接核心链路

总结机器人接入 POPO 开放平台的完整链路：**平台配置 → 回调接收（验签/解密）→ 交给 Muse Bot → 助理用发送 API 回复**。协议细节以真实推送实测校准为准。

## 1. 对接总览

```
POPO 开放平台
  │ ① 事件订阅 webhook：POST http://<本机IP>:3100/popo/callback
  ▼
机器人服务
  ② 验签（token + query 中的 signature/timestamp/nonce）
  ③ AES 解密 body 中的 encrypt → { eventType, eventData }
  ④ 快速返回 {"code":0,"msg":"ok"}，处理异步执行
  ⑤ 权限闸门：只收主人
  ⑥ 主人的私聊和群 @ 交给 Muse Bot，不在这里生成回复
  │ ⑦ 助理回复时走 REST API：token 管理 + send-msg
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

1. **识别事件**：私聊看 `from`，群聊看 `sessionId`。缺关键字段或未知事件只记日志。
2. **权限闸门**：`from !== masterUid` → 回固定拒绝语，结束。
3. **交给 Muse Bot**：群消息先剥离开头的 `@机器人名`。正文为空则丢掉。否则入队：
   - 私聊：`from` 为 `popo`，并写入 Muse Bot 对话记录。
   - 群聊：`from` 为 `popo-group`，带上 `groupId`。群消息不写入 Muse Bot 对话记录。
4. 这里不回执、不另开机器人会话。回复由助理调用 `SendMessage`（`app` 为 `popo`）发出。模型用场景默认模型里的「AI 助手」。

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

## 7. 和 Muse Bot 的关系

- POPO 没有单独的机器人会话，也没有单独的场景模型。收进来的消息和 Muse 里的对话走同一个长期助理。
- 助理用 `SendMessage` 把结论发回提问的那个频道：有群号发群，否则发给主人。
- `POST /popo/notify` 仍只给主人发私聊，给定时通知用。

## 8. 安全要点

- `~/.popo-config.json`、token 缓存文件均 0600（含 accessToken/refreshToken 双凭据）。
- 所有回调先验签再处理；原始请求调试落盘开关默认关闭（含消息内容与凭据）。
- `masterUid` 白名单是唯一授权面，缺省全拒绝。
