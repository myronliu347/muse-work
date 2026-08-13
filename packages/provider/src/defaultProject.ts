import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getMuseHomeDir } from "./paths.js";

export function getProjectsDir(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "projects");
}

/** `~/.muse-work/projects/YYYYMMDD-<uid8>` — created on disk. */
export function createDefaultProjectWorkdir(home = os.homedir()): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const uid = randomUUID().replace(/-/g, "").slice(0, 8);
  const dir = path.join(getProjectsDir(home), `${y}${m}${d}-${uid}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
