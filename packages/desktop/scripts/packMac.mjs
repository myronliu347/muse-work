/**
 * Package the macOS app after compiling node-pty for Electron and replacing
 * the pnpm symlink with real files so the bundle does not point back at the
 * Node-ABI build in the pnpm store.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureNodePty } from "./ensureNodePty.mjs";
import { writeBundledHot } from "./hotRelease.mjs";
import { materializeNodePty, restoreNodePty } from "./nodePtyPackaging.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(desktopRoot, "package.json"));

let builder;
function runElectronBuilder() {
  const cli = require.resolve("electron-builder/cli.js");
  return new Promise((resolve, reject) => {
    builder = spawn(process.execPath, [cli, "--mac", "dmg"], {
      cwd: desktopRoot,
      stdio: "inherit",
    });
    builder.on("error", reject);
    builder.on("exit", (code, signal) => {
      if (signal) reject(new Error(`electron-builder 被信号 ${signal} 终止`));
      else resolve(code ?? 1);
    });
  });
}

let restore = () => {};
function onSignal() {
  builder?.kill("SIGTERM");
  try {
    restore();
  } finally {
    process.exit(130);
  }
}
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

try {
  const bundled = writeBundledHot(desktopRoot);
  console.log(
    `[packMac] bundled hot version ${bundled.version} shell ${bundled.shell}`,
  );
  await ensureNodePty();
  if (materializeNodePty(desktopRoot)) {
    console.log(
      "[packMac] 已展开 node-pty 符号链接，安装包将包含按 Electron 编译的 pty.node",
    );
    restore = () => {
      restoreNodePty(desktopRoot);
    };
  }
  const code = await runElectronBuilder();
  restore();
  restore = () => {};
  process.exit(code);
} catch (err) {
  try {
    restore();
  } catch (restoreErr) {
    console.error(restoreErr instanceof Error ? restoreErr.message : restoreErr);
  }
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
