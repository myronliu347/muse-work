/**
 * node-pty's native addon must be compiled for Electron's NODE_MODULE_VERSION
 * (Electron 43 => 148). A normal install on Node 24 produces ABI 137, and
 * Electron refuses to load it.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebuild } from "@electron/rebuild";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(desktopRoot, "package.json"));

function electronBinary() {
  return require("electron");
}

function electronVersion() {
  return require("electron/package.json").version;
}

export function nodePtyLoadsInElectron() {
  try {
    execFileSync(electronBinary(), ["-e", "require('node-pty')"], {
      cwd: desktopRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString() : "";
    const stderr = err.stderr ? err.stderr.toString() : "";
    const output = `${stdout}\n${stderr}`;
    if (output.includes("NODE_MODULE_VERSION") || output.includes("pty.node")) {
      console.error(output.trim());
      return false;
    }
    throw err;
  }
}

export async function ensureNodePty({ force = false } = {}) {
  if (!force && nodePtyLoadsInElectron()) return;
  const version = electronVersion();
  console.log(
    `[ensureNodePty] 按 Electron ${version} 重新编译 node-pty（系统 Node 与 Electron 的 NODE_MODULE_VERSION 不一致）`,
  );
  await rebuild({
    buildPath: desktopRoot,
    electronVersion: version,
    onlyModules: ["node-pty"],
    force: true,
    disablePreGypCopy: true,
    projectRootPath: path.resolve(desktopRoot, "../.."),
  });
  if (!nodePtyLoadsInElectron()) {
    throw new Error(
      "node-pty 已重新编译，但 Electron 仍无法加载 pty.node。确认本机已安装编译工具后重试。",
    );
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  ensureNodePty({ force: process.argv.includes("--force") }).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
