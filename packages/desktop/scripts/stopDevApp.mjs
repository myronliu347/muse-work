import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pidFile = join(packageRoot, ".dev-app.pid");

if (!existsSync(pidFile)) process.exit(0);

const pid = Number(readFileSync(pidFile, "utf8").trim());
rmSync(pidFile, { force: true });
if (!Number.isInteger(pid) || pid <= 0) process.exit(0);

const alive = () => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

if (!alive()) process.exit(0);

try {
  process.kill(pid, "SIGTERM");
} catch {
  process.exit(0);
}

const deadline = Date.now() + 3000;
while (alive() && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 100));
}

if (alive()) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}
console.log(`[dev] stopped previous app (pid ${pid})`);
