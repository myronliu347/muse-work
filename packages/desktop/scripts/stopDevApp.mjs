import { existsSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pidFile = join(packageRoot, ".dev-app.pid");

/** Dev uses app.setPath("userData", appData/muse-work-desktop-dev). */
function devUserDataDir() {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "muse-work-desktop-dev");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "muse-work-desktop-dev");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "muse-work-desktop-dev");
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stop(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  if (!alive(pid)) return false;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  const deadline = Date.now() + 3000;
  while (alive(pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (alive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  console.log(`[dev] stopped previous app (pid ${pid})`);
  return true;
}

let stopped = false;

if (existsSync(pidFile)) {
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  rmSync(pidFile, { force: true });
  stopped = (await stop(pid)) || stopped;
}

// Older dev builds wrote no pid file, but Chromium leaves a SingletonLock
// symlink like `<host>-<pid>` under the dev userData directory.
const lockFile = join(devUserDataDir(), "SingletonLock");
if (existsSync(lockFile)) {
  try {
    const target = readlinkSync(lockFile);
    const pid = Number(/-(\d+)$/.exec(target)?.[1]);
    stopped = (await stop(pid)) || stopped;
  } catch {
    // a stale or unreadable link; the launch can replace it
  }
  try {
    rmSync(lockFile, { force: true });
  } catch {
    // best-effort
  }
}

if (!stopped) process.exit(0);
