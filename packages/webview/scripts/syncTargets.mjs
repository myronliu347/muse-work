import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Muse fork: desktop only, no plugin sync targets. Keep postbuild as a no-op
// so `pnpm build` stays green; desktop can copy dist/ when wired.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "..", "dist");

if (!fs.existsSync(distDir)) {
  console.error(`[sync-targets] Build output not found: ${distDir}`);
  process.exit(1);
}

const files = fs.readdirSync(distDir);
console.log(
  `[sync-targets] muse: build ready (${files.join(", ") || "empty"}); no external sync`,
);
