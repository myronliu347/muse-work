/**
 * Zip the already-built webview and muse-server into a hot-update payload.
 * Run after `pnpm dist:mac` (or at least syncWebview + prepareServer).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resourceVersion, shellVersion } from "./hotRelease.mjs";
import { copyTree, makeTreePortable } from "./portableNodeModules.mjs";

/**
 * `zip` dereferences symlinks unless `-y` is passed. pnpm's node_modules is a
 * tree of links into `.pnpm/.../node_modules`, so dereferencing breaks module
 * resolution: the extracted server cannot import its own dependencies and the
 * app silently falls back to the bundled copy on every launch.
 */
const ZIP_ARGS = ["-r", "-q", "-X", "-y"];

/** Unzip and boot the server once: a linked tree starts, a dereferenced one throws. */
function verifyPackage(zipPath) {
  const check = fs.mkdtempSync(path.join(os.tmpdir(), "muse-hot-check-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-hot-home-"));
  try {
    const extracted = spawnSync("ditto", ["-x", "-k", zipPath, check], { stdio: "ignore" });
    if (extracted.status !== 0) return `ditto exited ${extracted.status}`;

    const link = path.join(check, "muse-server", "node_modules", "hono");
    let stat;
    try {
      stat = fs.lstatSync(link);
    } catch {
      return `missing ${link}`;
    }
    if (!stat.isSymbolicLink()) return "node_modules/hono is not a symlink";

    const entry = path.join(check, "muse-server", "dist", "index.js");
    const boot = spawnSync(process.execPath, [entry, "--port", "0"], {
      cwd: check,
      // Keep the smoke run's state inside the temp dir: the server resolves
      // MUSE_HOME_DIR against HOME, so an absolute path would escape it.
      env: { ...process.env, HOME: home, MUSE_HOME_DIR: "muse-hot-smoke" },
      encoding: "utf8",
      timeout: 20_000,
    });
    const stdout = `${boot.stdout ?? ""}`;
    if (!stdout.includes('"ready":true')) {
      return `server did not start: ${(boot.stderr ?? stdout).trim().split("\n").slice(0, 4).join(" | ")}`;
    }
    return null;
  } finally {
    fs.rmSync(check, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webviewDir = path.join(desktopRoot, "webview");
const serverDir = path.join(desktopRoot, "dist", "muse-server");
const releaseDir = path.join(desktopRoot, "release");

function requirePath(file, label) {
  if (!fs.existsSync(file)) {
    console.error(`[packHot] missing ${label}: ${file}`);
    process.exit(1);
  }
}

requirePath(path.join(webviewDir, "index.html"), "webview");
requirePath(path.join(serverDir, "dist", "index.js"), "muse-server");

const shell = shellVersion(desktopRoot);
const version = resourceVersion(shell);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "muse-hot-"));
const zipPath = path.join(releaseDir, "muse-hot.zip");
const manifestPath = path.join(releaseDir, "muse-hot.json");

try {
  fs.cpSync(webviewDir, path.join(stage, "webview"), { recursive: true, dereference: true });
  makeTreePortable(serverDir);
  copyTree(serverDir, path.join(stage, "muse-server"));
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.rmSync(zipPath, { force: true });
  const zipped = spawnSync("zip", [...ZIP_ARGS, zipPath, "webview", "muse-server"], {
    cwd: stage,
    stdio: "inherit",
  });
  if (zipped.status !== 0) {
    console.error("[packHot] zip failed");
    process.exit(zipped.status ?? 1);
  }
  const failure = verifyPackage(zipPath);
  if (failure) {
    console.error(`[packHot] package does not boot: ${failure}`);
    process.exit(1);
  }
  const sha256 = createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
  const manifest = {
    version,
    shell,
    sha256,
    asset: "muse-hot.zip",
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[packHot] ${manifestPath} version ${version} shell ${shell}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
