import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TokenStore } from "./tokenStore.js";

const SEND_API = "https://open.popo.netease.com/open-apis/robots/v1/im/send-msg";
const FILE_API = "https://open.popo.netease.com/open-apis/robots/v1/im/file";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "gif", "png", "bmp"]);

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

export function popoMsgTypeForPath(filePath: string): "image" | "file" {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return IMAGE_EXTS.has(ext) ? "image" : "file";
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "png") return "image/png";
  if (ext === "bmp") return "image/bmp";
  return "application/octet-stream";
}

function popoFileType(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === "jpeg") return "jpg";
  return ext || "bin";
}

export interface Sender {
  /** 返回每段文本对应的消息 id，供撤回使用。 */
  sendText(receiver: string, content: string): Promise<string[]>;
  /** 先登记文件拿到 fileKey 和 uploadUrl，再把本地字节传上去，最后按图片或文件发出。 */
  sendLocalFile(receiver: string, filePath: string): Promise<string>;
  recall(args: PopoRecall): Promise<void>;
}

export type SenderOptions = {
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
};

export type PopoRecall = {
  msgId: string;
  sessionId: string;
  /** 私聊是 1，群是 3。 */
  sessionType: 1 | 3;
};

type PopoData = {
  fileKey?: string;
  uploadUrl?: string;
  msgId?: string;
  msgInfo?: Record<string, string>;
};

type SendResponse = {
  errcode?: number;
  errmsg?: string;
  data?: string | PopoData;
  fileKey?: string;
  uploadUrl?: string;
  msgId?: string;
};

function readMsgId(body: SendResponse, receiver?: string): string {
  const data = body.data;
  if (typeof data === "string" && data.trim()) return data.trim();
  if (data && typeof data === "object") {
    if (typeof data.msgId === "string" && data.msgId.trim()) return data.msgId.trim();
    const info = data.msgInfo;
    if (info && typeof info === "object") {
      const preferred = receiver ? info[receiver] : undefined;
      if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
      for (const value of Object.values(info)) {
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
  }
  if (typeof body.msgId === "string" && body.msgId.trim()) return body.msgId.trim();
  return "";
}

function fileTicket(body: SendResponse): { fileKey: string; uploadUrl: string } {
  const data = body.data && typeof body.data === "object" ? body.data : undefined;
  return {
    fileKey: data?.fileKey || body.fileKey || "",
    uploadUrl: data?.uploadUrl || body.uploadUrl || "",
  };
}

export function createSender(options: SenderOptions): Sender {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function postJson(token: string, url: string, body: unknown): Promise<SendResponse> {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "open-access-token": token,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POPO ${res.status}`);
    return (await res.json()) as SendResponse;
  }

  async function authed(url: string, body: unknown): Promise<SendResponse> {
    const token = await options.tokenStore.getAccessToken();
    const result = await postJson(token, url, body);
    if (result.errcode === 42001) {
      const fresh = await options.tokenStore.forceRefresh();
      const retry = await postJson(fresh, url, body);
      if (retry.errcode !== 0) {
        throw new Error(`POPO 失败: ${retry.errcode} ${retry.errmsg ?? ""}`);
      }
      return retry;
    }
    if (result.errcode !== 0 && result.errcode !== undefined) {
      throw new Error(`POPO 失败: ${result.errcode} ${result.errmsg ?? ""}`);
    }
    return result;
  }

  async function uploadBytes(
    uploadUrl: string,
    fileName: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<void> {
    async function once(token: string): Promise<SendResponse> {
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(bytes)], { type: contentType }),
        fileName,
      );
      const res = await fetchImpl(uploadUrl, {
        method: "POST",
        headers: { "open-access-token": token },
        body: form,
      });
      if (!res.ok) throw new Error(`POPO 文件上传 ${res.status}`);
      return (await res.json()) as SendResponse;
    }
    const token = await options.tokenStore.getAccessToken();
    let result = await once(token);
    if (result.errcode === 42001) {
      result = await once(await options.tokenStore.forceRefresh());
    }
    if (result.errcode !== 0 && result.errcode !== undefined) {
      throw new Error(`POPO 文件上传失败: ${result.errcode} ${result.errmsg ?? ""}`);
    }
  }

  return {
    async sendText(receiver, content) {
      const msgIds: string[] = [];
      for (const chunk of chunkText(content)) {
        const result = await authed(SEND_API, {
          receiver,
          message: { content: chunk },
          msgType: "text",
        });
        const msgId = readMsgId(result, receiver);
        if (msgId) msgIds.push(msgId);
      }
      return msgIds;
    },
    async sendLocalFile(receiver, filePath) {
      const bytes = await fs.promises.readFile(filePath);
      const ticket = await authed(FILE_API, {
        fileType: popoFileType(filePath),
        fileName: path.basename(filePath),
        fileMd5: crypto.createHash("md5").update(bytes).digest("hex"),
      });
      const { fileKey, uploadUrl } = fileTicket(ticket);
      if (!fileKey || !uploadUrl) {
        throw new Error("POPO 文件上传没有返回 fileKey 或 uploadUrl");
      }
      await uploadBytes(uploadUrl, path.basename(filePath), bytes, contentTypeFor(filePath));
      const sent = await authed(SEND_API, {
        receiver,
        message: { fileKey },
        msgType: popoMsgTypeForPath(filePath),
      });
      return readMsgId(sent, receiver);
    },
    async recall(args) {
      const msgId = args.msgId.trim();
      if (!msgId) throw new Error("POPO 撤回缺少 msgId");
      await authed(
        `https://open.popo.netease.com/open-apis/robots/v1/im/${encodeURIComponent(msgId)}/recall`,
        { sessionId: args.sessionId, sessionType: args.sessionType },
      );
    },
  };
}
