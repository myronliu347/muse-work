---
name: popo-notify
description: "只用本机 POPO 机器人给主人发一条私聊。不能指定接收人、不能发群、不能回复别人。用户或自动化指令要「通知我 / 用机器人给我发消息」时使用。"
---

# POPO 通知

用同目录 `scripts/popo-notify.mjs` 调本机 `POST /popo/notify`，由机器人给 **主人**（`masterUid`）发一条文本。不能指定其他人、不能发群。

## 何时发

- 用户或规则 prompt **明确**要求：用机器人通知 / 发 POPO / 跑完提醒我。
- 先做完活，再发**短中文摘要**（结论、失败原因、必要下一步）。不要把整段 transcript 贴过去。
- 需要通知时：先 `send` 再收工。发送失败把错误写进最终回复，不要假装已送达。

## 何时不要发

- 没人要求通知。
- 当前是 POPO 私聊/群聊入站会话（重复回复）。
- 把通知当聊天：一句话能说完就一句话。

## 命令

Base URL：`MUSE_SERVER_URL`，或 `MUSE_HOME` 下 `server-url` 文件，否则 `http://127.0.0.1:$MUSE_SERVER_PORT`（默认 8787）。

```bash
node popo-notify.mjs send --text "摘要"
```

未配置 POPO / 没有主人账号 / 发送失败时脚本非 0 退出。
