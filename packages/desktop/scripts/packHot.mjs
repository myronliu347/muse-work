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
  const zipped = spawnSync("zip", ["-r", "-q", "-X", zipPath, "webview", "muse-server"], {
    cwd: stage,
    stdio: "inherit",
  });
  if (zipped.status !== 0) {
    console.error("[packHot] zip failed");
    process.exit(zipped.status ?? 1);
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
