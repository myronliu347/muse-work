# 技能市场 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面图标栏加入「技能」页，列出用户目录里已安装的技能，并从 skills.sh 公开榜单一键安装到 `~/.agents/skills`。

**Architecture:** 定位、复制、已安装列表和市场解析都是 server 里的纯函数，路由只做校验和调用。安装用浅克隆，按 skills CLI 的容器规则找 `SKILL.md`，再用 frontmatter `name` 对上 `skillId`。页面沿用自动化整页的版式。安装成功后清掉技能列表缓存，并刷新已经建立的技能目录快照。

**Tech Stack:** TypeScript、Hono、React、Vitest、Testing Library。改 `packages/server`、`packages/agent`、`packages/webview`。

**Spec:** `docs/superpowers/specs/2026-10-26-skills-market-design.md`

## Global Constraints

- 安装只写入 `~/.agents/skills/<frontmatter name>`。不装到项目目录，不调用 `npx skills`，不请求 `https://skills.sh/api/v1`。
- `source` 必须是 `owner/repo`：两段都只含字母、数字、`.`、`_`、`-`，且不能是 `.` 或 `..`。`skillId` 非空、不超过 128，不能含 `/`、`\` 或空字符。
- 仓库根有合法 `SKILL.md` 时只认这一个。否则在规格列出的容器里往下最多 3 层。容器里一个技能都没有才全库递归，并跳过 `node_modules`、`.git`、`dist`、`build`、`__pycache__`。
- 匹配是 frontmatter `name` 与 `skillId` 忽略大小写后全等。0 个报「仓库里没有这个技能」。多于 1 个报「仓库里有多份同名技能」。不用目录名凑。
- 复制上限：合计 25 MiB，1000 个文件，单文件 10 MiB。指向技能目录外的符号链接整次失败并删掉目标。目录内的链接按内容复制。
- 已安装只读 `~/.agents/skills`、`~/.claude/skills`、`~/.muse-work/skills`（`MUSE_HOME_DIR` 覆盖最后这个目录名）。卸载只接受这三个根的直接子目录。符号链接只解除链接。
- 市场：无 `q` 时请求 `https://www.skills.sh/api/skills/all-time/{page}`；`q` 去空白后至少 2 字，请求 `https://skills.sh/api/search?q={q}&limit=50`，并忽略 `page`。代理超时 15 秒。上游失败返回 502 和「技能市场暂时打不开」。
- 克隆超时 60 秒，`GIT_TERMINAL_PROMPT=0`。失败文案用规格里的中文短句。
- 图标顺序：Muse Bot、会话、自动化、技能、设置。技能页占中间整页，不显示会话列表和右侧面板。离开设置页时走现有未保存拦截。
- 界面只复用规格「界面」一节里的字号、颜色、圆角、间距和现有 `ConfirmDialog`。`SkillsPage.css` 不写十六进制颜色。

---

### Task 1: 在仓库里定位技能

**Files:**
- Create: `packages/server/src/services/skillMarket/errors.ts`
- Create: `packages/server/src/services/skillMarket/locateSkill.ts`
- Test: `packages/server/tests/skillMarket.locate.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export class SkillMarketError extends Error { readonly status: 400 | 404 | 409 | 502 }`
  - `export type LocatedSkill = { name: string; description: string; dir: string }`
  - `export function parseSkillMarkdown(raw: string): { name: string; description: string } | null`
  - `export function isGitHubSource(source: string): { owner: string; repo: string } | null`
  - `export function isSafeSkillId(skillId: string): boolean`
  - `export function isInstallDirName(name: string): boolean`
  - `export async function locateSkill(repoRoot: string, skillId: string): Promise<LocatedSkill>` 失败时抛 `SkillMarketError`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillMarketError } from "../src/services/skillMarket/errors.js";
import {
  isGitHubSource,
  isSafeSkillId,
  locateSkill,
} from "../src/services/skillMarket/locateSkill.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "muse-skill-"));
  homes.push(dir);
  return dir;
}

