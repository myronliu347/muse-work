#!/usr/bin/env node
/**
 * 用本机 POPO 机器人给主人发文本。
 * baseURL 解析链：MUSE_SERVER_URL → MUSE_HOME 下 server-url 文件
 * （打包版随机端口）→ 默认 8787（MUSE_SERVER_PORT 可覆盖）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function serverUrlFile() {
  const home = process.env.MUSE_HOME ?? os.homedir();
  const dirName = process.env.MUSE_HOME_DIR ?? ".muse-work";
  return path.join(home, dirName, "server-url");
}

function readServerUrlFile() {
  try {
    const url = fs.readFileSync(serverUrlFile(), "utf8").trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

const PORT = Number(process.env.MUSE_SERVER_PORT ?? 8787);
const BASE =
  process.env.MUSE_SERVER_URL ??
  readServerUrlFile() ??
  `http://127.0.0.1:${PORT}`;

function usage() {
  console.log(`popo-notify.mjs — 给 POPO 主人发文本（${BASE}）

用法：
  node popo-notify.mjs send --text <摘要>
`);
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h") {
    usage();
    return;
  }
  if (cmd !== "send") {
    throw new Error(`未知命令: ${cmd}`);
  }
  const text = arg(argv, "--text");
  if (!text?.trim()) {
    throw new Error("send 需要 --text");
  }
  const res = await fetch(`${BASE}/popo/notify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const raw = await res.text();
  if (!res.ok) {
    console.error(raw || `POST /popo/notify → ${res.status}`);
    process.exit(1);
  }
  console.log(raw || JSON.stringify({ ok: true }));
}

main().catch((err) => {
  console.error(
    `popo-notify.mjs: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
