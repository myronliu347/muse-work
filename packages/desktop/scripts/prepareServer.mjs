#!/usr/bin/env node
/**
 * Deploy a production @muse-work/server tree into dist/muse-server
 * for electron-builder extraResources (includes node_modules + ripgrep binary).
 *
 * electron-builder skips nested `node_modules` when `from` is a parent dir,
 * so package.json points extraResources at `node_modules` as its own `from`.
 * pnpm's absolute symlinks are rewritten to relative ones before that copy,
 * so the dmg does not point back at the machine that built it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureServerPlugins } from "./ensureServerPlugins.mjs";
import { makeTreePortable } from "./portableNodeModules.mjs";

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

for (const filter of ["@muse-work/agent", "@muse-work/provider", "@muse-work/plugin-sdk", "@muse-work/server"]) {
  run("pnpm", ["-F", filter, "build"]);
}

fs.rmSync(out, { recursive: true, force: true });
// pnpm 10 refuses deploy unless the workspace injects its packages.
// --legacy keeps the isolated store. Absolute links are rewritten below.
run("pnpm", ["--filter", "@muse-work/server", "deploy", "--legacy", "--prod", out]);

for (const name of ["src", "tests", "vitest.config.ts", "tsconfig.json"]) {
  fs.rmSync(path.join(out, name), { recursive: true, force: true });
}

// Drop dangling workspace self-link that escapes the deploy tree.
const escapeLink = path.join(out, "node_modules/.pnpm/node_modules/@muse-work/server");
fs.rmSync(escapeLink, { recursive: true, force: true });

const nm = path.join(out, "node_modules");

const entry = path.join(out, "dist", "index.js");
if (!fs.existsSync(entry)) {
  console.error("[prepareServer] missing entry:", entry);
  process.exit(1);
}

const pluginsSrc = path.join(workspaceRoot, "packages/server/plugins");
const pluginsDest = path.join(out, "plugins");
try {
  ensureServerPlugins(pluginsSrc, pluginsDest, { force: true });
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

try {
  makeTreePortable(out);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const providerPkg = path.join(nm, "@muse-work/provider/package.json");
if (!fs.existsSync(providerPkg)) {
  console.error("[prepareServer] missing provider after making node_modules portable:", providerPkg);
  process.exit(1);
}

console.log("[prepareServer] ready at", out);
