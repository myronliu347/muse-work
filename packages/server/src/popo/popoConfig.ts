import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PopoConfig = {
  appId: string;
  appKey: string;
  appSecret: string;
  /** 回调验签 token（与开发者后台「事件订阅」保持一致） */
  token: string;
  /** 回调事件加解密 aesKey（与开发者后台「事件订阅」保持一致） */
  aesKey: string;
  /** 唯一可指挥机器人的主人账号 */
  masterUid: string;
};

export function getPopoConfigPath(home = os.homedir()): string {
  return path.join(home, ".popo-config.json");
}

export function savePopoConfig(config: PopoConfig, home?: string): void {
  const file = getPopoConfigPath(home);
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function loadPopoConfig(home?: string): PopoConfig {
  const file = getPopoConfigPath(home);
  let raw: Partial<PopoConfig>;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PopoConfig>;
  } catch (error) {
    throw new Error(`读取 POPO 配置失败: ${file} (${String(error)})`);
  }
  if (!raw.appId || !raw.appKey || !raw.appSecret) {
    throw new Error(`POPO 配置不完整: ${file}（缺少 appId/appKey/appSecret）`);
  }
  return {
    appId: raw.appId,
    appKey: raw.appKey,
    appSecret: raw.appSecret,
    token: raw.token ?? "",
    aesKey: raw.aesKey ?? "",
    masterUid: raw.masterUid ?? "",
  };
}
