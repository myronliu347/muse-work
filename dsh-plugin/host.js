// Muse as a DSH bundle: issue store, session binding, and HTTP routes.
//
// Third-party bundles cannot import @deepseek-ai/* packages, so this host half
// is dependency-free: it uses only node builtins and services the composition
// already provides (webServer, sessionController, agents).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROUTE_PREFIX = '/muse';
const BODY_LIMIT = 256 * 1024;

function dshHome() {
  return process.env.DSH_HOME || path.join(process.env.HOME || '', '.dsh');
}

function createStore(file) {
  let state = { version: 1, issues: [] };
  let chain = Promise.resolve();

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && Array.isArray(parsed.issues)) state = parsed;
  } catch {
    // Missing or unreadable store starts empty; the first write recreates it.
  }

  function persist() {
    chain = chain.then(async () => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
      await fs.promises.rename(tmp, file);
    });
    return chain;
  }

  return {
    list() {
      return state.issues.map((issue) => ({ ...issue }));
    },
    get(id) {
      const issue = state.issues.find((item) => item.id === id);
      return issue ? { ...issue } : undefined;
    },
    findBySession(sessionId) {
      return state.issues.find((item) => item.sessionId === sessionId);
    },
    async create(input) {
      const now = Date.now();
      const issue = {
        id: `issue-${crypto.randomUUID().slice(0, 8)}`,
        title: input.title,
        description: input.description ?? '',
        status: 'open',
        priority: input.priority ?? 'p1',
        workdir: input.workdir,
        createdAt: now,
        updatedAt: now,
      };
      state.issues.push(issue);
      await persist();
      return { ...issue };
    },
    async update(id, patch) {
      const issue = state.issues.find((item) => item.id === id);
      if (!issue) return undefined;
      Object.assign(issue, patch, { updatedAt: Date.now() });
      await persist();
      return { ...issue };
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function issuePrompt(issue, message) {
  return [
    `事项：${issue.title}`,
    `ID：${issue.id}`,
    issue.description ? `目标与验收：\n${issue.description}` : '',
    message ? `\n下一步：\n${message}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function apply(ctx, config = {}) {
  const dataFile =
    config.dataFile || path.join(dshHome(), 'muse', 'issues.json');
  const store = createStore(dataFile);
  const defaultWorkdir = config.workdir || process.cwd();
  const execPreset = config.execPreset || 'muse-exec';

  async function ensureSession(issue) {
    const controller = ctx.get('sessionController');
    if (!controller) throw new Error('sessionController unavailable in this composition');

    if (issue.sessionId) return issue.sessionId;

    const created = await controller.create({
      cwd: issue.workdir || defaultWorkdir,
      agentPreset: execPreset,
    });
    await controller.rename({ sessionId: created.sessionId, title: issue.title });
    await store.update(issue.id, { sessionId: created.sessionId });
    return created.sessionId;
  }

  const api = {
    listIssues() {
      return store.list();
    },
    getIssue(id) {
      return store.get(id);
    },
    async createIssue(input) {
      const title = String(input.title ?? '').trim();
      if (!title) throw new Error('title required');
      return store.create({
        title,
        description: String(input.description ?? '').trim(),
        priority: ['p0', 'p1', 'p2'].includes(input.priority) ? input.priority : 'p1',
        workdir: input.workdir ? String(input.workdir) : undefined,
      });
    },
    async messageIssue(id, message) {
      const issue = store.get(id);
      if (!issue) throw new Error(`unknown issue: ${id}`);
      if (issue.status === 'completed' || issue.status === 'cancelled') {
        throw new Error(`issue is ${issue.status}`);
      }
      const controller = ctx.get('sessionController');
      if (!controller) throw new Error('sessionController unavailable in this composition');

      const sessionId = await ensureSession(issue);
      await controller.prompt({
        requestId: crypto.randomUUID(),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: issuePrompt(issue, String(message ?? '').trim()) }],
      });
      return store.update(id, { status: 'running', sessionId });
    },
    async closeIssue(id, action, note) {
      const issue = store.get(id);
      if (!issue) throw new Error(`unknown issue: ${id}`);
      const status = action === 'cancel' ? 'cancelled' : 'completed';
      const controller = ctx.get('sessionController');
      if (issue.sessionId && controller) {
        try {
          controller.cancel({ sessionId: issue.sessionId });
        } catch {
          // A cold or already-idle session needs no cancellation.
        }
      }
      return store.update(id, { status, closeNote: note ? String(note) : undefined });
    },
  };

  ctx.effect(() => ctx.provide('muse', api));

  ctx.on('session/event', (session, event) => {
    if (!event || event.type !== 'turn/end') return;
    const issue = store.findBySession(session?.id);
    if (!issue || issue.status !== 'running') return;
    void store.update(issue.id, { status: 'review' });
  });

  ctx.inject(['webServer'], (child) => {
    child.effect(() =>
      child.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        async handler(req, res) {
          try {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const parts = url.pathname.split('/').filter(Boolean); // muse/...
            const rest = parts.slice(1);
            const method = req.method ?? 'GET';

            if (rest.length === 1 && rest[0] === 'issues' && method === 'GET') {
              return send(res, 200, { issues: api.listIssues() });
            }
            if (rest.length === 1 && rest[0] === 'issues' && method === 'POST') {
              const body = await readBody(req);
              return send(res, 201, await api.createIssue(body));
            }
            if (rest.length === 2 && rest[0] === 'issues' && method === 'GET') {
              const issue = api.getIssue(rest[1]);
              return issue ? send(res, 200, issue) : send(res, 404, { error: 'not found' });
            }
            if (rest.length === 3 && rest[0] === 'issues' && rest[2] === 'message' && method === 'POST') {
              const body = await readBody(req);
              return send(res, 200, await api.messageIssue(rest[1], body.message));
            }
            if (rest.length === 3 && rest[0] === 'issues' && rest[2] === 'close' && method === 'POST') {
              const body = await readBody(req);
              return send(res, 200, await api.closeIssue(rest[1], body.action, body.note));
            }
            return send(res, 404, { error: 'not found' });
          } catch (error) {
            return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
          }
        },
      }),
    );
  });
}
