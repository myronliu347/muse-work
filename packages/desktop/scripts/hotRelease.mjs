/**
 * Shared version stamp for the dmg and the hot-update zip.
 * HOT_VERSION (a tag like v0.2.0) is the resource version.
 * The shell version stays packages/desktop/package.json so an Electron
 * upgrade can refuse older shells.
 */
import fs from "node:fs";
import path from "node:path";

export function shellVersion(desktopRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
  return String(pkg.version);
}

export function resourceVersion(shell) {
  const raw = process.env.HOT_VERSION?.trim() || shell;
  return raw.replace(/^v/, "");
}

export function writeBundledHot(desktopRoot) {
  const shell = shellVersion(desktopRoot);
  const version = resourceVersion(shell);
  const file = path.join(desktopRoot, "dist", "bundled-hot.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version, shell }, null, 2)}\n`);
  return { version, shell, file };
}
