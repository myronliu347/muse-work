#!/usr/bin/env node
import fs from "node:fs";

const FIXED_PORT = 19191;
const marker = process.env.CRASH_RESTART_MARKER;

const portIdx = process.argv.indexOf("--port");
const requestedPort = portIdx >= 0 ? process.argv[portIdx + 1] : "0";

if (marker) {
  fs.appendFileSync(marker, `spawn --port ${requestedPort}\n`);
}

if (requestedPort === "0") {
  console.log(
    JSON.stringify({ ready: true, port: FIXED_PORT, host: "127.0.0.1" }),
  );
  setTimeout(() => process.exit(1), 50);
} else if (requestedPort === String(FIXED_PORT)) {
  console.log(
    JSON.stringify({ ready: true, port: FIXED_PORT, host: "127.0.0.1" }),
  );
  setInterval(() => {}, 1000);
} else {
  console.error(`unexpected --port ${requestedPort}`);
  process.exit(2);
}