async function skill(dir: string, name: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: about ${name}\n---\n`,
  );
}

describe("locateSkill", () => {
  it("rejects unsafe source and skill id", () => {
    expect(isGitHubSource("vercel-labs/skills")).toEqual({
      owner: "vercel-labs",
      repo: "skills",
    });
    expect(isGitHubSource("a/../b")).toBeNull();
    expect(isGitHubSource("https://github.com/a/b")).toBeNull();
    expect(isSafeSkillId("find-skills")).toBe(true);
    expect(isSafeSkillId("a/b")).toBe(false);
  });

  it("keeps only the root skill when the repo root has SKILL.md", async () => {
    const root = await repo();
    await skill(root, "root-skill");
    await skill(path.join(root, "skills", "other"), "other");
    await expect(locateSkill(root, "other")).rejects.toMatchObject({
      message: "仓库里没有这个技能",
      status: 404,
    });
    await expect(locateSkill(root, "Root-Skill")).resolves.toMatchObject({
      name: "root-skill",
    });
  });

  it("matches skills/name and a three-level container path by frontmatter", async () => {
    const root = await repo();
    await skill(path.join(root, "skills", "find-skills"), "find-skills");
    const hit = await locateSkill(root, "Find-Skills");
    expect(hit.dir).toBe(path.join(root, "skills", "find-skills"));

    const nested = await repo();
    await skill(path.join(nested, "skills", "a", "b", "deep"), "deep");
    await expect(locateSkill(nested, "deep")).resolves.toMatchObject({ name: "deep" });
  });

  it("does not recurse to a fourth level when another container skill exists", async () => {
    const root = await repo();
    await skill(path.join(root, "skills", "other"), "other");
    await skill(path.join(root, "skills", "a", "b", "c", "hidden"), "hidden");
    await expect(locateSkill(root, "hidden")).rejects.toBeInstanceOf(SkillMarketError);
  });

  it("recurses when no container skill exists", async () => {
    const root = await repo();
    await skill(path.join(root, "examples", "a", "b", "c", "hidden"), "hidden");
    await expect(locateSkill(root, "hidden")).resolves.toMatchObject({ name: "hidden" });
  });

  it("does not match the directory name, and rejects duplicates", async () => {
    const root = await repo();
    await skill(path.join(root, "skills", "find-skills"), "something-else");
    await expect(locateSkill(root, "find-skills")).rejects.toMatchObject({
      message: "仓库里没有这个技能",
    });

    const dup = await repo();
    await skill(path.join(dup, "skills", "one"), "same");
    await skill(path.join(dup, ".claude", "skills", "two"), "same");
    await expect(locateSkill(dup, "same")).rejects.toMatchObject({
      message: "仓库里有多份同名技能",
      status: 409,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/server exec vitest run tests/skillMarket.locate.test.ts`

Expected: FAIL，找不到 `../src/services/skillMarket/locateSkill.js`

- [ ] **Step 3: Write minimal implementation**

`packages/server/src/services/skillMarket/errors.ts`

```ts
export class SkillMarketError extends Error {
  readonly status: 400 | 404 | 409 | 502;

  constructor(message: string, status: 400 | 404 | 409 | 502) {
    super(message);
    this.name = "SkillMarketError";
    this.status = status;
  }
}
```

`packages/server/src/services/skillMarket/locateSkill.ts`

```ts
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { SkillMarketError } from "./errors.js";

export type LocatedSkill = {
  name: string;
  description: string;
  dir: string;
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__"]);
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const CONTAINERS = [
  "skills",
  "skills/.curated",
  "skills/.experimental",
  "skills/.system",
  ".agents/skills",
  ".claude/skills",
  ".cline/skills",
  ".codebuddy/skills",
  ".codex/skills",
  ".commandcode/skills",
  ".continue/skills",
  ".factory/skills",
  ".github/skills",
  ".goose/skills",
  ".grok/skills",
  ".iflow/skills",
  ".junie/skills",
  ".kilo/skills",
  ".kilocode/skills",
  ".kimchi/skills",
  ".kiro/skills",
  ".minimax/skills",
  ".mux/skills",
  ".neovate/skills",
  ".opencode/skills",
  ".openhands/skills",
  ".pi/skills",
  ".posit/assistant/skills",
  ".qoder/skills",
  ".roo/skills",
  ".trae/skills",
  ".windsurf/skills",
  ".zcode/skills",
  ".zencoder/skills",
];

export function parseSkillMarkdown(
  raw: string,
): { name: string; description: string } | null {
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return null;
  const block = raw.slice(raw.indexOf("\n") + 1, end);
  let name = "";
  let description = "";
  for (const line of block.split("\n")) {
    const match = /^(name|description):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (match[1] === "name") name = value;
    else description = value;
  }
  if (!name || !description) return null;
  return { name, description };
}

export function isGitHubSource(
  source: string,
): { owner: string; repo: string } | null {
  const parts = source.split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
  if (owner === "." || owner === ".." || repo === "." || repo === "..") return null;
  return { owner, repo };
}

export function isSafeSkillId(skillId: string): boolean {
  return (
    skillId.length > 0 &&
    skillId.length <= 128 &&
    !skillId.includes("/") &&
    !skillId.includes("\\") &&
    !skillId.includes("\0")
  );
}

export function isInstallDirName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0")
  );
}

async function readSkill(dir: string): Promise<LocatedSkill | null> {
  try {
    const file = path.join(dir, "SKILL.md");
    const info = await stat(file);
    if (!info.isFile()) return null;
    const parsed = parseSkillMarkdown(await readFile(file, "utf8"));
    if (!parsed) return null;
    return { ...parsed, dir };
  } catch {
    return null;
  }
}

async function walk(
  dir: string,
  maxDepth: number,
  depth: number,
  out: LocatedSkill[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const child = path.join(dir, entry.name);
    const found = await readSkill(child);
    if (found) {
      out.push(found);
      continue;
    }
    if (depth >= maxDepth) continue;
    await walk(child, maxDepth, depth + 1, out);
  }
}

async function walkAll(dir: string, out: LocatedSkill[]): Promise<void> {
  const found = await readSkill(dir);
  if (found) out.push(found);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    await walkAll(path.join(dir, entry.name), out);
  }
}

export async function locateSkill(
  repoRoot: string,
  skillId: string,
): Promise<LocatedSkill> {
  const rootSkill = await readSkill(repoRoot);
  const found: LocatedSkill[] = [];
  if (rootSkill) found.push(rootSkill);
  else {
    for (const container of CONTAINERS) {
      await walk(path.join(repoRoot, container), 3, 1, found);
    }
    if (found.length === 0) await walkAll(repoRoot, found);
  }
  const matches = found.filter(
    (skill) => skill.name.toLowerCase() === skillId.toLowerCase(),
  );
  if (matches.length === 0) {
    throw new SkillMarketError("仓库里没有这个技能", 404);
  }
  if (matches.length > 1) {
    throw new SkillMarketError("仓库里有多份同名技能", 409);
  }
  return matches[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/server exec vitest run tests/skillMarket.locate.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/skillMarket/errors.ts packages/server/src/services/skillMarket/locateSkill.ts packages/server/tests/skillMarket.locate.test.ts
git commit -m "$(cat <<'EOF'
feat: locate a skills.sh skill inside a cloned repo

EOF
)"
```

---

### Task 2: 复制技能目录

**Files:**
- Create: `packages/server/src/services/skillMarket/copySkill.ts`
- Test: `packages/server/tests/skillMarket.copy.test.ts`

**Interfaces:**
- Consumes: `SkillMarketError`
- Produces: `export async function copySkillDirectory(src: string, dest: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copySkillDirectory } from "../src/services/skillMarket/copySkill.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "muse-copy-"));
  homes.push(dir);
  return dir;
}

describe("copySkillDirectory", () => {
  it("copies files and turns an internal symlink into file contents", async () => {
    const root = await tmp();
    const src = path.join(root, "src");
    const dest = path.join(root, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "SKILL.md"), "hello");
    await symlink("SKILL.md", path.join(src, "alias.md"));
    await copySkillDirectory(src, dest);
    expect(await readFile(path.join(dest, "alias.md"), "utf8")).toBe("hello");
    expect((await lstat(path.join(dest, "alias.md"))).isSymbolicLink()).toBe(false);
  });

  it("removes the destination when a symlink escapes the skill", async () => {
    const root = await tmp();
    const src = path.join(root, "src");
    const dest = path.join(root, "dest");
    const outside = path.join(root, "secret.txt");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "SKILL.md"), "hello");
    await writeFile(outside, "secret");
    await symlink(outside, path.join(src, "leak.md"));
    await expect(copySkillDirectory(src, dest)).rejects.toMatchObject({
      message: "技能含有指向目录外的链接",
    });
    await expect(lstat(dest)).rejects.toThrow();
  });

  it("removes the destination when a file is over 10 MiB", async () => {
    const root = await tmp();
    const src = path.join(root, "src");
    const dest = path.join(root, "dest");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "SKILL.md"), "hello");
    await writeFile(path.join(src, "big.bin"), Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(copySkillDirectory(src, dest)).rejects.toMatchObject({
      message: "技能文件过大",
    });
    await expect(lstat(dest)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/server exec vitest run tests/skillMarket.copy.test.ts`

Expected: FAIL，找不到 `copySkill.js`

- [ ] **Step 3: Write minimal implementation**

```ts
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SkillMarketError } from "./errors.js";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 1000;
const MAX_FILE = 10 * 1024 * 1024;

type Budget = { bytes: number; files: number };

async function copyTree(
  srcRoot: string,
  current: string,
  dest: string,
  budget: Budget,
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  await mkdir(dest, { recursive: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const from = path.join(current, entry.name);
    const to = path.join(dest, entry.name);
    const lst = await lstat(from);
    if (lst.isSymbolicLink()) {
      const target = await realpath(from);
      if (target !== srcRoot && !target.startsWith(srcRoot + path.sep)) {
        throw new SkillMarketError("技能含有指向目录外的链接", 400);
      }
      const linked = await lstat(target);
      if (linked.isDirectory()) {
        await copyTree(srcRoot, target, to, budget);
        continue;
      }
      await writeWithinBudget(target, to, budget);
      continue;
    }
    if (lst.isDirectory()) {
      await copyTree(srcRoot, from, to, budget);
      continue;
    }
    if (!lst.isFile()) continue;
    await writeWithinBudget(from, to, budget);
  }
}

async function writeWithinBudget(from: string, to: string, budget: Budget): Promise<void> {
  const data = await readFile(from);
  if (data.byteLength > MAX_FILE || budget.bytes + data.byteLength > MAX_BYTES) {
    throw new SkillMarketError("技能文件过大", 400);
  }
  budget.files += 1;
  if (budget.files > MAX_FILES) throw new SkillMarketError("技能文件过大", 400);
  budget.bytes += data.byteLength;
  await writeFile(to, data);
}

export async function copySkillDirectory(src: string, dest: string): Promise<void> {
  const srcRoot = await realpath(src);
  await mkdir(dest, { recursive: true });
  try {
    await copyTree(srcRoot, srcRoot, dest, { bytes: 0, files: 0 });
  } catch (error) {
    await rm(dest, { recursive: true, force: true });
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/server exec vitest run tests/skillMarket.copy.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/skillMarket/copySkill.ts packages/server/tests/skillMarket.copy.test.ts
git commit -m "$(cat <<'EOF'
feat: copy an installed skill without following outside links

EOF
)"
```

---

### Task 3: 已安装列表和卸载

**Files:**
- Create: `packages/server/src/services/skillMarket/installedSkills.ts`
- Test: `packages/server/tests/skillMarket.installed.test.ts`

**Interfaces:**
- Consumes: `parseSkillMarkdown`，`SkillMarketError`
- Produces:
  - `export type InstalledSkill = { name: string; description: string; path: string }`
  - `export function personalSkillRoots(home: string, configDirName?: string): string[]`
  - `export async function listInstalledSkills(home: string, configDirName?: string): Promise<InstalledSkill[]>`
  - `export async function uninstallInstalledSkill(home: string, targetPath: string, configDirName?: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listInstalledSkills,
  personalSkillRoots,
  uninstallInstalledSkill,
} from "../src/services/skillMarket/installedSkills.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "muse-installed-"));
  homes.push(dir);
  return dir;
}

async function writeSkill(dir: string, name: string) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: about ${name}\n---\n`,
  );
}

