import crypto from "node:crypto";

/**
 * POPO 回调验签（真实协议，2026-08-17 实测校准）：
 * signature = SHA256( sort(token, timestamp, nonce) 拼接 )，签名参数在 query，不含密文。
 */
export function verifySignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  signature: string;
}): boolean {
  const arr = [params.token, params.timestamp, params.nonce].sort();
  const digest = crypto.createHash("sha256").update(arr.join("")).digest("hex");
  return digest === params.signature.toLowerCase();
}

function deriveKeyIv(aesKey: string): { key: Buffer; iv: Buffer } {
  if (aesKey.length < 32) {
    throw new Error(`aesKey 长度不足: ${aesKey.length}（需 32 位，前 16 为 key 后 16 为 IV）`);
  }
  return {
    key: Buffer.from(aesKey.slice(0, 16), "utf8"),
    iv: Buffer.from(aesKey.slice(16, 32), "utf8"),
  };
}

/**
 * 解密回调事件（真实协议，2026-08-17 实测校准）：
 * AES-128-CBC，key = aesKey 前 16 字节 UTF-8，IV = aesKey 后 16 字节 UTF-8，
 * 手动 PKCS7 去填充，明文为完整事件 JSON（无前缀/长度字段）。
 */
export function decryptEvent(aesKey: string, encrypt: string): string {
  const { key, iv } = deriveKeyIv(aesKey);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);
  const raw = Buffer.concat([
    decipher.update(Buffer.from(encrypt, "base64")),
    decipher.final(),
  ]);
  const padLen = raw[raw.length - 1];
  return raw.subarray(0, raw.length - padLen).toString("utf8");
}

/** 与 decryptEvent 对称的加密实现，仅用于测试向量。 */
export function encryptEvent(aesKey: string, message: string): string {
  const { key, iv } = deriveKeyIv(aesKey);
  let payload = Buffer.from(message, "utf8");
  const blockSize = 16;
  const padLen = blockSize - (payload.length % blockSize);
  payload = Buffer.concat([payload, Buffer.alloc(padLen, padLen)]);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(payload), cipher.final()]).toString(
    "base64",
  );
}
