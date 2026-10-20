#!/usr/bin/env node
/**
 * Issue 管理 CLI：调本地 muse-work server REST API。
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
  console.log(`issue.mjs — Issue 管理 CLI（${BASE}）

用法：
  node issue.mjs create --title <标题> [--description D] [--priority p0|p1|p2] [--type bug|feature|research|analysis|review|work] [--add-json '[{ "content": "..." }]']
  node issue.mjs update --id <ID> [--title T] [--description D] [--priority p0|p1|p2] [--type bug|feature|research|analysis|review|work]
  node issue.mjs get --id <ID>
  node issue.mjs items --id <ID> --add-json '[{ "content": "..." }]'
  node issue.mjs items --id <ID> --done <ITEM_ID>
  node issue.mjs items --id <ID> --remove <ITEM_ID>
  node issue.mjs exec-turn --id <ID>
  node issue.mjs dispatch --id <ID> --item <ITEM_ID> [--prompt P]
  node issue.mjs ready --id <ID>
  node issue.mjs complete --id <ID> --note <结果结论>
  node issue.mjs cancel --id <ID> --note <取消原因>
`);
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const ISSUE_TYPES = new Set([
  "bug",
  "feature",
  "research",
  "analysis",
  "review",
  "work",
]);

function parseType(raw) {
  if (raw == null || raw === "") return undefined;
  if (!ISSUE_TYPES.has(raw)) {
    throw new Error(
      "--type 只能是 bug、feature、research、analysis、review、work",
    );
  }
  return raw;
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

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h") {
    usage();
    return;
  }

  switch (cmd) {
    case "create": {
      const title = arg(argv, "--title");
      if (!title) throw new Error("create 需要 --title");
      const body = { title };
      const description = arg(argv, "--description");
      if (description != null) body.description = description;
      const priority = arg(argv, "--priority");
      if (priority != null) body.priority = priority;
      const type = parseType(arg(argv, "--type"));
      if (type) body.type = type;
      const addJson = arg(argv, "--add-json");
      if (addJson != null) {
        let rawItems;
        try {
          rawItems = JSON.parse(addJson);
        } catch {
          throw new Error("--add-json 不是合法 JSON");
        }
        if (!Array.isArray(rawItems)) {
          throw new Error("--add-json 必须是数组");
        }
        body.items = rawItems.map((item) => {
          const row = item && typeof item === "object" ? item : {};
          return {
            content: typeof row.content === "string" ? row.content : "",
          };
        });
      }
      const { issue } = await request("POST", "/issues", body);
      printJson(issue);
      return;
    }
    case "update": {
      const id = arg(argv, "--id");
      if (!id) throw new Error("update 需要 --id");
      const body = {};
      const title = arg(argv, "--title");
      if (title != null) body.title = title;
      const description = arg(argv, "--description");
      if (description != null) body.description = description;
      const priority = arg(argv, "--priority");
      if (priority != null) body.priority = priority;
      const type = parseType(arg(argv, "--type"));
      if (type) body.type = type;
      const { issue } = await request("PATCH", `/issues/${id}`, body);
      printJson(issue);
      return;
    }
    case "get": {
      const id = arg(argv, "--id");
      if (!id) throw new Error("get 需要 --id");
      const { issue } = await request("GET", `/issues/${id}`);
      printJson(issue);
      return;
    }
    case "items": {
      const id = arg(argv, "--id");
      if (!id) throw new Error("items 需要 --id");
      const removeId = arg(argv, "--remove");
      if (removeId) {
        const { issue } = await request(
          "DELETE",
          `/issues/${id}/items/${encodeURIComponent(removeId)}`,
        );
        printJson(issue);
        return;
      }
      const doneId = arg(argv, "--done");
      if (doneId) {
        const { issue } = await request(
          "POST",
          `/issues/${id}/items/${encodeURIComponent(doneId)}/accept`,
        );
        printJson(issue);
        return;
      }
      const addJson = arg(argv, "--add-json") ?? arg(argv, "--set-json");
      if (addJson == null) {
        throw new Error("items 需要 --add-json、--remove 或 --done");
      }
      let rawItems;
      try {
        rawItems = JSON.parse(addJson);
      } catch {
        throw new Error("--add-json 不是合法 JSON");
      }
      if (!Array.isArray(rawItems)) {
        throw new Error("--add-json 必须是数组");
      }
      const items = rawItems.map((item) => {
        const row = item && typeof item === "object" ? item : {};
        return {
          content: typeof row.content === "string" ? row.content : "",
        };
      });
      const { issue } = await request("POST", `/issues/${id}/items`, { items });
      printJson(issue);
      return;
    }
    case "exec-turn": {
      const id = arg(argv, "--id");
      if (!id) throw new Error("exec-turn 需要 --id");
      const turn = await request("GET", `/issues/${id}/exec-turn`);
      printJson(turn);
      return;
    }
    case "dispatch": {
      const id = arg(argv, "--id");
      const itemId = arg(argv, "--item");
      if (!id || !itemId) throw new Error("dispatch 需要 --id 与 --item");
      const body = { itemId };
      const prompt = arg(argv, "--prompt");
      if (prompt != null) body.prompt = prompt;
      const result = await request("POST", `/issues/${id}/dispatch`, body);
      printJson(result);
      return;
    }
    case "ready": {
      const id = arg(argv, "--id");
      if (!id) throw new Error("ready 需要 --id");
      const { issue } = await request("POST", `/issues/${id}/ready`);
      printJson(issue);
      return;
    }
    case "complete": {
      const id = arg(argv, "--id");
      const note = arg(argv, "--note");
      if (!id) throw new Error("complete 需要 --id");
      if (!note) throw new Error("complete 需要 --note");
      const { issue } = await request("POST", `/issues/${id}/complete`, { note });
      printJson(issue);
      return;
    }
    case "cancel": {
      const id = arg(argv, "--id");
      const note = arg(argv, "--note");
      if (!id) throw new Error("cancel 需要 --id");
      if (!note) throw new Error("cancel 需要 --note");
      const { issue } = await request("POST", `/issues/${id}/cancel`, { note });
      printJson(issue);
      return;
    }
    default:
      throw new Error(`未知命令: ${cmd}`);
  }
}

main().catch((err) => {
  console.error(`issue.mjs: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