describe("installed skills", () => {
  it("lists skills from the three personal roots and skips invalid dirs", async () => {
    const dir = await home();
    const [agents, claude, muse] = personalSkillRoots(dir, ".muse-work");
    await writeSkill(path.join(agents, "find-skills"), "find-skills");
    await writeSkill(path.join(claude, "grill"), "grill");
    await mkdir(path.join(muse, "empty"), { recursive: true });
    const skills = await listInstalledSkills(dir, ".muse-work");
    expect(skills.map((skill) => skill.name).sort()).toEqual(["find-skills", "grill"]);
  });

  it("unlinks a direct-child symlink and refuses a path outside the roots", async () => {
    const dir = await home();
    const [agents] = personalSkillRoots(dir, ".muse-work");
    const real = path.join(dir, "real");
    await writeSkill(real, "real");
    await mkdir(agents, { recursive: true });
    const link = path.join(agents, "real");
    await symlink(real, link);
    await uninstallInstalledSkill(dir, link, ".muse-work");
    await expect(listInstalledSkills(dir, ".muse-work")).resolves.toEqual([]);
    await expect(
      uninstallInstalledSkill(dir, real, ".muse-work"),
    ).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/server exec vitest run tests/skillMarket.installed.test.ts`

Expected: FAIL，找不到 `installedSkills.js`

- [ ] **Step 3: Write minimal implementation**

```ts
import { lstat, readdir, readFile, realpath, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { SkillMarketError } from "./errors.js";
import { parseSkillMarkdown } from "./locateSkill.js";

export type InstalledSkill = {
  name: string;
  description: string;
  path: string;
};

export function personalSkillRoots(
  home: string,
  configDirName = process.env.MUSE_HOME_DIR ?? ".muse-work",
): string[] {
  return [
    path.join(home, ".agents", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, configDirName, "skills"),
  ];
}

export async function listInstalledSkills(
  home: string,
  configDirName?: string,
): Promise<InstalledSkill[]> {
  const skills: InstalledSkill[] = [];
  for (const root of personalSkillRoots(home, configDirName)) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const dir = path.join(root, entry.name);
      try {
        const parsed = parseSkillMarkdown(
          await readFile(path.join(dir, "SKILL.md"), "utf8"),
        );
        if (!parsed) continue;
        skills.push({ ...parsed, path: dir });
      } catch {
        continue;
      }
    }
  }
  return skills;
}

export async function uninstallInstalledSkill(
  home: string,
  targetPath: string,
  configDirName?: string,
): Promise<void> {
  const resolved = path.resolve(targetPath);
  const roots = personalSkillRoots(home, configDirName).map((root) => path.resolve(root));
  const parent = path.dirname(resolved);
  if (!roots.includes(parent)) {
    throw new SkillMarketError("不能卸载这个路径", 400);
  }
  const info = await lstat(resolved);
  if (info.isSymbolicLink()) {
    await unlink(resolved);
    return;
  }
  if (!info.isDirectory()) {
    throw new SkillMarketError("不能卸载这个路径", 400);
  }
  const real = await realpath(resolved);
  const root = parent;
  if (real !== resolved && real !== root && !real.startsWith(root + path.sep)) {
    throw new SkillMarketError("不能卸载这个路径", 400);
  }
  await rm(resolved, { recursive: true, force: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/server exec vitest run tests/skillMarket.installed.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/skillMarket/installedSkills.ts packages/server/tests/skillMarket.installed.test.ts
git commit -m "$(cat <<'EOF'
feat: list and uninstall personal skills

EOF
)"
```

---

### Task 4: 市场解析和安装编排

**Files:**
- Create: `packages/server/src/services/skillMarket/marketClient.ts`
- Create: `packages/server/src/services/skillMarket/installSkill.ts`
- Test: `packages/server/tests/skillMarket.market.test.ts`

**Interfaces:**
- Consumes: `locateSkill`，`copySkillDirectory`，`isGitHubSource`，`isSafeSkillId`，`isInstallDirName`，`SkillMarketError`
- Produces:
  - `export type MarketSkill = { source: string; skillId: string; name: string; installs: number; isOfficial?: boolean }`
  - `export async function fetchSkillMarket(input: { q?: string; page?: number }, fetchImpl?: typeof fetch): Promise<{ skills: MarketSkill[]; hasMore: boolean }>`
  - `export async function installMarketSkill(input: { source: string; skillId: string; home: string; clone: (repoUrl: string, dest: string) => Promise<void> }): Promise<{ name: string; path: string }>`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSkillMarket } from "../src/services/skillMarket/marketClient.js";
import { installMarketSkill } from "../src/services/skillMarket/installSkill.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("skill market", () => {
  it("normalizes the leaderboard and ignores page when searching", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/api/search")) {
        return new Response(
          JSON.stringify({
            skills: [
              {
                source: "vercel-labs/skills",
                skillId: "find-skills",
                name: "find-skills",
                installs: 10,
                extra: true,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          skills: [
            {
              source: "mattpocock/skills",
              skillId: "grill-me",
              name: "grill-me",
              installs: 3,
              isOfficial: true,
            },
          ],
          hasMore: true,
        }),
        { status: 200 },
      );
    });
    const page = await fetchSkillMarket({ page: 0 }, fetchImpl as unknown as typeof fetch);
    expect(page).toEqual({
      skills: [
        {
          source: "mattpocock/skills",
          skillId: "grill-me",
          name: "grill-me",
          installs: 3,
          isOfficial: true,
        },
      ],
      hasMore: true,
    });
    await fetchSkillMarket({ q: "  react ", page: 4 }, fetchImpl as unknown as typeof fetch);
    expect(String(fetchImpl.mock.calls[1][0])).toContain("q=react");
    expect(String(fetchImpl.mock.calls[1][0])).not.toContain("page=");
  });

  it("turns an upstream failure into a 502", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(
      fetchSkillMarket({ page: 0 }, fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 502, message: "技能市场暂时打不开" });
  });

  it("installs the matched directory under ~/.agents/skills and does not overwrite", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "muse-install-"));
    homes.push(home);
    const clone = vi.fn(async (_url: string, dest: string) => {
      const dir = path.join(dest, "skills", "find-skills");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "SKILL.md"),
        "---\nname: find-skills\ndescription: find\n---\n",
      );
      await writeFile(path.join(dir, "notes.txt"), "hi");
    });
    const installed = await installMarketSkill({
      source: "vercel-labs/skills",
      skillId: "find-skills",
      home,
      clone,
    });
    expect(installed.path).toBe(path.join(home, ".agents", "skills", "find-skills"));
    await expect(
      installMarketSkill({
        source: "vercel-labs/skills",
        skillId: "find-skills",
        home,
        clone,
      }),
    ).rejects.toMatchObject({ message: "已经安装", status: 409 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/server exec vitest run tests/skillMarket.market.test.ts`

Expected: FAIL，找不到 `marketClient.js`

- [ ] **Step 3: Write minimal implementation**

`packages/server/src/services/skillMarket/marketClient.ts`

```ts
import { SkillMarketError } from "./errors.js";

export type MarketSkill = {
  source: string;
  skillId: string;
  name: string;
  installs: number;
  isOfficial?: boolean;
};

function normalize(value: unknown): MarketSkill | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.source !== "string" ||
    typeof row.skillId !== "string" ||
    typeof row.name !== "string" ||
    typeof row.installs !== "number"
  ) {
    return null;
  }
  return {
    source: row.source,
    skillId: row.skillId,
    name: row.name,
    installs: row.installs,
    ...(row.isOfficial === true ? { isOfficial: true } : {}),
  };
}

export async function fetchSkillMarket(
  input: { q?: string; page?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ skills: MarketSkill[]; hasMore: boolean }> {
  const q = input.q?.trim() ?? "";
  if (input.q !== undefined && q.length < 2) {
    throw new SkillMarketError("搜索至少两个字", 400);
  }
  const url = q
    ? `https://skills.sh/api/search?q=${encodeURIComponent(q)}&limit=50`
    : `https://www.skills.sh/api/skills/all-time/${input.page ?? 0}`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error("upstream");
    const body = (await res.json()) as { skills?: unknown; hasMore?: unknown };
    const skills = Array.isArray(body.skills)
      ? body.skills.map(normalize).filter((skill): skill is MarketSkill => skill !== null)
      : [];
    return { skills, hasMore: q ? false : body.hasMore === true };
  } catch (error) {
    if (error instanceof SkillMarketError) throw error;
    throw new SkillMarketError("技能市场暂时打不开", 502);
  }
}
```

`installSkill.ts`：

```ts
import { lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copySkillDirectory } from "./copySkill.js";
import { SkillMarketError } from "./errors.js";
import {
  isGitHubSource,
  isInstallDirName,
  isSafeSkillId,
  locateSkill,
} from "./locateSkill.js";

export async function installMarketSkill(input: {
  source: string;
  skillId: string;
  home: string;
  clone: (repoUrl: string, dest: string) => Promise<void>;
}): Promise<{ name: string; path: string }> {
  const source = isGitHubSource(input.source);
  if (!source || !isSafeSkillId(input.skillId)) {
    throw new SkillMarketError("技能来源不正确", 400);
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "muse-skill-src-"));
  try {
    try {
      await input.clone(
        `https://github.com/${source.owner}/${source.repo}.git`,
        temp,
      );
    } catch (error) {
      if (error instanceof SkillMarketError) throw error;
      throw new SkillMarketError("仓库克隆失败", 502);
    }
    const located = await locateSkill(temp, input.skillId);
    if (!isInstallDirName(located.name)) {
      throw new SkillMarketError("技能名不能作为目录", 400);
    }
    const dest = path.join(input.home, ".agents", "skills", located.name);
    try {
      await lstat(dest);
      throw new SkillMarketError("已经安装", 409);
    } catch (error) {
      if (error instanceof SkillMarketError) throw error;
    }
    await copySkillDirectory(located.dir, dest);
    return { name: located.name, path: dest };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
```

`lstat` 在目标不存在时会抛系统错误，这个错误要吞掉再继续复制。上面的 `catch` 已经这样做。目标存在时抛「已经安装」，`finally` 仍会删掉临时克隆。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/server exec vitest run tests/skillMarket.market.test.ts tests/skillMarket.locate.test.ts tests/skillMarket.copy.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/skillMarket/marketClient.ts packages/server/src/services/skillMarket/installSkill.ts packages/server/tests/skillMarket.market.test.ts
git commit -m "$(cat <<'EOF'
feat: fetch the skills.sh catalog and install one skill

EOF
)"
```

---

### Task 5: 刷新已打开会话的技能缓存

**Files:**
- Modify: `packages/agent/src/shared/sharedSkillCatalog.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/tests/shared/sharedSkillCatalog.test.ts`
- Modify: `packages/server/src/services/sessionRunner/agent.ts`
- Modify: `packages/server/src/services/sessionRunner/actions.ts`（`getSkillsForWorkdir` 旁边）
- Modify: `packages/server/src/services/sessionRunner/ctx.ts`（`SessionRunner` 与 `AgentLayer`）

**Interfaces:**
- Consumes: 现有 `catalogs`、`runRefresh`、`skillsListCache`
- Produces:
  - `export async function refreshAllSkillCatalogs(): Promise<void>`
  - `AgentLayer.invalidateSkillsListCache(): void`
  - `SessionRunner.invalidateSkillsListCache(): void`

- [ ] **Step 1: Write the failing test**

在 `packages/agent/tests/shared/sharedSkillCatalog.test.ts` 的 import 里加上 `refreshAllSkillCatalogs`。追加：

```ts
it("refreshAllSkillCatalogs rescans every live catalog", async () => {
  const discover = vi.mocked(diskSkillDiscovery.discoverDiskSkills);
  await acquireSkillCatalog("/tmp/muse-a", { watch: false }, () => {});
  await acquireSkillCatalog("/tmp/muse-b", { watch: false }, () => {});
  const before = discover.mock.calls.length;
  await refreshAllSkillCatalogs();
  expect(discover.mock.calls.length).toBe(before + 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/agent exec vitest run tests/shared/sharedSkillCatalog.test.ts`

Expected: FAIL，`refreshAllSkillCatalogs` 未导出

- [ ] **Step 3: Write minimal implementation**

在 `runRefresh` 后面加：

```ts
export async function refreshAllSkillCatalogs(): Promise<void> {
  await Promise.all([...catalogs.values()].map((entry) => runRefresh(entry)));
}
```

在 `packages/agent/src/index.ts` 的 `listSkillMetadataForWorkdir` 导出旁边加：

```ts
export { refreshAllSkillCatalogs } from "./shared/sharedSkillCatalog.js";
```

`agent.ts` 的返回对象加 `invalidateSkillsListCache() { skillsListCache.clear(); }`。`AgentLayer` 和 `SessionRunner` 加上同名方法。`actions.ts` 的 `getSkillsForWorkdir` 后面把调用转给 `agent.invalidateSkillsListCache()`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/agent exec vitest run tests/shared/sharedSkillCatalog.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/shared/sharedSkillCatalog.ts packages/agent/src/index.ts packages/agent/tests/shared/sharedSkillCatalog.test.ts packages/server/src/services/sessionRunner/agent.ts packages/server/src/services/sessionRunner/actions.ts packages/server/src/services/sessionRunner/ctx.ts
git commit -m "$(cat <<'EOF'
feat: refresh live skill catalogs after install

EOF
)"
```

---

### Task 6: HTTP 路由

**Files:**
- Create: `packages/server/src/services/skillMarket/cloneRepo.ts`
- Create: `packages/server/src/routes/skillMarket.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/tests/skillMarket.routes.test.ts`

**Interfaces:**
- Consumes: Task 3 和 Task 4 的函数，`SessionRunner.invalidateSkillsListCache`，`refreshAllSkillCatalogs`，`resolveHome`
- Produces:
  - `GET /skills/installed`
  - `DELETE /skills/installed` 体 `{ path: string }`
  - `GET /skill-market`
  - `POST /skill-market/install` 体 `{ source: string; skillId: string }`
  - `export function createSkillMarketRoutes(deps?: { fetchImpl?: typeof fetch; clone?: (repoUrl: string, dest: string) => Promise<void>; home?: () => string; onInstalled?: () => Promise<void> }): Hono<HonoEnv>`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSkillMarketRoutes } from "../src/routes/skillMarket.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("skill market routes", () => {
  it("serves the catalog, installs one skill, and rejects a bad uninstall path", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "muse-route-"));
    homes.push(home);
    const onInstalled = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          skills: [
            { source: "acme/skills", skillId: "find-skills", name: "find-skills", installs: 4 },
          ],
          hasMore: false,
        }),
        { status: 200 },
      ),
    );
    const app = new Hono();
    app.route(
      "/",
      createSkillMarketRoutes({
        home: () => home,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onInstalled,
        clone: async (_url, dest) => {
          const dir = path.join(dest, "skills", "find-skills");
          await mkdir(dir, { recursive: true });
          await writeFile(
            path.join(dir, "SKILL.md"),
            "---\nname: find-skills\ndescription: find\n---\n",
          );
        },
      }),
    );

    const short = await app.request("/skill-market?q=a");
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "搜索至少两个字" });

    const market = await app.request("/skill-market?page=0");
    expect(await market.json()).toEqual({
      skills: [
        { source: "acme/skills", skillId: "find-skills", name: "find-skills", installs: 4 },
      ],
      hasMore: false,
    });

    const installedRes = await app.request("/skill-market/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "acme/skills", skillId: "find-skills" }),
    });
    expect(installedRes.status).toBe(200);
    expect(await installedRes.json()).toEqual({
      name: "find-skills",
      path: path.join(home, ".agents", "skills", "find-skills"),
    });
    expect(onInstalled).toHaveBeenCalledOnce();

    const listed = await app.request("/skills/installed");
    expect(await listed.json()).toEqual({
      skills: [
        {
          name: "find-skills",
          description: "find",
          path: path.join(home, ".agents", "skills", "find-skills"),
        },
      ],
    });

    const denied = await app.request("/skills/installed", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/etc" }),
    });
    expect(denied.status).toBe(400);
  });

  it("returns 502 when the catalog is down", async () => {
    const app = new Hono();
    app.route(
      "/",
      createSkillMarketRoutes({
        fetchImpl: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch,
      }),
    );
    const res = await app.request("/skill-market?page=0");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "技能市场暂时打不开" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/server exec vitest run tests/skillMarket.routes.test.ts`

Expected: FAIL，找不到路由模块

- [ ] **Step 3: Write minimal implementation**

`packages/server/src/services/skillMarket/cloneRepo.ts`

```ts
import { spawn } from "node:child_process";
import { SkillMarketError } from "./errors.js";

export function cloneGitHubRepo(repoUrl: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["clone", "--depth", "1", repoUrl, dest], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new SkillMarketError("仓库克隆失败", 502));
    }, 60_000);
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new SkillMarketError(
          error.code === "ENOENT" ? "本机没有 git" : "仓库克隆失败",
          502,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new SkillMarketError("仓库克隆失败", 502));
    });
  });
}
```

`createSkillMarketRoutes` 的实现：

```ts
import { Hono } from "hono";
import { resolveHome } from "../utils/paths.js";
import { SkillMarketError } from "../services/skillMarket/errors.js";
import { cloneGitHubRepo } from "../services/skillMarket/cloneRepo.js";
import { fetchSkillMarket } from "../services/skillMarket/marketClient.js";
import { installMarketSkill } from "../services/skillMarket/installSkill.js";
import {
  listInstalledSkills,
  uninstallInstalledSkill,
} from "../services/skillMarket/installedSkills.js";

type Deps = {
  fetchImpl?: typeof fetch;
  clone?: (repoUrl: string, dest: string) => Promise<void>;
  home?: () => string;
  onInstalled?: () => Promise<void>;
};

export function createSkillMarketRoutes(deps: Deps = {}) {
  const home = deps.home ?? (() => resolveHome());
  const fetchImpl = deps.fetchImpl ?? fetch;
  const clone = deps.clone ?? cloneGitHubRepo;
  const onInstalled = deps.onInstalled ?? (async () => {});
  const app = new Hono();

  const fail = (c: { json: (body: unknown, status: 400 | 404 | 409 | 502) => Response }, error: unknown) => {
    if (error instanceof SkillMarketError) return c.json({ error: error.message }, error.status);
    return c.json({ error: "仓库克隆失败" }, 502);
  };

  app.get("/skills/installed", async (c) => {
    return c.json({ skills: await listInstalledSkills(home()) });
  });

  app.delete("/skills/installed", async (c) => {
    const body = await c.req.json().catch(() => ({} as { path?: string }));
    try {
      await uninstallInstalledSkill(home(), String(body.path ?? ""));
      await onInstalled();
      return c.json({ ok: true });
    } catch (error) {
      return fail(c, error);
    }
  });

  app.get("/skill-market", async (c) => {
    const q = c.req.query("q");
    const page = Number(c.req.query("page") ?? "0");
    try {
      return c.json(
        await fetchSkillMarket(
          q === undefined ? { page: Number.isFinite(page) ? page : 0 } : { q },
          fetchImpl,
        ),
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/skill-market/install", async (c) => {
    const body = await c.req.json().catch(() => ({} as { source?: string; skillId?: string }));
    try {
      const installed = await installMarketSkill({
        source: String(body.source ?? ""),
        skillId: String(body.skillId ?? ""),
        home: home(),
        clone,
      });
      await onInstalled();
      return c.json(installed);
    } catch (error) {
      return fail(c, error);
    }
  });

  return app;
}
```

`app.ts` 在 `skillsRoutes` 后面挂上，`onInstalled` 闭包使用同一个 `ctx`：

```ts
app.route(
  "/",
  createSkillMarketRoutes({
    onInstalled: async () => {
      ctx.runner.invalidateSkillsListCache();
      const { refreshAllSkillCatalogs } = await import("@muse-work/agent");
      await refreshAllSkillCatalogs();
    },
  }),
);
```

路由错误已经在 `fail` 里处理。`app.ts` 需要从 `./routes/skillMarket.js` 引入 `createSkillMarketRoutes`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/agent build && pnpm -F @muse-work/server exec vitest run tests/skillMarket.routes.test.ts tests/skillMarket.market.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/skillMarket/cloneRepo.ts packages/server/src/routes/skillMarket.ts packages/server/src/app.ts packages/server/tests/skillMarket.routes.test.ts
git commit -m "$(cat <<'EOF'
feat: expose skill market install routes

EOF
)"
```

---

### Task 7: 网页 API 与技能页

**Files:**
- Modify: `packages/webview/src/muse/apiClient.ts`（`getSkills` 后面）
- Create: `packages/webview/src/components/skills/SkillsPage.tsx`
- Create: `packages/webview/src/styles/SkillsPage.css`
- Test: `packages/webview/tests/components/skillsPage.test.tsx`
- Test: `packages/webview/tests/muse/skillMarketCss.test.ts`

**Interfaces:**
- Consumes: 路由字段 `name`、`description`、`path`、`source`、`skillId`、`installs`、`isOfficial`、`hasMore`
- Produces:
  - `MuseApiClient.listInstalledSkills(): Promise<{ skills: Array<{ name: string; description: string; path: string }> }>`
  - `MuseApiClient.uninstallInstalledSkill(skillPath: string): Promise<{ ok: true }>`
  - `MuseApiClient.getSkillMarket(query: { page?: number; q?: string }): Promise<{ skills: MarketSkill[]; hasMore: boolean }>`
  - `MuseApiClient.installMarketSkill(body: { source: string; skillId: string }): Promise<{ name: string; path: string }>`
  - `export const SkillsPage: React.FC<{ api: MuseApiClient }>`

- [ ] **Step 1: Write the failing test**

`skillsPage.test.tsx` 用 Testing Library 渲染 `SkillsPage`。文件头：

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SkillsPage } from "../../src/components/skills/SkillsPage";
import type { MuseApiClient } from "../../src/muse/apiClient";
```

然后：

```tsx
it("shows installed skills and installs a market row", async () => {
  const user = userEvent.setup();
  const api = {
    listInstalledSkills: vi.fn(async () => ({
      skills: [{ name: "grill", description: "问清楚", path: "/tmp/grill" }],
    })),
    getSkillMarket: vi.fn(async () => ({
      skills: [
        { source: "acme/skills", skillId: "grill", name: "grill", installs: 12 },
        { source: "acme/skills", skillId: "find-skills", name: "find-skills", installs: 40, isOfficial: true },
        { source: "not a repo", skillId: "odd", name: "odd", installs: 1 },
      ],
      hasMore: false,
    })),
    installMarketSkill: vi.fn(async () => ({ name: "find-skills", path: "/tmp/find-skills" })),
    uninstallInstalledSkill: vi.fn(async () => ({ ok: true as const })),
  };
  render(<SkillsPage api={api as unknown as MuseApiClient} />);
  expect(await screen.findByRole("heading", { name: "已安装" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "技能市场" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已安装" })).toBeDisabled();
  expect(screen.getByText("官方")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "需用 CLI 安装" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "安装" }));
  expect(api.installMarketSkill).toHaveBeenCalledWith({
    source: "acme/skills",
    skillId: "find-skills",
  });
});
```

`skillMarketCss.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SkillsPage.css", () => {
  const css = readFileSync(
    new URL("../../src/styles/SkillsPage.css", import.meta.url),
    "utf8",
  );

  it("uses the existing page metrics and no hex colors", () => {
    expect(css).toContain("max-width: 860px");
    expect(css).toContain("min-height: 38px");
    expect(css).toContain("font-size: 22px");
    expect(css).toContain("font-weight: 650");
    expect(css).toContain("border-radius: 12px");
    expect(css).toContain("var(--accent-9)");
    expect(css).toContain("var(--accent-contrast)");
    expect(css).toContain("var(--gray-12)");
    expect(css).toContain("var(--gray-11)");
    expect(css).toContain("var(--red-9)");
    expect(css).toContain("var(--red-11)");
    expect(css).toContain("var(--hairline)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/webview exec vitest run tests/components/skillsPage.test.tsx tests/muse/skillMarketCss.test.ts`

Expected: FAIL，找不到 `SkillsPage`

- [ ] **Step 3: Write minimal implementation**

`apiClient.ts` 四个方法都走现有 `this.request` 和 `parseJson`。`DELETE /skills/installed` 带 JSON 体 `{ path: skillPath }`。`GET /skill-market` 在有 `q` 时只带 `q`，否则带 `page`。

`SkillsPage.tsx`：

- 进入时同时拉已安装和 `getSkillMarket({ page: 0 })`。
- 顶栏标题「技能」。内容里两段：`已安装`、`技能市场`。
- 已安装为空时显示「还没有安装技能」。每一行是 `name`、`description`、路径最后两级，以及「卸载」。
- 点「卸载」打开现有 `ConfirmDialog`：标题「卸载这个技能？」，描述「已经打开的会话要到下一轮才会停用它。」确认文案「卸载」。确认后调用 `uninstallInstalledSkill(path)` 并重新拉已安装列表。
- 搜索框 placeholder「搜索技能」。输入停 300ms。去掉空白后少于 2 个字符时回到第一页榜单，不发搜索。否则 `getSkillMarket({ q })`。
- 市场行显示 `name`、`source`、安装次数。`isOfficial` 时显示文字「官方」。
- 已安装名字与 `skillId` 忽略大小写相同，按钮「已安装」并 disabled。`source` 不含恰好一个 `/`，或任一段不是 `^[A-Za-z0-9._-]+$`，按钮「需用 CLI 安装」并 disabled。其余按钮「安装」。安装中该行按钮 disabled，文案仍是「安装」。失败时按钮回到「安装」，行下显示去掉 `Muse API <数字>: ` 前缀后的错误。
- `hasMore` 时段尾次按钮「加载更多」，请求下一页并把结果接在后面。搜索结果不显示这个按钮。
- 市场请求失败时，市场段显示错误，已安装段保持原列表。
- class 名用 `skills-page`、`skills-page-bar`、`skills-page-scroll`、`skills-page-inner`、`skills-section-title`、`skills-list`、`skills-row`、`skills-row-title`、`skills-row-sub`、`skills-pill`、`skills-btn`、`skills-btn-primary`、`skills-btn-danger`、`skills-search`、`skills-error`、`skills-empty`。页面根 `data-testid="skills-page"`。

`SkillsPage.css` 按规格「界面」抄这些值，选择器只用上面的 class：

- `.skills-page`：`flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--color-background); color: var(--gray-12);`
- `.skills-page-bar`：`min-height: 38px; padding: 0 24px; display: flex; align-items: center;` 里面 `h1` 的 `margin: 0; font-size: var(--font-size-1); font-weight: 600;`
- `.skills-page-scroll`：`flex: 1; min-height: 0; overflow: auto;`
- `.skills-page-inner`：`max-width: 860px; margin: 0 auto; padding: 18px 24px 32px;`
- `.skills-section-title`：`margin: 0 0 16px; font-size: 22px; font-weight: 650; letter-spacing: -0.02em;` 第二段 `.skills-section + .skills-section { margin-top: 32px; }`
- `.skills-list`：`border: 1px solid color-mix(in srgb, var(--gray-6) 70%, transparent); border-radius: 12px; background: var(--gray-3); overflow: hidden;`
- `.skills-row`：`display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-bottom: var(--hairline) solid var(--gray-6);` 最后一行 `border-bottom: none`
- `.skills-row-title`：`font-size: 14px; font-weight: 600;`
- `.skills-row-sub`：`margin-top: 4px; color: var(--gray-11); font-size: 12px;` 子项 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
- `.skills-pill`：`height: 20px; padding: 0 7px; border-radius: 999px; background: var(--gray-4); color: var(--gray-11); font-size: 11px;`
- `.skills-btn`：`font: inherit; font-size: 12px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--gray-6); background: var(--gray-4); color: var(--gray-12); cursor: pointer;`
- `.skills-btn:disabled`：`opacity: 0.4; cursor: not-allowed;`
- `.skills-btn-primary`：`background: var(--accent-9); border-color: var(--accent-9); color: var(--accent-contrast);`
- `.skills-btn-danger`：`color: var(--red-9); background: transparent; border-color: transparent;`
- `.skills-search`：`width: 100%; height: 32px; margin: 0 0 16px; padding: 0 8px; border: 1px solid var(--gray-6); border-radius: 8px; background: var(--gray-1); color: var(--gray-12); font-size: var(--font-size-1);`
- `.skills-error`：`padding: 12px 0; color: var(--red-11); font-size: 13px;`
- `.skills-empty`：`padding: 24px 0; color: var(--gray-11);`

不写 `#` 颜色，不写新的阴影。焦点交给全局 `button:focus-visible`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/webview exec vitest run tests/components/skillsPage.test.tsx tests/muse/skillMarketCss.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/muse/apiClient.ts packages/webview/src/components/skills/SkillsPage.tsx packages/webview/src/styles/SkillsPage.css packages/webview/tests/components/skillsPage.test.tsx packages/webview/tests/muse/skillMarketCss.test.ts
git commit -m "$(cat <<'EOF'
feat: add the skills page for installed skills and the market

EOF
)"
```

---

### Task 8: 接上图标栏

**Files:**
- Modify: `packages/webview/src/components/desktop/shellSurface.tsx`
- Modify: `packages/webview/src/components/desktop/DesktopSidebar.tsx`
- Modify: `packages/webview/src/components/desktop/DesktopShell.tsx`
- Modify: `packages/webview/src/components/ChatApp.tsx`
- Modify: `packages/webview/tests/components/iconRail.test.tsx`
- Modify: `packages/webview/tests/webview/tooltip.test.tsx`

**Interfaces:**
- Consumes: `SkillsPage`，`ShellSurface`
- Produces: `ShellSurface` 含 `"skills"`。`DesktopSidebar` 增加 `onOpenSkills?: () => void`。按钮 `data-testid="desktop-skills-menu"`，`aria-label="技能"`。

- [ ] **Step 1: Write the failing test**

`iconRail.test.tsx` 在自动化和设置的断言之间加上：

```tsx
const skills = screen.getByTestId("desktop-skills-menu");
expect(skills).toHaveAttribute("aria-label", "技能");
```

点击后：

```tsx
await user.click(skills);
expect(screen.getByTestId("skills-page")).toBeInTheDocument();
expect(screen.queryByTestId("desktop-session-list")).toBeNull();
expect(skills.className).toContain("active");
```

`tooltip.test.tsx` 的 `labels` 在自动化和设置之间插入 `["desktop-skills-menu", "技能"]`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/webview exec vitest run tests/components/iconRail.test.tsx tests/webview/tooltip.test.tsx`

Expected: FAIL，找不到 `desktop-skills-menu`

- [ ] **Step 3: Write minimal implementation**

`ShellSurface` 改成 `"assistant" | "sessions" | "automations" | "skills" | "settings"`。

`DesktopSidebar.tsx` 在自动化按钮和设置按钮之间加按钮。图标是折角文档，线宽 1.6：

```tsx
function SkillsIcon() {
  return (
    <RailIcon>
      <path
        d="M7 4.5h7.2L18.5 8.8V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V6A1.5 1.5 0 0 1 7 4.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14.2 4.8V9H18.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </RailIcon>
  );
}
```

`DesktopShell.tsx`：`menuOwnsSelection` 把 `shellView === "skills"` 算进去。`onOpenSkills` 先走 `settingsPageLeaveBlocked(shellView, "skills", settingsPageRef.current)`，再 `setShellView("skills")`。`shellView === "automations"` 的分支后面、设置页前面渲染 `<SkillsPage api={api} />`。

`ChatApp.tsx`：`MainView` 加上 `"skills"`。两处 `view === "assistant" || view === "automations"` 都加上 `|| view === "skills"`。`onOpenSkills` 用同样的未保存拦截，然后 `setNoPaneRail("skills")` 和 `setView("skills")`。渲染处在自动化页判断后、助理页判断前，当 `view === "skills"` 时渲染 `<SkillsPage api={museApi} />`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/webview exec vitest run tests/components/iconRail.test.tsx tests/webview/tooltip.test.tsx tests/components/skillsPage.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/desktop/shellSurface.tsx packages/webview/src/components/desktop/DesktopSidebar.tsx packages/webview/src/components/desktop/DesktopShell.tsx packages/webview/src/components/ChatApp.tsx packages/webview/tests/components/iconRail.test.tsx packages/webview/tests/webview/tooltip.test.tsx
git commit -m "$(cat <<'EOF'
feat: open the skills page from the icon rail

EOF
)"
```
