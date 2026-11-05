#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "plugins");
const dest = path.join(root, "dist", "plugins");
if (!fs.existsSync(src)) {
  console.error("[copyPlugins] missing plugins source:", src);
  process.exit(1);
}
// tsc also emits src/plugins/hostPlugins.ts into dist/plugins. Replace only the
// skill-plugin directories so that compiled module stays in place.
fs.mkdirSync(dest, { recursive: true });
const names = new Set(fs.readdirSync(src));
for (const name of fs.readdirSync(dest)) {
  const target = path.join(dest, name);
  if (!names.has(name) && fs.statSync(target).isDirectory()) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}
for (const name of names) {
  const from = path.join(src, name);
  const to = path.join(dest, name);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}
console.log("[copyPlugins] copied plugins to", dest);
