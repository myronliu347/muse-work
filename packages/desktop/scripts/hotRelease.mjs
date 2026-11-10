/**
 * Shared version stamp for the dmg and the hot-update zip.
 * HOT_VERSION (a tag like v0.2.0) is the resource version. electron-builder
 * names the dmg from package.json "version", which tracks that release.
 * shellVersion in the same package.json is the Electron shell. pnpm release
 * raises it when packages/desktop/src or package.json differs from the
 * previous tag.
 */
import fs from "node:fs";
import path from "node:path";

export function shellVersion(desktopRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
  const raw = typeof pkg.shellVersion === "string" ? pkg.shellVersion.trim().replace(/^v/, "") : "";
  if (!raw) throw new Error("packages/desktop/package.json 缺少 shellVersion");
  return raw;
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
