#!/usr/bin/env node
/**
 * Todo/Task 管理 CLI：调本地 muse-work server REST API。
 * baseURL 解析链：MUSE_SERVER_URL → MUSE_HOME 下 server 落盘的 server-url 文件
 * （打包版随机端口）→ 默认 8787（MUSE_SERVER_PORT 可覆盖）。
 * 用法见 skills/todo-management/SKILL.md。
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
  process.env.MUSE_SERVER_URL ?? readServerUrlFile() ?? `http://127.0.0.1:${PORT}`;

function usage() {
  console.log(`todo.mjs — Todo/Task 管理 CLI（server 端口 ${PORT}）

用法：
  node todo.mjs create --title <标题> [--priority p0|p1|p2] [--source session|manual|popo|internal] [--description <md>] [--tags 标签1,标签2] [--workdir <目录>]
  node todo.mjs list [--archived]
  node todo.mjs get <todoId>
  node todo.mjs add-task <todoId> --title <标题> [--workdir <目录>] [--description <md>] [--branch <分支>] [--no-worktree]
  node todo.mjs comment <taskId> --content <文本> [--author user|ai|system] [--kind note|result]
  node todo.mjs comments <taskId>
  node todo.mjs runs <taskId>
  node todo.mjs update <todoId> [--title <标题>] [--description <文本>] [--priority p0|p1|p2] [--tags 标签1,标签2] [--workdir <目录>]
  node todo.mjs update-task <taskId> [--title <标题>] [--description <文本>]

task 操作（状态迁移）：
  node todo.mjs approve <taskId>          # 审核通过 → 已完成（清理 worktree/执行会话）
  node todo.mjs requeue <taskId>          # 继续执行（待审核 → 回待执行重新入队）
  node todo.mjs cancel <taskId>           # 取消（执行中会中止会话；仅执行中取消删 worktree）

todo 操作：
  node todo.mjs complete <todoId>         # 标记 todo 已完成（有任务待执行/执行中/待审核时被拒绝）

编辑限制：todo/task 均仅 pending（待执行）可编辑，其他状态 PATCH 返回 409；
todo 的 --workdir 改的是后续 task 的继承值（规划会话目录，task 创建时未指定 workdir 才用）；
task 的 workdir 不支持修改。
`);
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function has(argv, name) {
  return argv.includes(name);
}

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${json.error ?? text}`);
  }
  return json;
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
      const tags = (arg(argv, "--tags") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const { todo } = await request("POST", "/todos", {
        title,
        description: arg(argv, "--description") ?? "",
        priority: arg(argv, "--priority") ?? "p1",
        source: arg(argv, "--source") ?? "session",
        tags,
        // --workdir 可选：绑定 todo 工作目录（规划会话开在这里，task 缺省继承）
        ...(arg(argv, "--workdir") ? { workdir: arg(argv, "--workdir") } : {}),
      });
      console.log(JSON.stringify(todo, null, 2));
      return;
    }
    case "list": {
      const archived = has(argv, "--archived");
      const { todos } = await request("GET", `/todos${archived ? "?archived=1" : ""}`);
      if (todos.length === 0) {
        console.log(archived ? "（无已完成 todo）" : "（无待办 todo）");
        return;
      }
      for (const t of todos) {
        console.log(`${t.id}\t[${t.priority.toUpperCase()}]\t${t.status}\t${t.title}`);
      }
      return;
    }
    case "get": {
      const todoId = argv[0];
      if (!todoId) throw new Error("get 需要 <todoId>");
      const { todo } = await request("GET", `/todos/${todoId}`);
      const { tasks } = await request("GET", `/todos/${todoId}/tasks`);
      console.log(`# ${todo.title}  [${todo.priority.toUpperCase()}] ${todo.status}  source=${todo.source}`);
      if (todo.description) console.log(`\n${todo.description}`);
      console.log("\ntasks:");
      for (const t of tasks) {
        console.log(`  ${t.id}\t${t.status}\t${t.title}\tworkdir=${t.workdir}`);
      }
      return;
    }
    case "add-task": {
      const todoId = argv[0];
      const title = arg(argv, "--title");
      const workdir = arg(argv, "--workdir");
      if (!todoId || !title) {
        throw new Error("add-task 需要 <todoId> --title <标题> [--workdir <目录>]");
      }
      const { task } = await request("POST", `/todos/${todoId}/tasks`, {
        title,
        description: arg(argv, "--description") ?? "",
        // --workdir 可选：未传由 server 继承 todo 绑定目录（todo 也未绑定时 server 400）
        ...(workdir ? { workdir } : {}),
        ...(arg(argv, "--branch") ? { baseBranch: arg(argv, "--branch") } : {}),
        // --no-worktree：git 项目也直接在原目录执行（缺省建 worktree 隔离）
        ...(has(argv, "--no-worktree") ? { worktreeEnabled: false } : {}),
      });
      console.log(JSON.stringify(task, null, 2));
      return;
    }
    case "comment": {
      const taskId = argv[0];
      const content = arg(argv, "--content");
      const author = arg(argv, "--author") ?? "user";
      const kind = arg(argv, "--kind") ?? "note";
      if (!taskId || !content) throw new Error("comment 需要 <taskId> --content <文本>");
      const { comment } = await request("POST", `/tasks/${taskId}/comments`, {
        author,
        kind,
        content,
      });
      console.log(JSON.stringify(comment, null, 2));
      return;
    }
    case "comments": {
      const taskId = argv[0];
      if (!taskId) throw new Error("comments 需要 <taskId>");
      const { comments } = await request("GET", `/tasks/${taskId}/comments`);
      if (comments.length === 0) {
        console.log("（无评论）");
        return;
      }
      for (const c of comments) {
        const time = new Date(c.createdAt).toLocaleString();
        console.log(`[${time}] ${c.author}/${c.kind}: ${c.content}`);
      }
      return;
    }
    case "runs": {
      const taskId = argv[0];
      if (!taskId) throw new Error("runs 需要 <taskId>");
      const { runs } = await request("GET", `/tasks/${taskId}/runs`);
      if (runs.length === 0) {
        console.log("（无执行记录）");
        return;
      }
      for (const r of runs) {
        const time = new Date(r.createdAt).toLocaleString();
        console.log(`${r.id}\t[${r.status}]\t${time}${r.sessionId ? `\tsession=${r.sessionId}` : ""}`);
      }
      return;
    }
    case "update": {
      const todoId = argv[0];
      if (!todoId) throw new Error("update 需要 <todoId>");
      const patch = {};
      const title = arg(argv, "--title");
      const description = arg(argv, "--description");
      const priority = arg(argv, "--priority");
      const tags = arg(argv, "--tags");
      const workdir = arg(argv, "--workdir");
      if (title !== undefined) patch.title = title;
      if (description !== undefined) patch.description = description;
      if (priority !== undefined) patch.priority = priority;
      if (tags !== undefined) {
        patch.tags = tags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (workdir !== undefined) patch.workdir = workdir;
      if (Object.keys(patch).length === 0) {
        throw new Error("update 需要至少一个修改项（--title/--description/--priority/--tags/--workdir）");
      }
      const { todo } = await request("PATCH", `/todos/${todoId}`, patch);
      console.log(JSON.stringify(todo, null, 2));
      return;
    }
    case "update-task": {
      const taskId = argv[0];
      if (!taskId) throw new Error("update-task 需要 <taskId>");
      const patch = {};
      const title = arg(argv, "--title");
      const description = arg(argv, "--description");
      if (title !== undefined) patch.title = title;
      if (description !== undefined) patch.description = description;
      if (Object.keys(patch).length === 0) {
        throw new Error("update-task 需要至少一个修改项（--title/--description）");
      }
      const { task } = await request("PATCH", `/tasks/${taskId}`, patch);
      console.log(JSON.stringify(task, null, 2));
      return;
    }
    case "approve": {
      const taskId = argv[0];
      if (!taskId) throw new Error("approve 需要 <taskId>");
      await request("POST", `/tasks/${taskId}/approve`);
      console.log(`已审核通过：${taskId}`);
      return;
    }
    case "requeue": {
      const taskId = argv[0];
      if (!taskId) throw new Error("requeue 需要 <taskId>");
      await request("POST", `/tasks/${taskId}/enqueue`);
      console.log(`已重新入队执行：${taskId}`);
      return;
    }
    case "cancel": {
      const taskId = argv[0];
      if (!taskId) throw new Error("cancel 需要 <taskId>");
      await request("POST", `/tasks/${taskId}/cancel`);
      console.log(`已取消：${taskId}`);
      return;
    }
    case "complete": {
      const todoId = argv[0];
      if (!todoId) throw new Error("complete 需要 <todoId>");
      await request("POST", `/todos/${todoId}/complete`);
      console.log(`已标记完成：${todoId}`);
      return;
    }
    default:
      throw new Error(`未知命令: ${cmd}`);
  }
}

main().catch((err) => {
  console.error(`todo.mjs: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
