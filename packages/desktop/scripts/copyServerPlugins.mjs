#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureServerPlugins } from "./ensureServerPlugins.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(desktopRoot, "../..");
const src = path.join(workspaceRoot, "packages/server/plugins");
const dest = path.join(desktopRoot, "dist", "muse-server", "plugins");
ensureServerPlugins(src, dest, { force: true });
