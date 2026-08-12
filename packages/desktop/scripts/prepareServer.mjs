#!/usr/bin/env node
/**
 * Deploy a production @muse-work/server tree into dist/muse-server
 * for electron-builder extraResources (includes node_modules + ripgrep binary).
 *
 * electron-builder skips nested `node_modules` when `from` is a parent dir,
 * so we also emit a dereferenced copy and package.json points extraResources
 * at `node_modules` as a top-level `from`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(desktopRoot, "../..");
const out = path.join(desktopRoot, "dist", "muse-server");

function run(cmd, args, cwd = workspaceRoot) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const filter of ["@muse-work/provider", "@muse-work/server"]) {
  run("pnpm", ["-F", filter, "build"]);
}

fs.rmSync(out, { recursive: true, force: true });
run("pnpm", ["--filter", "@muse-work/server", "deploy", "--prod", out]);

for (const name of ["src", "tests", "vitest.config.ts", "tsconfig.json"]) {
  fs.rmSync(path.join(out, name), { recursive: true, force: true });
}

// Drop dangling workspace self-link that escapes the deploy tree.
const escapeLink = path.join(out, "node_modules/.pnpm/node_modules/@muse-work/server");
fs.rmSync(escapeLink, { recursive: true, force: true });

// Dereference symlinks so the packaged app is self-contained on disk.
const nm = path.join(out, "node_modules");
const nmFlat = path.join(out, "node_modules.flat");
fs.rmSync(nmFlat, { recursive: true, force: true });
fs.cpSync(nm, nmFlat, { recursive: true, dereference: true });
fs.rmSync(nm, { recursive: true, force: true });
fs.renameSync(nmFlat, nm);

const entry = path.join(out, "dist", "index.js");
if (!fs.existsSync(entry)) {
  console.error("[prepareServer] missing entry:", entry);
  process.exit(1);
}

const providerPkg = path.join(nm, "@muse-work/provider/package.json");
if (!fs.existsSync(providerPkg)) {
  console.error("[prepareServer] missing provider after flatten:", providerPkg);
  process.exit(1);
}

console.log("[prepareServer] ready at", out);
