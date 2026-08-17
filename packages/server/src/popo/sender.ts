import type { TokenStore } from "./tokenStore.js";

const SEND_API = "https://open.popo.netease.com/open-apis/robots/v1/im/send-msg";

export const MAX_TEXT_LENGTH = 3000;

/** 按码点切分，避免截断 emoji 等代理对字符。 */
export function chunkText(content: string, max = MAX_TEXT_LENGTH): string[] {
  const chars = [...content];
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += max) {
    chunks.push(chars.slice(i, i + max).join(""));
  }
  return chunks;
}

export interface Sender {
  sendText(receiver: string, content: string): Promise<void>;
}

export type SenderOptions = {
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
};

type SendResponse = { errcode: number; errmsg?: string };

export function createSender(options: SenderOptions): Sender {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function postOnce(
    token: string,
    receiver: string,
    content: string,
  ): Promise<SendResponse> {
    const res = await fetchImpl(SEND_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "open-access-token": token,
      },
      body: JSON.stringify({
        receiver,
        message: { content },
        msgType: "text",
      }),
    });
    if (!res.ok) throw new Error(`POPO send-msg ${res.status}`);
    return (await res.json()) as SendResponse;
  }

  return {
    async sendText(receiver, content) {
      for (const chunk of chunkText(content)) {
        const token = await options.tokenStore.getAccessToken();
        const result = await postOnce(token, receiver, chunk);
        if (result.errcode === 42001) {
          const fresh = await options.tokenStore.forceRefresh();
          const retry = await postOnce(fresh, receiver, chunk);
          if (retry.errcode !== 0) {
            throw new Error(`POPO send-msg 失败: ${retry.errcode} ${retry.errmsg ?? ""}`);
          }
          continue;
        }
        if (result.errcode !== 0) {
          throw new Error(`POPO send-msg 失败: ${result.errcode} ${result.errmsg ?? ""}`);
        }
      }
    },
  };
}
