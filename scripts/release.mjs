/**
 * Publish from main: ask for patch, minor, or major, write that version into
 * every workspace package, commit, and push a tag. The tag starts the Release
 * workflow, which builds the dmg. The dmg version is this release version.
 *
 * shellVersion in packages/desktop/package.json stays put unless
 * packages/desktop/src or that package.json differs from the previous tag.
 * Then it rises to this release version, and installed apps download a dmg.
 *
 *   pnpm release                 交互选择 patch / minor / major
 *   pnpm release patch|minor|major
 *   pnpm release 1.2.3           指定版本
 *   pnpm release --dry-run       选择后只打印
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KINDS = ["patch", "minor", "major"];

export function parseVersion(raw) {
  const match = String(raw).trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function formatVersion(parts) {
  return parts.join(".");
}

function bump(base, kind) {
  const current = parseVersion(base);
  if (!current) throw new Error(`无法解析版本 ${base}`);
  const explicit = parseVersion(kind);
  if (explicit) return formatVersion(explicit);
  if (kind === "major") return formatVersion([current[0] + 1, 0, 0]);
  if (kind === "minor") return formatVersion([current[0], current[1] + 1, 0]);
  if (kind === "patch") return formatVersion([current[0], current[1], current[2] + 1]);
  throw new Error(`未知的版本参数 ${kind}，用 patch、minor、major 或 x.y.z`);
}

/** Next release version, taken from whichever of the packages and the latest tag is newer. */
export function nextReleaseVersion(current, tagged, kind) {
  if (!parseVersion(current)) throw new Error(`无法解析版本 ${current}`);
  const base = tagged && compareVersions(tagged, current) > 0 ? tagged : current;
  return bump(base, kind);
}

export function parseChoice(answer) {
  const text = String(answer ?? "").trim().toLowerCase();
  const byNumber = { 1: "patch", 2: "minor", 3: "major" };
  const kind = byNumber[text] ?? text;
  if (!KINDS.includes(kind)) return null;
  return kind;
}

