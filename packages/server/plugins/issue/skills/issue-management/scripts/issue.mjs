#!/usr/bin/env node
/**
 * Issue 管理 CLI：调本地 muse-work server REST API。
 * Base URL：MUSE_SERVER_URL → ~/.muse-work/server-url → http://127.0.0.1:8787
 * 用法见同目录上级 SKILL.md。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

function getMuseHomeDir(
  home = os.homedir(),
  dirName = process.env.MUSE_HOME_DIR ?? ".muse-work",
) {
  return path.join(home, dirName);
}

function resolveBaseUrl() {
  const fromEnv = process.env.MUSE_SERVER_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  try {
    const file = path.join(getMuseHomeDir(), "server-url");
    const fromFile = fs.readFileSync(file, "utf8").trim();
    if (fromFile) return fromFile.replace(/\/$/, "");
  } catch {
    // ignore
  }
  return "http://127.0.0.1:8787";
}

const BASE = resolveBaseUrl();

function usage() {
  console.log(`issue.mjs — Issue 管理 CLI（${BASE}）

用法：
  node issue.mjs create --title <标题> [--description D] [--priority p0|p1|p2] [--tags a,b]
  node issue.mjs update --id <ID> [--title T] [--description D] [--priority p0|p1|p2] [--tags a,b]
  node issue.mjs items --id <ID> --set-json '[{ "content": "..." }]'
  node issue.mjs dispatch --id <ID> --item <ITEM_ID> [--prompt P]
  node issue.mjs complete --id <ID>
  node issue.mjs cancel --id <ID>
`);
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseTags(raw) {
  if (raw == null || raw === "") return undefined;
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
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
      const tags = parseTags(arg(argv, "--tags"));
      if (tags) body.tags = tags;
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
      const tags = parseTags(arg(argv, "--tags"));
      if (tags) body.tags = tags;
      const { issue } = await request("PATCH", `/issues/${id}`, body);
      printJson(issue);
      return;
    }
    case "items": {
      const id = arg(argv, "--id");
      const setJson = arg(argv, "--set-json");
      if (!id || setJson == null) {
        throw new Error("items 需要 --id 与 --set-json");
      }
      let rawItems;
      try {
        rawItems = JSON.parse(setJson);
      } catch {
        throw new Error("--set-json 不是合法 JSON");
      }
      if (!Array.isArray(rawItems)) {
        throw new Error("--set-json 必须是数组");
      }
      const items = rawItems.map((item) => {
        const row = item && typeof item === "object" ? item : {};
        return {
          ...row,
          id:
            typeof row.id === "string" && row.id
              ? row.id
              : randomUUID(),
          content: typeof row.content === "string" ? row.content : "",
          ...(row.status != null ? { status: row.status } : {}),
        };
      });
      const { issue } = await request("PUT", `/issues/${id}/items`, { items });
      printJson(issue);
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
    case "complete": {
      const id = arg(argv, "--id");
      if (!id) throw new Error("complete 需要 --id");
      const { issue } = await request("POST", `/issues/${id}/complete`);
      printJson(issue);
      return;
    }
    case "cancel": {
      const id = arg(argv, "--id");
      if (!id) throw new Error("cancel 需要 --id");
      const { issue } = await request("POST", `/issues/${id}/cancel`);
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
