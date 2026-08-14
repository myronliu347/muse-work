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
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log("[copyPlugins] copied plugins to", dest);