export function parseReleaseArgs(argv) {
  const flags = { dryRun: false, help: false };
  const positional = [];
  for (const arg of argv) {
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg.startsWith("-")) throw new Error(`未知参数 ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 1) throw new Error(`多余的参数 ${positional.slice(1).join(" ")}`);
  return { flags, kind: positional[0] ?? null };
}

export function versionedPackageFiles(repoRoot) {
  const files = [];
  for (const name of fs.readdirSync(path.join(repoRoot, "packages"))) {
    const file = path.join(repoRoot, "packages", name, "package.json");
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof pkg.version === "string") files.push(file);
  }
  return files.sort();
}

export function shellPackageFile(repoRoot) {
  return path.join(repoRoot, "packages", "desktop", "package.json");
}

/** True when a path is the desktop shell: src, or its package.json. */
export function desktopShellChanged(paths) {
  return paths.some((file) => {
    const name = String(file).replaceAll("\\", "/").replace(/^\.\//, "");
    return (
      name === "packages/desktop/package.json" ||
      name === "packages/desktop/src" ||
      name.startsWith("packages/desktop/src/")
    );
  });
}

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch (err) {
    if (allowFailure) return "";
    const detail = err instanceof Error && "stderr" in err ? String(err.stderr).trim() : "";
    throw new Error(detail || (err instanceof Error ? err.message : String(err)));
  }
}

function readPackageVersion(file) {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  const version = String(pkg.version ?? "");
  if (!parseVersion(version)) throw new Error(`${path.relative(root, file)} 的版本不是 x.y.z：${version}`);
  return version;
}

function writePackageVersion(file, version) {
  const raw = fs.readFileSync(file, "utf8");
  const next = raw.replace(/"version": "[^"]+"/, `"version": "${version}"`);
  if (next === raw) throw new Error(`没有写到 ${path.relative(root, file)} 的 version`);
  fs.writeFileSync(file, next);
}

function readShellVersion(file) {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  const version = String(pkg.shellVersion ?? "");
  if (!parseVersion(version)) {
    throw new Error(`${path.relative(root, file)} 的 shellVersion 不是 x.y.z：${version}`);
  }
  return version;
}

function writeShellVersion(file, version) {
  const raw = fs.readFileSync(file, "utf8");
  const next = raw.replace(/"shellVersion": "[^"]+"/, `"shellVersion": "${version}"`);
  if (next === raw) throw new Error(`没有写到 ${path.relative(root, file)} 的 shellVersion`);
  fs.writeFileSync(file, next);
}

/** Paths under the desktop shell that differ from the previous release tag. No tag counts as changed. */
function shellChangesSinceTag(tag) {
  if (!tag) return ["packages/desktop/package.json"];
  const out = git([
    "diff",
    "--name-only",
    `v${tag}`,
    "HEAD",
    "--",
    "packages/desktop/src",
    "packages/desktop/package.json",
  ]);
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

function latestTag() {
  const out = git(["tag", "--list", "v[0-9]*", "--sort=-v:refname"]);
  for (const tag of out.split("\n")) {
    const version = tag.trim().replace(/^v/, "");
    if (parseVersion(version)) return version;
  }
  return null;
}

function highestVersion(versions) {
  return versions.reduce((best, version) => (compareVersions(version, best) > 0 ? version : best));
}

function assertClean() {
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]);
  if (dirty) {
    throw new Error("工作区有未提交的改动。提交或还原后再发布。\n" + dirty);
  }
}

function help() {
  console.log(`用法
  pnpm release                 选择 patch、minor 或 major，更新各包版本并推送 tag
  壳版本看 desktop 的 src 和 package.json。相对上一个 tag 有改动才升到本次版本
  pnpm release patch|minor|major
  pnpm release 1.2.3           指定版本
  pnpm release --dry-run       选择后只打印`);
}

async function chooseKind(base) {
  if (!stdin.isTTY) throw new Error("当前不是交互终端。请运行 pnpm release patch、minor 或 major。");
  const options = KINDS.map((kind) => [kind, bump(base, kind)]);
  console.log(`当前版本 ${base}，选择本次发布：`);
  options.forEach(([kind, version], index) => {
    console.log(`  ${index + 1}) ${kind.padEnd(5)} ${version}`);
  });
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const kind = parseChoice(await rl.question("输入 patch、minor 或 major："));
    if (!kind) throw new Error("请输入 patch、minor 或 major。");
    return kind;
  } finally {
    rl.close();
    stdin.pause();
  }
}

async function main() {
  const { flags, kind: argKind } = parseReleaseArgs(process.argv.slice(2));
  if (flags.help) {
    help();
    return;
  }

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD") throw new Error("当前是分离头指针，先回到 main 再发布。");
  if (branch !== "main") throw new Error(`当前在 ${branch}。发布只从 main 推。`);

  git(["fetch", "origin", "--tags", "--quiet"]);
  assertClean();

  const files = versionedPackageFiles(root);
  if (files.length === 0) throw new Error("没有找到带版本号的包。");
  const currentVersions = files.map((file) => ({ file, version: readPackageVersion(file) }));
  const shellFile = shellPackageFile(root);
  const shell = readShellVersion(shellFile);
  const current = highestVersion(currentVersions.map((row) => row.version));
  const tagged = latestTag();
  const kind = argKind ?? (await chooseKind(tagged && compareVersions(tagged, current) > 0 ? tagged : current));
  const version = nextReleaseVersion(current, tagged, kind);
  if (!parseVersion(version)) throw new Error(`版本需要是 x.y.z，收到 ${version}`);
  if (tagged && compareVersions(version, tagged) <= 0) {
    throw new Error(`版本 ${version} 不比已有 tag v${tagged} 新。`);
  }
  if (compareVersions(version, current) <= 0) {
    throw new Error(`版本 ${version} 不比当前版本 ${current} 新。`);
  }
  if (git(["rev-parse", "-q", "--verify", `refs/tags/v${version}`], { allowFailure: true })) {
    throw new Error(`本地已有 tag v${version}。`);
  }

  const tag = `v${version}`;
  const raiseShell = desktopShellChanged(shellChangesSinceTag(tagged)) && compareVersions(version, shell) > 0;
  console.log(`版本 ${current} → ${version}，提交到 ${branch}，推送 tag ${tag}。`);
  for (const row of currentVersions) {
    console.log(`  ${path.relative(root, row.file)}  ${row.version} → ${version}`);
  }
  if (raiseShell) {
    const since = tagged ? `v${tagged}` : "没有上一个 tag";
    console.log(`  壳版本 ${shell} → ${version}（相对 ${since}，desktop 的 src 或 package.json 有改动）`);
  } else {
    console.log(`  壳版本 ${shell}`);
  }
  console.log("Actions 会打出 dmg 并挂到这个 Release。");
  if (flags.dryRun) {
    console.log("dry-run，未提交也未推送。");
    return;
  }

  for (const row of currentVersions) writePackageVersion(row.file, version);
  if (raiseShell) writeShellVersion(shellFile, version);
  git(["add", ...currentVersions.map((row) => path.relative(root, row.file))]);
  git(["commit", "-m", `release: ${version}`]);
  git(["push", "origin", "HEAD"]);
  git(["tag", "-a", tag, "-m", tag]);
  git(["push", "origin", `refs/tags/${tag}`]);
  console.log(`已推送 ${tag}。GitHub Actions 会打包 dmg 并发布。`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
