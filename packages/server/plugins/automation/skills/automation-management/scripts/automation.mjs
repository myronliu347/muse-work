#!/usr/bin/env node
/**
 * 自动化管理 CLI：调本地 muse-work server REST API。
 * baseURL 解析链：MUSE_SERVER_URL → MUSE_HOME 下 server 落盘的 server-url 文件
 * （打包版随机端口）→ 默认 8787（MUSE_SERVER_PORT 可覆盖）。
 * 用法见同目录上级 SKILL.md。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** server 落盘的实际监听地址文件（与 server 侧 getMuseHomeDir 同构）。 */
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
  console.log(`automation.mjs — 自动化管理 CLI（${BASE}）

用法：
  node automation.mjs create --name <名称> --prompt <指令> --workdir <路径> [--cron EXPR]* [--issue-events created,review] [--tags a,b] [--priority p0|p1|p2] [--description D] [--model M] [--agent A]
  node automation.mjs list
  node automation.mjs get --id <ID>
  node automation.mjs update --id <ID> [--name N] [--prompt P] [--workdir W] [--description D] [--model M] [--agent A] [--cron EXPR]* [--issue-events E] [--tags a,b] [--priority p0|p1|p2]
  node automation.mjs enable --id <ID>
  node automation.mjs disable --id <ID>
  node automation.mjs run --id <ID>
  node automation.mjs runs --id <ID>
  node automation.mjs delete --id <ID>
`);
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function argsAll(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1] != null) {
      out.push(argv[i + 1]);
      i++;
    }
  }
  return out;
}

function parseIssueEvents(raw) {
  if (raw == null || raw === "") return undefined;
  const events = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return events.length ? events : undefined;
}

function parseTags(raw) {
  if (raw == null || raw === "") return undefined;
  const tags = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.length ? tags : undefined;
}

function parseTriggers(argv) {
  const crons = argsAll(argv, "--cron");
  const events = parseIssueEvents(arg(argv, "--issue-events"));
  const tags = parseTags(arg(argv, "--tags"));
  const priority = arg(argv, "--priority");
  const triggers = [];
  for (const expr of crons) {
    triggers.push({ type: "cron", expr });
  }
  if (events) {
    const issueTrigger = { type: "issue", events };
    if (tags) issueTrigger.tags = tags;
    if (priority != null) issueTrigger.priority = priority;
    triggers.push(issueTrigger);
  }
  return triggers;
}

function shouldReplaceTriggers(argv) {
  if (argsAll(argv, "--cron").length > 0) return true;
  return arg(argv, "--issue-events") != null;
}

function assignOptional(body, argv) {
  const name = arg(argv, "--name");
  if (name != null) body.name = name;
  const prompt = arg(argv, "--prompt");
  if (prompt != null) body.prompt = prompt;
  const workdir = arg(argv, "--workdir");
  if (workdir != null) body.workdir = workdir;
  const description = arg(argv, "--description");
  if (description != null) body.description = description;
  const model = arg(argv, "--model");
  if (model != null) body.model = model;
  const agent = arg(argv, "--agent");
  if (agent != null) body.agentName = agent;
}

async function request(method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(text || `${method} ${urlPath} → ${res.status}`);
    process.exit(1);
  }
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return json;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function requireId(argv, cmd) {
  const id = arg(argv, "--id");
  if (!id) throw new Error(`${cmd} 需要 --id`);
  return id;
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h") {
    usage();
    return;
  }

  switch (cmd) {
    case "create": {
      const name = arg(argv, "--name");
      const prompt = arg(argv, "--prompt");
      const workdir = arg(argv, "--workdir");
      if (!name || !prompt || !workdir) {
        throw new Error("create 需要 --name --prompt --workdir");
      }
      const triggers = parseTriggers(argv);
      const body = { name, prompt, workdir, triggers };
      assignOptional(body, argv);
      if (
        prompt.trim() &&
        workdir.trim() &&
        triggers.length > 0
      ) {
        body.enabled = true;
      }
      const { automation } = await request("POST", "/automations", body);
      printJson(automation);
      return;
    }
    case "list": {
      const result = await request("GET", "/automations");
      printJson(result);
      return;
    }
    case "get": {
      const id = requireId(argv, "get");
      const { automation } = await request("GET", `/automations/${id}`);
      printJson(automation);
      return;
    }
    case "update": {
      const id = requireId(argv, "update");
      const body = {};
      assignOptional(body, argv);
      if (shouldReplaceTriggers(argv)) {
        body.triggers = parseTriggers(argv);
      }
      const { automation } = await request("PATCH", `/automations/${id}`, body);
      printJson(automation);
      return;
    }
    case "enable": {
      const id = requireId(argv, "enable");
      const { automation } = await request("POST", `/automations/${id}/enable`);
      printJson(automation);
      return;
    }
    case "disable": {
      const id = requireId(argv, "disable");
      const { automation } = await request("POST", `/automations/${id}/disable`);
      printJson(automation);
      return;
    }
    case "run": {
      const id = requireId(argv, "run");
      const { run } = await request("POST", `/automations/${id}/run`);
      printJson(run);
      return;
    }
    case "runs": {
      const id = requireId(argv, "runs");
      const result = await request("GET", `/automations/${id}/runs`);
      printJson(result);
      return;
    }
    case "delete": {
      const id = requireId(argv, "delete");
      const result = await request("DELETE", `/automations/${id}`);
      printJson(result);
      return;
    }
    default:
      throw new Error(`未知命令: ${cmd}`);
  }
}

main().catch((err) => {
  console.error(
    `automation.mjs: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
